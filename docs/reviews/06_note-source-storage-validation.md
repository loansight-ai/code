# 주석 구조화 작업·원문 구간 저장 검증

> 2026-10-27 · Issue #14 · Python 3.12.15 · dart-note-hierarchy 0.8.4 · PostgreSQL·RabbitMQ·Docker Compose

현재 변경의 기준은 [원문 구간 저장 계약](../design/01_data-and-analysis.md#note-storage)이며 사용법과 HTTP 형식은 [백엔드 안내](../../backend/README.md#note-import-api)에서 관리한다. 앞선 모듈 단독 실행과 원문 확보는 [뉴트리 보고서 검증](05_note-hierarchy-real-report-validation.md)을 참조한다.

## 구현과 실행 환경

wheel을 uv 의존성·lockfile에 등록하고 Docker 의존성 설치 전에 복사한다. `NOTE_STRUCTURE` 작업은 기존 Outbox·Relay·RabbitMQ·Worker를 사용한다. 요청의 원문 바이트는 SHA-256 기반 불변 파일로 보관하고 `source_artifact`·`note_structure`·`source_segment`를 PostgreSQL에 저장한다. 마이그레이션은 `adaf5b89c881` 다음의 `8e514c5e3b42`다.

API와 Worker는 Compose `source-artifacts` 볼륨을 공유한다. 구조화 CPU 처리는 별도 스레드에서 수행해 heartbeat를 유지한다. 완료 시 실제 DB 시각으로 임대·소유권을 확인한 뒤 구간 삽입·작업 완료·이벤트를 같은 트랜잭션으로 확정한다. 결과 JSON과 구간 조회는 Workspace 소유권을 검사한다.

Windows 동시 저장 검사에서 파일 교체 경합과 일반 경로/확장 경로(`\\?\`) 표기 차이가 발견됐다. 완성한 임시 파일을 hard link로 게시하고 기존 원본을 덮어쓰지 않으며, 같은 경로 표현으로 정규화해 루트 경계를 검사하도록 보완했다. 서로 다른 파일의 동시 접수에서는 Workspace 외래키의 KEY SHARE와 이벤트 커서의 FOR UPDATE 잠금이 충돌해, 커서 갱신에 FOR NO KEY UPDATE를 사용하도록 수정했다. 커서 갱신 직렬화와 스냅샷의 일관성 계약은 유지한다.

## 실제 보고서 저장 결과

이미 내려받아 보관한 뉴트리 「[첨부추가]사업보고서 (2025.12)」, 접수번호 `20260320001416`의 연결·별도 주석 HTML을 실제 로컬 API에 접수했다. 네트워크를 다시 통해 공시를 수집한 검사가 아니라 동일 원문 바이트를 사용하는 저장 파이프라인 검사다. 테스트 사용자의 쿠키·코드는 Git에 저장하지 않았다.

| 확인 항목 | 연결(CFS) | 별도(OFS) |
| --- | --- | --- |
| 최종 새 사용자 검증의 구조화 ID | `8bd311f0-1264-4fc3-b542-c6911ed03d8d` | `23b736e1-bd2a-4b37-8878-af5b15d8eed2` |
| 저장 구간 | 867 | 784 |
| 표 문맥을 가진 구간 | 120 | 107 |
| Worker 종료 | SUCCEEDED | SUCCEEDED |
| 파서 버전 | 0.8.4 | 0.8.4 |
| 같은 입력 재접수 | 같은 작업·구조화 ID 재사용 | 같은 작업·구조화 ID 재사용 |
| 결과의 사실 검수 상태 | `evidence_verified=false` | `evidence_verified=false` |

모든 구간을 pagination으로 조회해 중복·누락 없는 순서를 확인했다. 입력 해시와 메타데이터 해시가 일치하고, 기존 단독 처리 결과와 블록 ID·소유 노드·XPath·정규화 텍스트를 포함한 payload를 비교했다. Windows 로컬 파서와 Linux Worker가 표 텍스트 줄바꿈을 CRLF/LF로 다르게 반환하므로 비교에서만 줄바꿈을 정규화했다. 저장 payload를 다시 쓰거나 입력 파일을 변환하지 않았다.

다른 사용자로 동일 구조화 ID 조회 시 404를 확인했다. 최종 이미지 재생성 후에도 기존 결과와 구간·원문 해시를 조회하고 재접수 시 같은 ID를 재사용했다. 이어 새 사용자로 두 입력을 접수해 최종 Worker의 새 작업도 SUCCEEDED로 종료되고 동일 구간 수가 저장됨을 확인했다. 기존 개발 DB·MQ·원문 볼륨을 삭제하지 않았다.

로컬 근거는 Git 제외 경로인 [검증 요약](../../.run/note-source-storage-live/summary.json)과 같은 폴더의 CFS/OFS metadata·segments JSON에 있다. 새 체크아웃에는 포함되지 않는다. 검사 스크립트는 `.run/check-note-storage-live.py`에 보관했다. API 조회를 기다리는 해당 스크립트의 짧은 polling은 검증용이며 프론트의 상태 갱신 방식은 기존 SSE를 유지한다.

## 자동 검증 범위

DB·MQ 통합 검사는 개발 DB와 분리한 `deploy/compose.test.yaml`을 사용했다. 각 테스트는 `_test` DB 내 독립 스키마와 작업공간의 별도 원문 디렉터리를 사용하며 테스트 종료 시 자신의 스키마만 정리한다.

- 원문 동시 쓰기·해시 검증·변조 감지·경로 경계·Windows 확장 경로 표기.
- 동일 요청 동시 접수의 멱등성, 서로 다른 요청 동시 접수와 이벤트 순번, 원문/옵션 변경 시 새 revision.
- 원문 구간 pagination·상세 조회·원래 payload/표 문맥 보존, 다른 사용자 접근 차단.
- 인증·형식·범위·인코딩·업로드 크기 오류, 빈 입력의 실패와 구간 미확정.
- 메시지 재전달 시 중복 구간 미생성, 소유권 상실·임대 만료 시 늦은 결과 차단.
- 완료 도중 예외 발생 시 구간·구조화 결과·작업 상태를 함께 롤백.
- 초기 스키마부터 head까지 migration upgrade·모델 비교·base downgrade, 기존 세션·MQ·SSE 회귀.

Windows의 공유 Temp 디렉터리 접근 실패로 첫 검사에서 fixture 오류가 발생했다. 이후 `--basetemp=.run/pytest-notes-complete -p no:cacheprovider`로 프로젝트 내부 임시 경로를 사용했다. 동시 원문 저장 보완 후 별도 반복 검사에서 480회 동시 쓰기가 통과했다.

| 최종 검사 | 실제 결과 |
| --- | --- |
| 분리 DB·MQ 설정 후 백엔드 전체 `pytest backend/tests -q -p no:cacheprovider --basetemp=.run/pytest-notes-complete` | 51개 통과, skip 없음 |
| `ruff check backend --no-cache`, `ruff format --check backend --no-cache` | 통과, 47개 Python 파일 형식 일치 |
| 프론트 `pnpm build`, `pnpm lint`, `pnpm test` | 통과, 테스트 44개. 기존 500kB 초과 청크 안내 유지 |
| `uv lock --check --offline` | 45개 패키지 해석, pyproject/lockfile 일치 |
| 실제 Compose 이미지 빌드·마이그레이션·healthy 확인 | 통과 |
| 최종 이미지의 새 사용자·새 Worker 작업 | 연결/별도 모두 SUCCEEDED, 원문 구간 867/784개, 재접수 재사용·타 사용자 404 |

이번 프론트 변경은 작업 종류와 단계의 한국어 표시만 추가했다. 기존 브라우저 전체 E2E는 재실행하지 않았다. 원문 뷰어는 이번 범위에 포함되지 않는다.

## 한계와 후속

주석 HTML을 준비하는 자동 수집·영역 분리, 원문 진위/정정 관계 확인, 프론트 뷰어의 HTML 정제·하이라이트·열람 기록, 항목별 사실 추출·검수·위험규칙은 구현하지 않았다. 원문 파일/DB 보관·자동 정리 정책과 운영 백업·복구도 미정/미검증이다. 구조화 완료와 업무 검수 완료를 구분하며 기존 미확정 계층을 그대로 저장한다.
