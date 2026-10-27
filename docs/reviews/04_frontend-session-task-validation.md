# 프론트 세션·작업 알림 연동 검증

> 2026-10-27 · Windows PowerShell · Node.js 24.22.1 · pnpm 10.34.9 · Chrome

작업: [Issue #12](https://github.com/loansight-ai/code/issues/12), `feat/12-session-task-sse`.
사용법·연동 범위는 [프론트엔드 안내](../../frontend/README.md#서버-세션작업-연동), 계약과 인수 기준은 [API·작업 설계](../design/02_api-and-jobs.md#recovery)를 따른다.

## 변경과 검증 환경

기존 코드 발급·세션·작업 API를 공통 셸에 연결했다. 스냅샷 cursor 이후 SSE를 연결하고 사용자 전환 시 이전 요청·캐시·스트림을 폐기한다. REST 쓰기 응답에는 cursor가 없으므로 성공 후 서버 목록을 다시 조회한다. 지연된 응답이 이미 확인된 작업을 되살리지 않도록 한다.

브라우저 최초 검증에서 유휴 SSE의 연결 상태가 첫 heartbeat까지 확정되지 않았다. 백엔드 스트림 시작에 `connected` 주석을 즉시 전송하도록 수정하고 재검증했다. 작업 이벤트·cursor·세션 인증 계약은 유지한다.

실제 브라우저 검증은 기본 Compose 개발 서버와 Vite `/api` 프록시를 사용했다. 브라우저 테스트는 새 사용자 코드와 개인 연결 점검 작업을 생성하며 기존 개발 DB·MQ 볼륨을 삭제하지 않는다. 백엔드 테스트는 별도 `deploy/compose.test.yaml`의 PostgreSQL·RabbitMQ와 테스트별 독립 스키마를 사용했다.

## 검증 결과

| 검증 방법 | 기대 결과 | 실제 결과 |
| --- | --- | --- |
| `pnpm build` | TypeScript와 프로덕션 빌드 성공 | 통과, 기본 500kB 초과 청크 안내 유지 |
| `pnpm lint` | 정적 검사 성공 | 통과 |
| 변경 프론트 파일 대상 `prettier --check` | 변경 파일 형식 일치 | 통과 |
| `pnpm format:check` | 저장소 전체 형식 일치 | 실패: 변경하지 않은 기존 37개 파일의 CRLF 줄바꿈. Git `core.autocrlf=true`, Prettier 기본 LF 설정. 이번 작업에서 기존 파일 일괄 재작성은 하지 않음 |
| `prettier --check . --end-of-line auto` | 줄바꿈 차이를 제외한 전체 형식 일치 | 통과 |
| `pnpm test` | 기존 기능 및 세션·SSE 회귀 방지 | 44개 통과(기존 32개 + 신규 12개) |
| `LOANSIGHT_LIVE_API=1 pnpm test:e2e` | PC·태블릿 기존 화면 및 실제 서버 연동 | 12개 통과 |
| 최종 지연 응답 보완 후 `LOANSIGHT_LIVE_API=1 pnpm exec playwright test e2e/session-tasks-live.spec.ts` | 실제 연동 회귀 방지 | PC·태블릿 2개 통과, 작업 상세 캡처 생성 |
| 분리 DB·MQ 설정 후 `backend/.venv/Scripts/python.exe -m pytest backend/tests -q -p no:cacheprovider` | 백엔드 전체 및 SSE 첫 주석·기존 이벤트 재생 검증 | 31개 통과, skip 없음 |
| `ruff check backend --no-cache`, `ruff format --check backend --no-cache` | 백엔드 정적·형식 검사 | 통과 |
| `git diff --check` | 변경 패치 공백 검사 | 통과 |

프론트 신규 테스트는 서버 요청과 EventSource를 제어하여 다음을 재현했다.

- 스냅샷 후 cursor 구독, 중복 이벤트·이전 상태 버전 무시, 종료 확인의 단조성.
- `reset` 시 기존 연결 종료와 새 목록·cursor 복원, 자동 작업 생성 없음.
- `session.expired`와 SSE 연결 오류 후 401에서 사용자·캐시·연결 정리.
- 앞의 0 보존, 사용자 전환 후 이전 스트림 이벤트와 늦은 스냅샷 차단.
- 미발급 코드, 서버 503·재시도, 429·Retry-After 안내.
- 같은 EventSource의 재연결 상태와 마지막 작업 상태 유지.
- 확인 버전 충돌 409에서 최신 작업 복원과 미확인 상태 보존.
- 점검 응답 유실 후 같은 키 재시도, 이미 확인된 작업의 오래된 REST 응답 미삽입.

실제 Chrome은 PC 1440×1000·태블릿 820×1180에서 새 코드 발급, SSE 연결, 점검 작업 완료, 새로고침 세션·미확인 작업 복원, 상세 결과의 `financial_analysis_performed:false`, 두 탭 알림 확인 동기화, 로그아웃·같은 코드 재접속을 확인했다. 수평 넘침 검사와 `test-results/`의 `session-tasks.png` 캡처도 수행했다. 캡처·trace는 Git 제외 산출물이다.

## 재현과 한계

고정 도구 설치 및 일반 명령은 [실행 안내](../../frontend/README.md#실행)를 따른다. 실제 서버 E2E는 Compose 백엔드 실행 후 PowerShell에서 `$env:LOANSIGHT_LIVE_API = '1'`을 설정하고 `pnpm test:e2e`로 실행한다. 미설정 시 실제 API 시나리오 2개는 skip된다. 백엔드 테스트 환경변수와 분리 인프라는 [백엔드 검증 안내](../../backend/README.md#검증)를 따른다.

실제 장시간 세션 TTL 만료·네트워크 단절·cursor 한도 초과는 이번 브라우저 실행에서 강제하지 않았다. 해당 프론트 반응은 제어된 테스트로 검증했다. 실제 공시 수집·재무 분석·모델 추론·사용자별 검토 저장·운영 HTTPS/다중 replica 프록시·k3s 배포 검증은 이번 범위에 포함하지 않는다. 예시 검토 내용과 직접 입력은 기존 브라우저 기록이며 서버 사용자 코드로 분리되지 않는다.
