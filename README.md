# LoanSight AI — 실행 코드

기업 여신 검토를 지원하는 공시 기반 재무·주석·위험징후 분석 서비스 **LoanSight AI**의 실행 코드와 운영 환경을 관리하는 저장소입니다.

- 팀: KB Bridge 4조참치 · 프로젝트명 확정: 2026-10-22
- 기획 기준: 기획안 v2.0 · 요구사항/PRD/기능명세서 v0.0.4 · WBS v1.1
- 현재 상태: 백엔드 실행 기반 구현 시작. FastAPI·DB 연결·상태 확인 API를 제공하며 업무 기능은 아직 구현하지 않았습니다.
- 구현 기준: [전체 시스템 아키텍처 v0.3](docs/01_LoanSight_AI_Architecture_v0.3.md)

## 서비스 범위

기업·보고서 선택 → 수집/직접 입력 → 재무·주석 분석 → 현재 위험징후·외부 모델 예측 → 담당자 체크·검토 메모로 이어집니다. 제조·건설·도소매·부동산 임대 4개 업종을 대상으로 합니다.

**AI 모델 학습은 이 저장소에서 진행하지 않습니다.** 외부 모델 파일/추론 API와 제공된 검증 결과를 연동합니다. 예측 조건이 충족되지 않으면 확률을 보류하고, 최종 여신 판단은 담당자가 수행합니다.

초기 사용자는 서버가 발급한 **5자리 숫자 코드**로 구분하고 서버 세션으로 작업·메모를 복원합니다. 향후 정식 로그인은 기존 사용자 ID에 연결합니다. 코드만으로 진입하는 초기 사용 범위와 세부 규칙은 [사용자 식별 설계](docs/design/05_project-and-deployment.md#identity)를 따릅니다.

## 설계 문서

처음에는 전체 아키텍처를 읽고, 작업 주제에 맞는 문서를 참조합니다.

| 문서 | 내용 |
|---|---|
| [전체 아키텍처](docs/01_LoanSight_AI_Architecture_v0.3.md) | 시스템 목적·구성·주요 결정·상세 설계 안내 |
| [데이터·분석](docs/design/01_data-and-analysis.md) | 입력·원천·재무/위험규칙·비교·주석·논리 모델 |
| [API·작업 처리](docs/design/02_api-and-jobs.md) | API·캐시·RabbitMQ·Outbox·SSE·GNB 복구 |
| [AI 연동](docs/design/03_ai-integration.md) | LLM 요약·외부 모델 인수·추론·결과 표시 |
| [화면·검토](docs/design/04_ui-and-review.md) | 공통 UI·원문 열람·담당자 체크·초안 편집/재생성 |
| [프로젝트 구조·배포](docs/design/05_project-and-deployment.md) | 코드 구조·Compose/k3s·사용자 식별·운영 |
| [개발·검증 계획](docs/design/06_delivery-and-validation.md) | 구현 순서·기능 41개 연결·검수·미정 항목 |
| [커버리지 검토](docs/reviews/01_architecture-coverage-v0.3.md) | 기능 명세·화면설계서 대조 결과와 반영 위치 |

기획·수행일지·제출·발표 자료는 별도 [docs 저장소](https://github.com/loansight-ai/docs)에서 관리합니다. [기능 명세서](https://github.com/loansight-ai/docs/blob/main/01-planning/functions.md), [화면설계서 PDF](<docs/02_LoanSight AI_화면설계서_v0.0.2_261026.pdf>), [최신 문서·원문](https://app.notion.com/p/40080be201ba8159ae7fcd1aebce0000), [WBS v1.1](https://app.notion.com/p/3ff80be201ba80618c52cb61cc4a6153)을 연결합니다.

## 구현·실행

React + Vite + TypeScript, FastAPI·Python Worker, PostgreSQL, RabbitMQ와 SSE를 사용합니다. Frontend/Backend 공통 이미지를 Compose 설치형과 k3s SaaS에서 운영하는 방향입니다. 실제 기업 보고서 한 건의 수집부터 화면 조회까지 연결하는 기능부터 구현합니다.

패키지 관리는 프론트엔드 **pnpm**, 백엔드 **uv**를 사용합니다. 상세 라이브러리는 [프론트엔드 구성](docs/design/04_ui-and-review.md#frontend-stack)과 [백엔드 구성](docs/design/05_project-and-deployment.md#backend-stack)을 따릅니다.

백엔드 의존성·버전·설정·실행·검증 명령은 [백엔드 실행 안내](backend/README.md)에서 관리합니다. 프론트엔드와 분석 파이프라인은 후속 구현입니다.

Docker Desktop 실행 후 저장소 루트에서 `docker compose -f deploy/compose.yaml up -d --build --wait`로 API와 PostgreSQL을 함께 시작합니다. 자세한 접속·종료·포트 설정은 [Compose 실행 안내](backend/README.md#api와-db-함께-실행-권장)를 참고합니다.

## 협업

[협업 규칙](CONTRIBUTING.md)에 따라 Issue·작업 브랜치·PR로 변경을 관리합니다. 이 저장소의 `docs/`는 구현 설계·참조 화면설계서·검토 기록을 관리하며 기획 원본을 중복 편집하지 않습니다.

자동화 작업의 저장소 지침은 [AGENTS.md](AGENTS.md)를 따릅니다.

## 개정 이력

| 개정일 | 변경 |
|---|---|
| 2026-10-22 | LoanSight AI 소개 |
| 2026-10-24 | 기획안 v2.0·요구사항 v0.0.4·WBS v1.1 반영 |
| 2026-10-27 | 아키텍처 v0.3·MQ/SSE·외부 모델 경계 반영, 주제별 설계 문서로 분리 |
