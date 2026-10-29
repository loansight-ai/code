# LoanSight AI — 실행 코드

기업 여신 검토를 지원하는 공시 기반 재무·주석·위험징후 분석 서비스 **LoanSight AI**의 실행 코드와 운영 환경을 관리하는 저장소입니다.

- 팀: KB Bridge 4조참치 · 프로젝트명 확정: 2026-10-22
- 기획 기준: 기획안 v2.2 · 요구사항 v0.0.6 · PRD/기능명세서 v0.0.5 · WBS v1.3
- 현재 상태: 사용자·세션·Outbox→RabbitMQ→Worker→DB→SSE와 프론트 작업 알림 연동 구현. [OpenDART 기업 검색·주간 원장 갱신·KSIC11 코드 연결](backend/README.md#기업-검색)과 기업별 사업보고서 선택을 구현했습니다. [원본 ZIP/XML·연결/별도 주석 HTML 자동 수집](backend/README.md#dart-원문-자동-수집)과 기존 주석 구조화 작업을 연결해 원문·구조화 결과·원문 구간을 저장하고 조회할 수 있습니다. 저장된 주석의 목차·구간·원문 열람과 강조를 연결했습니다. [핵심 재무 분석](backend/README.md#financial-api)은 정형 재무·주석 보완·DB 저장·요약 화면을 연결했습니다. 위험규칙·외부 모델·검토 내용의 서버 저장은 후속입니다.
- 구현 기준: [전체 시스템 아키텍처 v0.4](docs/01_LoanSight_AI_Architecture_v0.4.md)

주석 결과 화면에서 [공통 6항목 기본 검색](backend/README.md#note-search-api)을 실행해 근거 후보를 저장·추가 조회하고 원문으로 이동할 수 있습니다. [Codex 보완 탐색](backend/README.md#note-agent)은 서버 인증·실행 제한 설정 후 사용할 수 있으며, 인용을 검증한 사실 후보를 검수 전 상태로 저장합니다. OpenAI API 어댑터와 담당자 사실 검수 저장은 후속입니다.

핵심 재무 분석의 **주석 구조화·Codex 데이터 보완** 옵션을 선택하면 구조화 완료 후 미확보 계정 탐색·검증·재계산을 자동 진행하며, 보완값에서 구조화된 주석 셀을 열 수 있습니다. 실행·저장 계약은 [재무 주석 보완 안내](backend/README.md#financial-note-enrichment)를 따릅니다.

## 서비스 범위

기업·보고서 선택 → 수집/직접 입력 → 재무·주석 분석 → 현재 위험징후·외부 모델 예측 → 담당자 체크·검토 메모로 이어집니다. 제조·건설·도소매·부동산 임대 4개 업종을 대상으로 합니다.

**AI 모델 학습은 이 저장소에서 진행하지 않습니다.** 외부 모델 파일/추론 API와 사용 가능 상태를 연동합니다. 예측 조건이 충족되지 않으면 확률을 보류하고, 최종 여신 판단은 담당자가 수행합니다.

초기 사용자는 서버가 발급한 **5자리 숫자 코드**로 구분하고 서버 세션으로 작업·메모를 복원합니다. 향후 정식 로그인은 기존 사용자 ID에 연결합니다. 코드만으로 진입하는 초기 사용 범위와 세부 규칙은 [사용자 식별 설계](docs/design/05_project-and-deployment.md#identity)를 따릅니다.

## 설계 문서

처음에는 전체 아키텍처를 읽고, 작업 주제에 맞는 문서를 참조합니다.

| 문서 | 내용 |
|---|---|
| [전체 아키텍처](docs/01_LoanSight_AI_Architecture_v0.4.md) | 시스템 목적·구성·주요 결정·상세 설계 안내 |
| [데이터·분석](docs/design/01_data-and-analysis.md) | 입력·원천·재무/위험규칙·비교·주석·논리 모델 |
| [API·작업 처리](docs/design/02_api-and-jobs.md) | API·캐시·RabbitMQ·Outbox·SSE·GNB 복구 |
| [AI 연동](docs/design/03_ai-integration.md) | LLM 요약·외부 모델 인수·추론·결과 표시 |
| [화면·검토](docs/design/04_ui-and-review.md) | 공통 UI·원문 열람·담당자 체크·초안 편집/재생성 |
| [프로젝트 구조·배포](docs/design/05_project-and-deployment.md) | 코드 구조·Compose/k3s·사용자 식별·운영 |
| [개발·제공 동작 계획](docs/design/06_delivery-and-validation.md) | 구현 순서·현행 기능 37개 연결·검수·미정 항목 |
| [커버리지 검토](docs/reviews/01_architecture-coverage-v0.4.md) | 기능 명세·화면설계서 대조 결과와 반영 위치 |

기획·수행일지·제출·발표 자료는 별도 [docs 저장소](https://github.com/loansight-ai/docs)에서 관리합니다. [기능 명세서](https://github.com/loansight-ai/docs/blob/main/01-planning/functions.md), [화면설계서 PDF](<docs/02_LoanSight AI_화면설계서_v0.0.1.pdf>), [최신 문서·원문](https://app.notion.com/p/40080be201ba8159ae7fcd1aebce0000), [WBS v1.3](https://app.notion.com/p/3ff80be201ba80618c52cb61cc4a6153)을 연결합니다.

## 구현·실행

React + Vite + TypeScript, FastAPI·Python Worker, PostgreSQL, RabbitMQ와 SSE를 사용합니다. Frontend/Backend 공통 이미지를 Compose 설치형과 k3s SaaS에서 운영하는 방향입니다. 실제 기업 보고서 한 건의 수집부터 화면 조회까지 연결하는 기능부터 구현합니다.

패키지 관리는 프론트엔드 **pnpm**, 백엔드 **uv**를 사용합니다. 상세 라이브러리는 [프론트엔드 구성](docs/design/04_ui-and-review.md#frontend-stack)과 [백엔드 구성](docs/design/05_project-and-deployment.md#backend-stack)을 따릅니다.

백엔드 의존성·버전·설정·실행·검증 명령은 [백엔드 실행 안내](backend/README.md)에서 관리합니다. 프론트의 사용자·세션·작업 API 연동은 [프론트엔드 안내](frontend/README.md#서버-세션작업-연동)를 참고합니다. 실제 핵심 재무 분석은 [재무 API](backend/README.md#financial-api)를 사용합니다.

[재무제표 주석 구조화 패키지 사용방법](backend/app/modules/사용방법_dart_note_hierarchy-0.8.4-py3-none-any.md)의 v0.8.4 wheel을 pip로 설치할 수 있습니다. 연결·별도 주석 HTML의 번호 계층·본문·표 문맥과 선택적 당기·전기 표 연결을 제공합니다. 저장소 내 설치·실행은 [백엔드 안내](backend/README.md#note-hierarchy), 서비스 근거 데이터로 연결할 때의 경계는 [주석 설계](docs/design/01_data-and-analysis.md#note-hierarchy)를 따릅니다.

Docker Desktop 실행 후 저장소 루트에서 `docker compose -f deploy/compose.yaml up -d --build --wait`로 API·PostgreSQL·RabbitMQ·Worker·Relay를 함께 시작합니다. 마이그레이션은 별도 초기화 서비스가 적용합니다. 자세한 접속·종료·포트 설정은 [Compose 실행 안내](backend/README.md#api와-db-함께-실행-권장)를 참고합니다.

### Windows 시작·종료 스크립트

PowerShell 또는 명령 프롬프트에서 프로젝트 루트의 스크립트를 실행합니다. Windows PowerShell 5.1이 필요하며, 백엔드를 실행할 때는 Docker Desktop을 먼저 실행해 둡니다. 프론트엔드 최초 준비는 `.\setup-frontend.cmd`로 진행합니다([상세 안내](frontend/README.md#실행)).

| 명령 | 동작 |
|---|---|
| `.\setup-frontend.cmd` | 프론트엔드용 고정 Node.js·pnpm 및 lockfile 기준 의존성을 `.tools/`에 준비 |
| `.\start.cmd` | 백엔드와 프론트엔드 시작 |
| `.\start.cmd --backend` | 백엔드 5개 서비스 시작 |
| `.\start.cmd --frontend` | 프론트엔드만 시작 |
| `.\start.cmd --restart` | 양쪽 재시작 |
| `.\start.cmd --backend --restart` | 백엔드 5개 서비스 재시작 |
| `.\start.cmd --frontend --restart` | 프론트엔드만 재시작 |
| `.\stop.cmd` | 양쪽 종료 |
| `.\stop.cmd --backend` | 백엔드 5개 서비스 종료 |
| `.\stop.cmd --frontend` | 프론트엔드만 종료 |
| `.\start.cmd --help` / `.\stop.cmd --help` | 도움말 |

`--backend`와 `--frontend`는 상호 배타적입니다. 선택하지 않으면 양쪽을 대상으로 합니다. `--restart`는 시작 스크립트에서만 사용할 수 있습니다. 실행 중인 대상은 알림만 출력하며, `--restart`를 지정하면 재시작합니다. 종료된 대상을 다시 종료하면 이미 종료되었다고 안내합니다. 한쪽 실행 실패 시 다른 쪽도 처리하고 종료 코드 1을 반환합니다.

백엔드 5개 서비스는 API·PostgreSQL·RabbitMQ·Worker·Relay이며 종료·재시작 시 DB·MQ 볼륨을 유지합니다. 프론트엔드는 `frontend/package.json`의 Vite용 `dev` 스크립트를 실행합니다. 시작 스크립트는 `.tools/`의 프로젝트 전용 Node.js·pnpm을 우선 사용하고, 없으면 PATH의 도구를 확인합니다. 도구가 없거나 버전이 맞지 않으면 `.\setup-frontend.cmd`를 안내합니다. 프론트의 코드 접속·작업 알림은 백엔드에 연결되며 실제 핵심 재무 분석과 별도의 예시 분석 화면을 제공합니다.

기본 주소는 API `http://localhost:8000/docs`, 프론트엔드 `http://localhost:5173`입니다. PowerShell의 `$env:LOANSIGHT_API_PORT = '8001'`, `$env:LOANSIGHT_FRONTEND_PORT = '5174'`로 포트를 바꿀 수 있습니다. 이미 실행 중인 대상의 포트를 바꾸려면 `--restart`를 함께 사용합니다.

프론트엔드는 숨겨진 백그라운드 프로세스로 실행하며 로그와 프로세스 정보는 Git에서 제외한 `.run/`에 저장합니다. 종료 시 이 스크립트가 시작한 프로세스와 자식들만 종료합니다. 별도 터미널에서 실행한 프론트엔드나 다른 프로그램이 포트를 사용하면 자동 종료하지 않고 충돌을 안내합니다. `.ps1` 진입점도 제공하며, 실행 정책에 막히면 위 `.cmd` 진입점을 사용합니다. `.cmd`는 해당 프로세스에만 실행 정책을 적용합니다.

스크립트 검증은 Python 환경에서 루트의 `python -m unittest discover -s scripts/tests -v`로 실행합니다. 격리된 테스트 폴더와 HTTP 서버로 옵션·도구 탐색·프로세스 관리를 검증합니다. 프로젝트 전용 도구로 실제 Vite 시작·재시작·종료와 HTTP 200을 확인한 결과는 [프론트엔드 시작 검증](docs/reviews/03_frontend-startup-toolchain-validation.md)을 참고합니다. Compose 백엔드 검증은 [백엔드 검증 기록](docs/reviews/02_sessions-and-pipeline-validation.md)을 따릅니다.

### 프론트엔드 실행

프론트엔드 실행 방법·고정 버전·구현 범위·검증 결과는 [frontend/README.md](frontend/README.md)에서 관리합니다.

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm dev
```

Node.js 24.22.1·pnpm 10.34.9가 필요합니다. 기본 화면은 실제 DART 기업 검색을 제공하며 `/?data=demo`에서는 가상 기업·수치로 분석 화면을 둘러볼 수 있습니다. 서버 세션·작업 알림은 연결됐습니다. 실제 공시 수집·주석 구조화 결과의 화면 조회·위험 판정·모델 추론은 후속 구현입니다.

## 협업

[협업 규칙](CONTRIBUTING.md)에 따라 Issue·작업 브랜치·PR로 변경을 관리합니다. 이 저장소의 `docs/`는 구현 설계·참조 화면설계서·검토 기록을 관리하며 기획 원본을 중복 편집하지 않습니다.

자동화 작업의 저장소 지침은 [AGENTS.md](AGENTS.md)를 따릅니다.

## 개정 이력

| 개정일 | 변경 |
|---|---|
| 2026-10-22 | LoanSight AI 소개 |
| 2026-10-24 | 기획안 v2.0·요구사항 v0.0.4·WBS v1.1 반영 |
| 2026-10-27 | 아키텍처 v0.3·MQ/SSE·외부 모델 경계 반영, 주제별 설계 문서로 분리 |
| 2026-10-28 | 최신 기획·OFS·개별/복합 위험·주석 연결과 내부 관리 분리. 설계 v0.4, 실제 Figma v0.0.2는 편집 한도로 미완료 |

팀 품질관리 자료는 [별도 Notion 페이지](https://app.notion.com/p/40680be201ba81ddb717d75d409cde98)에서 관리한다. 설계 목표의 갱신이며 위 실제 구현 상태를 바꾸지 않는다.

문서 개정 Issue·PR: https://github.com/loansight-ai/code/issues/15 · https://github.com/loansight-ai/code/pull/16
