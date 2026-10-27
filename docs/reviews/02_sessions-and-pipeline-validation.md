# 사용자·세션과 비동기 작업 흐름 검증

> 2026-10-27 · [Issue #11](https://github.com/loansight-ai/code/issues/11)

담당 계약: [사용자 식별](../design/05_project-and-deployment.md#identity), [API·작업 처리](../design/02_api-and-jobs.md). 실행·설정·테스트 명령은 [백엔드 안내](../../backend/README.md)에서 관리한다.

## 구현 범위

사용자·기본 Workspace·해시 세션, 코드 발급/재접속/전환/로그아웃, Origin 검사, DB 기반 진입 제한과 초기 마이그레이션을 구현했다. 작업 접수·Outbox·RabbitMQ·Worker·임대·재시도·복구, 사용자 작업 스냅샷·영속 이벤트·SSE·확인 상태를 연결했다.

현재 실행하는 작업은 `PIPELINE_CHECK`다. 실제 공시·직접 입력 데이터를 분석하지 않고 `financial_analysis_performed:false`를 반환한다. 분석 원천 revision·계산 옵션·재무/주석 결과를 처리하는 `/analyses` 및 핸들러는 다음 단계다. 프론트엔드 GNB 구현도 포함하지 않는다.

## 실행 결과

| 검증 방식 | 기대 결과 | 실제 결과 |
|---|---|---|
| 백엔드 pytest 전체 | 단위·실제 DB/MQ·마이그레이션 테스트 통과 | **31 passed**, skip·실패·경고 없음 |
| Windows 스크립트 unittest | 선택 옵션·프로세스 관리·CMD 인자/종료 코드 보존 | **6 passed** |
| Ruff 린트·포맷, lockfile 검사 | 코드 형식과 설치 버전 일치 | 통과 |
| Compose 설정 검사·이미지 빌드 | 동일 이미지로 API·Worker·Relay 실행 | 통과 |
| Compose 단발 migrate | 초기 revision 적용 성공 후 서비스 시작 | Exited (0) |
| 실제 개발 서비스 | API·DB·RabbitMQ·Worker·Relay 준비 | 5개 서비스 healthy |
| 실제 HTTP 전체 흐름 | 세션→접수→Outbox→MQ→Worker→DB→SSE→확인→로그아웃 | 201·202·완료·확인·204, 로그아웃 후 401 확인 |
| 실제 SSE | 생성·실행·완료 이벤트 전달 | `task.created`, `task.updated`, `task.completed` 확인 |
| 개발 RabbitMQ 중지 후 작업 접수 | MQ 장애 중에도 DB 영속 접수 유지 | 202 및 `QUEUED` 확인 |
| 같은 RabbitMQ 복구 | 재요청 없이 미발행 작업 복구 | `SUCCEEDED`, 실행 attempt 1 확인 |
| 시작 스크립트 재시작·재실행 | 5개 서비스 함께 제어, 중복 실행 방지 | 재시작 성공·Already running 안내 확인 |

백엔드 테스트는 기존 상태/설정 단위 테스트 16개, 사용자 통합 6개, 작업 통합 8개, 마이그레이션 1개다. 통합 검증은 `loansight_test` DB의 테스트별 독립 스키마와 독립 RabbitMQ 큐를 사용했다. 개발 DB·MQ 영속 볼륨은 삭제하지 않았다.

## 주요 인수 조건

| 검증 대상 | 확인한 결과 |
|---|---|
| `00427`·코드 충돌·비활성 코드 | 앞의 0 보존, 제한된 난수 시도 후 미사용 코드 선택, 비활성 코드 재발급 방지 |
| 형식 오류/비활성/계정 연결 코드 | 자동 등록 없이 동일 진입 실패 처리, 연결 계정의 코드 진입 거부 |
| 세션 쿠키·저장 방식 | HttpOnly·SameSite·Path, Secure 설정, 원본 대신 SHA-256 해시 보관 |
| 여러 기기·사용자 전환·로그아웃·만료 | 같은 사용자/Workspace 복원, 현재 기기만 폐기, 만료 세션 거부 |
| Origin·진입 제한 | 미허용/누락 Origin 403, 실패 요청도 DB 카운터에 반영, 제한 시 429 |
| 동시 동일 작업 접수 | 작업·Outbox·사용자 연결·최초 이벤트 각각 한 건 |
| 사용자 간 공유 점검 | 실행은 재사용, 작업 ID·확인 상태는 개별 보관 |
| 타 사용자 task ID·cursor | 상세/확인 접근 404, 다른 스트림 cursor는 reset으로 재동기화 |
| 동시·반복 알림 확인 | 종료 버전 검사, 확인 이벤트 한 건으로 멱등 처리 |
| 중복 MQ 전달·구세대 메시지 | 결과와 완료 버전 중복 생성 없이 ACK |
| 임대 강제 만료·늦은 결과 | 새 generation Outbox 생성, 이전 소유자의 결과 저장 차단 |
| 재시도 예산 | 제한 횟수 후 FAILED, 무한 즉시 requeue 대신 지연 Outbox |
| 발행 실패·중복 발행 | 미발행 Outbox 보존, confirm 뒤 DB 기록 전 장애를 중복 발행으로 모의 검증 |
| 잘못된 메시지·복구 불가 핸들러 | durable DLQ에서 메시지 수신 확인 |
| 스냅샷 이후 이벤트·SSE 재생 | Workspace 순번 기반 재생, header cursor 우선, 한도 초과 reset |
| LISTEN 연결 종료 | 실제 listener DB 연결 종료 후 재등록·저장 이벤트 재생 확인 |
| 열린 SSE에서 로그아웃 | 남은 배치 전달 전에도 세션을 재검증하고 session.expired로 종료 |
| 초기 마이그레이션 | 빈 테스트 스키마 upgrade, 모델과 차이 없음, downgrade 후 업무 테이블 제거 |

## 검증의 한계

세션 TTL·진입 제한·작업 최대 시도 횟수의 Compose 값은 로컬 개발 예시이며 운영 정책을 확정하지 않았다. 이벤트 자동 삭제·운영 보관 기간은 아직 결정하지 않아 현재는 DB에 보존한다.

임대 장애는 DB의 lease 만료를 강제로 만들어 검증했다. Worker 프로세스 강제 종료·호스트 장애·다중 API/Worker Replica 부하·느린 네트워크의 실제 장시간 부하·DB/MQ 볼륨 백업 복원·k3s 운영은 이번 검증에 포함하지 않았다. 실제 재무 계산·부분 완료·외부 API/모델 품질 검증도 후속 분석 핸들러 구현 단계에서 수행한다.
