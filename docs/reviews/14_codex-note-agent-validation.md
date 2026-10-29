# Codex 주석 보완 탐색 연동 검증

검증일: 2026-10-29. 브랜치 `feat/note-evidence-search`. 구현 계약·실행·인증은 [Codex 보완 탐색](../../backend/README.md#note-agent), 전체 목표는 [AI 연동 설계](../design/03_ai-integration.md#evidence-search)를 따른다.

## 변경 범위

공급자 중립 AgentRuntime과 Codex App Server stdio 어댑터를 추가했다. 기존 검색 도구를 항목별로 호출하고, 서버에서 조회 범위·호출 제한·인용을 검증한다. NOTE_AGENT 작업·Outbox·lease·결과 저장·사용자별 조회와 화면의 실행·복원·인용 이동을 연결했다. OpenAI API 어댑터·사용자별 SaaS Codex 인증·담당자 사실 검수 저장은 포함하지 않는다.

## 실행 결과

| 검증 방법 | 기대 결과 | 실제 결과 |
|---|---|---|
| Codex 어댑터·검색 도구·Worker 취소 단위 테스트 | 도구 요청/응답, 최종 JSON, 인증 누락, 예상 밖 승인/실행, 다른 thread 차단, timeout·lease 상실 취소 | 10개 통과. 선택적인 실제 CLI 테스트는 환경변수 없는 실행에서 1개 skip |
| 실제 Windows Codex CLI 0.165.0, 빈 전용 인증 홈 | 초기 JSON-RPC 연결 후 인증 필요 처리. 모델 호출 없음 | `test_codex_runtime.py` 7개 통과; 위 단위 테스트와 중복 포함 |
| PostgreSQL 검색·에이전트 통합 테스트 | 실제 검색/문맥/인용 검증, 여섯 항목 저장, 같은 실행 재사용, 동시 등록, 원문 불일치·반복·도구 오류·시간/호출 제한, Workspace·Origin 차단, 기본 검색 보존 | `test_note_agent.py` 8개와 기존 `test_note_search.py` 3개, 총 11개 통과. 모델 응답만 FakeRuntime으로 대체 |
| PostgreSQL·RabbitMQ 마이그레이션 및 Worker 회귀 | upgrade→모델 차이 없음→downgrade, 기존 작업·lease·재시도 동작 유지 | `test_migrations.py`·`test_tasks.py` 총 9개 통과 |
| 프론트엔드 전체 Vitest | 기존 화면 유지, 보완 탐색 실행·복원·미완료/재실행·원문 이동·원문 hash 불일치 차단 | 11개 파일, 70개 테스트 통과 |
| TypeScript·ESLint·Vite build | 타입·lint·배포 빌드 성공 | 통과. 기존 대용량 청크 경고 표시 |
| Worker 이미지 빌드 및 Linux 일회용 컨테이너 | 일반 사용자에서 고정 버전 CLI 실행·App Server 초기 연결 | 빌드 성공, `codex-cli 0.165.0`, 인증 누락 처리 확인 |
| Ruff lint·변경 Python 파일 format·Git diff check | 변경 범위 정적 검사·공백 오류 없음 | 통과 |

통합 검증은 `deploy/compose.test.yaml`의 별도 `loansight_test` DB·RabbitMQ에서 실행했다. 테스트별 임시 스키마는 fixture가 정리했다. 초기 개발 DB 주소로 실행한 시도는 연결 오류로 실패했고 테스트 DB 구성으로 전환했다. 로컬 Python 환경에는 기존 lockfile에 있는 lxml·주석 패키지를 설치했다. Windows 샌드박스의 임시 경로·프로세스 실행 제약으로 실행 실패한 검사는 승인된 환경에서 다시 실행했으며 실패 시도를 통과로 계산하지 않았다.

저장소 전체 Ruff format 검사에는 변경하지 않은 `app/modules/company/catalog.py`, `tests/test_note_source_view.py`의 기존 형식 차이가 남는다. 이 두 파일은 수정하지 않았다.

## 남은 검증과 한계

자동 검증에서 실제 CLI 확인은 초기 연결과 인증 누락 처리까지 수행했다. 이후 로컬 테스트 환경에서 Codex 로그인 상태를 확인하고, Git 제외 `backend/.env`에 시험용 제한 180초·24회를 적용한 뒤 API·Worker를 재생성했다. 두 서비스의 활성화 상태와 Worker의 로그인 성공 여부를 확인했으며, 사용자는 화면에서 동작하는 것으로 보인다고 전달했다. 이를 보고서별 품질·비용·지연 평가나 자동 E2E 통과로 간주하지 않는다. 인증정보와 로컬 환경 파일은 커밋하지 않는다.

실제 모델의 탐색 이력·사실 후보 정확도에 대한 독립 검수, 새 화면의 브라우저 E2E·스크린샷 검토는 수행하지 않았다. 도구 호출 동적 API가 실험 기능이므로 CLI 버전 변경 시 프로토콜 회귀 검증이 필요하다. 로컬 시험 수치는 운영 정책이 아니며 운영 시간·호출 예산·합격 기준은 평가 후 결정한다.
