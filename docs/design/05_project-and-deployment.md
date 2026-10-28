# LoanSight AI — 프로젝트 구조·배포 설계

> v0.4 · 2026-10-28 · 설계 초안

이번 변경은 설계 목표의 개정이다. 실행 코드·DB 마이그레이션·실제 화면 구현 완료를 뜻하지 않는다.

[전체 아키텍처](../01_LoanSight_AI_Architecture_v0.4.md) / 코드 배치·공통 이미지·SaaS/Self-hosted·사용자 식별·운영

<a id="structure"></a>

## 프로젝트 디렉터리와 책임 원칙

초기에는 **단일 저장소(Monorepo) + 두 개의 애플리케이션 배포 이미지(Frontend, Backend)** 로 시작한다. API·Worker·Outbox Relay는 동일 Backend 이미지의 실행 명령만 다르게 한다. PostgreSQL과 RabbitMQ는 별도 인프라 이미지 또는 외부 서비스로 제공한다.

아래는 구현 목표 구조다. 현재 구현 범위와 실행 환경은 [저장소 README](../../README.md)를 확인한다. 로컬 `docs/`에는 코드와 함께 변경하는 산식·규칙·데이터·API 계약을 두고, 기획·수행일지·제출·발표 자료는 별도 docs 저장소에서 관리한다.

프론트엔드 의존성과 실행 스크립트는 **pnpm**으로 관리하고 `package.json`·`pnpm-lock.yaml`을 함께 버전 관리한다. pnpm과 Node.js 버전은 초기화 시 명시하며 CI·이미지 빌드는 고정된 lockfile을 사용한다. UI별 라이브러리 구성은 [화면·검토 설계](04_ui-and-review.md#frontend-stack)를 따른다.

백엔드 의존성과 실행 환경은 **[uv](https://docs.astral.sh/uv/)**로 관리하고 `pyproject.toml`·`uv.lock`을 함께 버전 관리한다. Python·uv 버전과 패키지 호환 범위는 초기화 시 명시하며 CI·이미지 빌드는 고정된 lockfile을 사용한다. API·Worker·Outbox Relay는 같은 의존성 구성을 사용한다.

```text
loansight-ai/
├── frontend/                         # React + Vite SPA
│   ├── src/
│   │   ├── app/                      # 앱 설정, 라우팅, QueryClient
│   │   │   ├── router.tsx
│   │   │   ├── providers.tsx
│   │   │   └── task-events.tsx       # 앱 공통 SSE 연결·복원
│   │   ├── pages/                    # 화면 단위 진입점
│   │   ├── features/                 # 기능 단위 UI/상태/Query
│   │   │   ├── company/
│   │   │   ├── disclosure/
│   │   │   ├── financial/
│   │   │   ├── analysis/
│   │   │   ├── tasks/               # GNB 작업 목록·진행 상태·알림 확인
│   │   │   ├── evidence/
│   │   │   ├── risk/
│   │   │   ├── prediction/
│   │   │   ├── review/
│   │   │   └── news/                 # 후순위
│   │   └── shared/
│   │       ├── api/                  # 공통 HTTP 클라이언트
│   │       ├── components/
│   │       ├── hooks/
│   │       ├── types/
│   │       └── utils/
│   ├── public/
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   ├── pnpm-lock.yaml
│   └── vite.config.ts
│
├── backend/                          # FastAPI + Python Worker
│   ├── app/
│   │   ├── main.py                  # FastAPI 진입점
│   │   ├── modules/                 # 기능별 업무·분석 로직
│   │   │   ├── company/             # 기업 검색, 업종 판정·override 이력
│   │   │   ├── disclosure/          # 보고서/공시 메타데이터
│   │   │   ├── financial/           # 직접 입력 revision, 재무 정규화·산식·지표
│   │   │   ├── evidence/            # 주석 추출, 근거 위치, 사실 검증
│   │   │   ├── risk/                # 규칙 기반 현재 위험징후
│   │   │   ├── prediction/          # 미래 사건 예측 비즈니스 로직
│   │   │   │   ├── service.py
│   │   │   │   ├── ports.py         # Predictor 인터페이스
│   │   │   │   └── schemas.py
│   │   │   ├── analysis/            # 분석 실행, 결과 스냅샷
│   │   │   ├── tasks/               # 사용자별 작업 연결, 목록·이벤트·확인 상태
│   │   │   ├── benchmark/           # 업종 비교
│   │   │   ├── review/              # 검토 항목·메모
│   │   │   └── news/                # 후순위
│   │   ├── integrations/            # 외부 시스템·모델 어댑터
│   │   │   ├── messaging/           # RabbitMQ 발행·구독 어댑터
│   │   │   ├── statistics/          # 한국은행 기업경영분석 공식 자료 수집/수입
│   │   │   ├── dart/
│   │   │   │   ├── client.py
│   │   │   │   └── collector.py
│   │   │   ├── llm/
│   │   │   │   ├── ports.py         # StructuredLlm, AgentRuntime
│   │   │   │   ├── gateway.py       # 공급자 선택·라우팅
│   │   │   │   └── providers/
│   │   │   │       ├── codex.py
│   │   │   │       └── openai_api.py
│   │   │   └── ml/
│   │   │       ├── local.py         # 로컬 모델 로딩·추론
│   │   │       └── remote.py        # 원격 추론 API
│   │   ├── worker/
│   │   │   ├── main.py              # Worker 진입점
│   │   │   └── tasks/               # 단계별 분석 작업
│   │   ├── messaging/
│   │   │   ├── outbox_relay.py      # Outbox 전달·발행 확인·재시도
│   │   │   └── notifications.py     # LISTEN/NOTIFY 수신·연결 복구
│   │   └── core/
│   │       ├── config.py
│   │       ├── database.py
│   │       ├── storage.py           # 저장소 Port 및 구현 연결
│   │       └── errors.py
│   ├── migrations/                   # Alembic
│   ├── tests/
│   ├── pyproject.toml
│   ├── uv.lock
│   └── Dockerfile
│
├── deploy/
│   ├── compose.yaml                  # Self-hosted / 로컬 운영
│   └── k8s/
│       ├── base/                     # Deployment, Service 등
│       └── overlays/
│           └── saas/                 # SaaS 설정(Kustomize)
│
├── scripts/                          # 설치, 업그레이드, 백업, 복구
├── docs/                             # 산식, 규칙, 데이터·API 계약
├── .env.example
└── README.md
```

**구조 원칙**

1. `modules/*`에는 **무엇을 분석하고 어떤 결과를 반환할지**에 관한 기능을 둔다.
2. `integrations/*`에는 **외부 시스템 또는 모델을 어떻게 호출할지**를 둔다.
3. `worker/*`는 기존 모듈을 조합해 실행하며, 별도의 두 번째 비즈니스 로직을 만들지 않는다.
4. 기능이 작으면 `service.py` 등 최소 파일부터 시작한다. 모든 모듈에 계층 구조를 강제하지 않는다.
5. 모델 파일·추론 API·입력 스키마·전처리 산출물·검증 결과는 외부에서 제공받고 운영 Adapter에서 버전 호환성을 확인한다. 모델 개발용 코드·데이터셋·파이프라인은 이 저장소에 두지 않는다.

<a id="backend-stack"></a>

## 백엔드 라이브러리 구성

아래 구성을 구현 기준으로 채택한다. 현재 사용하는 패키지와 고정 버전은 `backend/pyproject.toml`·`backend/uv.lock`에서 관리하며, 후속 기능의 의존성은 해당 기능 구현 시 추가한다.

| 용도 | 라이브러리·도구 | 적용 범위 |
|---|---|---|
| API·서버 실행 | FastAPI + Uvicorn | REST API와 서버 프로세스 실행 |
| 데이터 검증 | Pydantic | 요청·응답, 외부 데이터, LLM 구조화 출력 검증 |
| 환경설정 | pydantic-settings | 환경변수 기반 설정 로딩·검증 |
| DB 접근 | [SQLAlchemy 2.x](https://docs.sqlalchemy.org/en/20/dialects/postgresql.html) (`sqlalchemy[asyncio]`) | 데이터 모델·비동기 쿼리·트랜잭션 |
| PostgreSQL 드라이버 | [Psycopg 3](https://www.psycopg.org/psycopg3/docs/advanced/async.html) | DB 연결과 전용 LISTEN/NOTIFY 연결 |
| DB 마이그레이션 | [Alembic](https://alembic.sqlalchemy.org/en/latest/) | 스키마 변경 이력·적용 |
| RabbitMQ 통신 | [aio-pika](https://docs.aio-pika.com/apidoc.html) | 발행·구독, 수동 ACK, publisher confirm, 재연결 |
| SSE | [FastAPI 내장 SSE](https://fastapi.tiangolo.com/reference/sse/) | EventSourceResponse·ServerSentEvent로 진행 이벤트 전달 |
| 외부 HTTP 통신 | [HTTPX](https://www.python-httpx.org/) | DART·외부 API·원격 추론 서버 비동기 호출 |
| 외부 호출 재시도 | [Tenacity](https://tenacity.readthedocs.io/en/latest/) | 일시 오류에 제한된 횟수·backoff 적용 |
| 문서 파싱 | [lxml](https://lxml.de/parsing.html) | 공시 XML·HTML의 문단·표 추출 |
| 로그 | [structlog](https://www.structlog.org/en/stable/) | analysis_run_id·job_id를 포함한 구조화 로그 |
| 테스트 | [pytest](https://docs.pytest.org/en/stable/) + pytest-asyncio + HTTPX | 계산·비동기 처리·API 검증 |
| 코드 품질 | [Ruff](https://docs.astral.sh/ruff/) | 린트·포맷 통일 |

FastAPI는 내장 SSE를 지원하는 버전을 선택한다. SQLAlchemy의 요청·작업별 세션과 Psycopg의 전용 LISTEN 연결은 분리한다. MQ 클라이언트의 재연결과 별개로 작업의 멱등성·임대·이벤트 재생은 [API·작업 처리 계약](02_api-and-jobs.md#mq)에 따라 구현한다. Tenacity는 재시도해도 안전한 외부 호출의 일시 오류에만 적용하고 분석 작업 전체의 재시도는 DB·Outbox로 관리한다.

금액·재무 계산은 표준 라이브러리 `Decimal`을 사용한다. `pandas`·`openpyxl`은 데이터 가공·엑셀 입출력 요구가 생길 때 추가한다. LLM 공급자 SDK와 모델 추론 런타임은 [외부 연동 계약](03_ai-integration.md)에 맞춰 선택하며 모델 학습용 의존성은 기본 구성에 포함하지 않는다.

<a id="deployment"></a>

## SaaS와 Self-hosted 배포

**애플리케이션 코드 및 이미지는 동일하게 유지하고 배포 설정만 분리한다.**

### 공통 빌드 아티팩트

1. `frontend` 이미지: Vite 빌드 산출물을 Nginx 등 정적 웹 서버로 제공.
2. `backend` 이미지: FastAPI·Python Worker·Outbox Relay가 동일 코드·의존성을 사용하고 **시작 명령만 다름**.
3. PostgreSQL: 환경에 따라 컨테이너 DB 또는 관리형/외부 DB를 사용.
4. RabbitMQ: 별도 인프라 이미지 또는 외부 브로커를 사용하며 큐·메시지 영속성을 설정한다. 단일 브로커의 영속화와 고가용성 복제는 구분하고 SaaS의 HA 구성은 운영 요구에 맞춰 확정한다.

### 배포별 대응

| 구성 | Docker Compose (Self-hosted) | k3s (SaaS) |
|---|---|---|
| Frontend | `frontend` 서비스 | Deployment + Service |
| FastAPI | `api` 서비스 | Deployment + Service |
| Worker | `worker` 서비스 | Deployment |
| Outbox Relay | `outbox-relay` 서비스(고아 작업 복구 역할 포함) | 별도 Deployment, 동일 Backend 이미지 |
| PostgreSQL | 로컬 DB 컨테이너 | 별도/관리형 DB 또는 StatefulSet |
| RabbitMQ | `rabbitmq` 서비스 + 영속 볼륨 | 외부 브로커 또는 영속 저장소를 갖춘 운영 구성 |
| 원본 파일 | 바인드 마운트/볼륨 | PVC, 이후 S3 호환 저장소 선택 가능 |
| 라우팅 | Nginx `/`·`/api`, SSE 버퍼링 해제 | Traefik Ingress `/`·`/api`, SSE 스트리밍·timeout 설정 |
| 설정 | `.env` | ConfigMap + Secret |
| DB 마이그레이션 | 설치·업데이트 시 단발 실행 | 별도 Job으로 단발 실행 |

### k3s 전환을 위한 필수 조건

- **API는 Stateless**: 요청 사이의 업무 상태를 API 프로세스 메모리에만 두지 않는다.
- **Worker는 Stateless**: 작업 진행상태와 결과를 DB/저장소에 보관한다.
- 내부 호출 시 Compose 컨테이너 이름을 비즈니스 코드에 하드코딩하지 않고 **환경변수로 연결**한다.
- 브라우저는 API 절대 호스트를 알 필요 없이 **동일 출처의 `/api` 경로**로 호출한다.
- 로컬 파일 저장 경로를 모듈에 직접 결합하지 않고 Storage Adapter 뒤로 숨긴다.
- DB 마이그레이션을 API 기동에 무조건 묶지 않는다(다중 Replica 충돌 방지).
- Readiness/Liveness 확인 엔드포인트를 제공한다.
- API Replica마다 LISTEN 연결을 두고 프로세스 내부의 SSE 연결만 관리한다. 상태·재생 cursor는 DB에 두어 다른 Replica에서도 재연결할 수 있게 한다.
- 브로커 연결 주소·자격증명·큐 설정은 환경변수/Secret로 주입한다. 종료 시 Worker는 신규 소비를 중단하고, 진행 작업을 마무리하거나 재전달·임대 복구가 가능하게 종료한다.
- 다중 노드 k3s에서는 노드 종속 로컬 PVC 문제를 검토하고, 필요시 객체 저장소로 이전한다.

### Self-hosted 설치

- Docker Compose 패키지와 사전 빌드 이미지를 제공한다.
- `.env.example`, 초기 실행, 업데이트, 백업·복구 스크립트를 둔다.
- 개발자용 Node.js/Python 런타임 설치 없이 컨테이너를 구동할 수 있게 한다(Docker는 필요).
- 데이터를 컨테이너 삭제와 무관한 볼륨에 보관한다.
- RabbitMQ를 Compose 설치에 포함하고 브로커 영속 볼륨·초기 자격증명 설정을 제공한다. 브로커 장애 중에도 DB에 접수된 미발행 작업은 Outbox로 보존한다.
- OpenDART 및 외부 LLM의 키·인증은 **설치 환경별**로 설정한다.
- 데이터 복구 시 DB와 원본 파일, 관련 설정을 일관되게 복원한다.

### HTTPS와 PWA

- SaaS 공개 접속은 HTTPS를 제공한다.
- Self-hosted 초기 설치는 로컬 HTTP 접근을 우선한다. 원격 다중 기기에서 운영할 경우 HTTPS 도입을 별도로 안내한다.
- **PWA 설치, Service Worker 오프라인 모드, 푸시·동기화는 현재 구현 범위에서 제외**한다.
- 대신 초기부터 PC/태블릿 반응형 UI를 구현한다.

<a id="identity"></a>

## 사용자·Workspace 식별과 접근 범위

**초기 사용자 구분은 5자리 숫자 코드로 제공한다.** 정식 회원가입·로그인은 후속 도입하되 내부 사용자 ID와 데이터 소유 관계는 처음부터 유지한다.

### 코드 발급·재접속

- `user_code`는 `^[0-9]{5}$` 형식의 문자열이다. `00427`처럼 앞의 0을 보존하고 숫자형으로 변환하지 않는다. 한 설치 환경 안에서 유일하게 발급한다.
- 새 사용자 시작 시 서버가 암호학적 난수로 코드를 자동 발급한다. DB 유니크 제약으로 동시 발급 충돌을 처리하고 재시도한다. 삭제·비활성 코드도 다른 사용자에게 재발급하지 않는다. 코드 공간이 소진되면 발급을 중단하며 무한 재시도하지 않는다.
- 기존 코드를 입력하면 같은 내부 `user_id`로 새 세션을 발급한다. 잘못된 형식·미발급·비활성 코드는 접속시키지 않으며, 잘못 입력한 코드를 새 사용자로 자동 생성하지 않는다.
- 같은 코드로 여러 기기·브라우저의 동시 접속을 허용한다. 세션은 각각 발급하지만 같은 사용자/Workspace의 작업·메모·체크 상태를 함께 조회·수정한다. 두 사람을 별도 사용자로 구분하지 않으며 동시 메모 편집은 revision 충돌 검사로 보호한다.
- 내부 키는 불변 `user_id`로 두고 코드는 선택/재접속 수단으로만 사용한다. 최초에는 사용자별 기본 Workspace 하나를 만들고 입력·분석 연결·체크·메모·알림 상태를 이 소유 범위에 저장한다.

### 세션·데이터 접근

- 코드 진입 후 서버는 충분히 긴 불투명 난수 세션을 발급하고 `user_session`을 DB에 저장한다. 서버에는 토큰 해시·사용자/Workspace·만료/폐기 상태를 보관하고 쿠키에는 원본 토큰만 담는다. 5자리 코드를 세션 토큰으로 사용하지 않는다.
- 동일 출처의 `HttpOnly`, `SameSite=Lax`, `Path=/` 쿠키로 REST와 SSE를 함께 식별한다. HTTPS 운영에서는 `Secure`를 적용하고 로컬 HTTP는 별도 개발 설정으로 구분한다. 쓰기 요청의 Origin을 검증하며 코드·세션 토큰을 URL이나 localStorage에 넣지 않는다.
- 세션 쿠키의 유효 기간 안에서는 새로고침·브라우저 재실행 후에도 현재 사용자를 조회해 복원한다. 세션이 없거나 만료됐으면 코드를 다시 입력한다. 보존 기간은 설정으로 관리한다.
- 서버는 `/me`, 분석 접근, 검토, SSE 재생·알림 확인 모두에서 세션의 사용자/Workspace를 기준으로 소유 범위를 검사한다. 요청에 담긴 사용자 ID나 코드를 그대로 신뢰하지 않는다.
- 사용자 전환 시 현재 기기 세션을 교체하고 이전 SSE·Query 캐시·화면 상태를 비운다. 로그아웃은 현재 세션을 폐기하고 쿠키를 지우며 다른 기기의 세션은 유지한다. 서버는 만료·폐기된 세션의 열린 SSE도 종료하고 재접속을 거부한다.
- 기업 기본정보·공개 공시·동일 조건 공통 분석은 공유할 수 있지만 사용자 입력·메모·체크·작업 연결·알림 확인 상태는 사용자별로 분리한다.

### 초기 범위와 정식 로그인 전환

5자리 코드는 총 100,000개 조합의 간편 진입 수단으로, **코드를 아는 사람은 해당 사용자로 접속할 수 있다.** 긴 세션 쿠키는 접속 후 세션을 보호하며 코드 추측 자체를 해결하지 않는다. 초기 내부 사용을 전제로 발급·진입 요청에 IP/코드/전체 단위 시도 제한을 적용하고 실패 응답은 동일하게 처리한다. 이 코드만으로 민감한 사용자 데이터를 공개 SaaS에 보호하는 인증을 충족했다고 간주하지 않는다.

정식 로그인 도입 시 인증 계정을 기존 `user_id`에 검증된 절차로 연결해 데이터 FK·작업·메모·알림 이력을 유지한다. 이때 코드 진입을 계속 열어 두면 로그인을 우회할 수 있으므로 연결된 사용자는 코드만으로 접속할 수 없게 한다. 계정 연결의 본인 확인·복구 방식, 세션 유효 기간·시도 제한 수치는 후속 결정 사항이다.

기술 동작 참고: [Python secrets](https://docs.python.org/3/library/secrets.html), [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [진입 시도 제한](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#login-throttling).

<a id="operations"></a>

## 운영·복구·관찰 항목

- DB 및 원본 파일 백업, 복구 테스트.
- API와 Worker 로그에 `analysis_run_id`·`job_id`를 연결.
- Outbox 지연·발행 실패, 큐 적체·미확인 메시지, 재시도·DLQ, Worker heartbeat·실행 임대, SSE 연결 수·재생 실패를 관찰한다.
- Outbox Relay 역할에 실행 임대 만료·고아 작업 복구 루프를 포함한다. 현재 attempt의 소유권을 회수하고 새 실행 세대의 Outbox를 원자적으로 생성하며, 지연 도착한 이전 세대 메시지·결과는 무시한다.
- 이벤트 보관 기간·최대 재생량·완료 알림 보관 정책을 설정한다. 브로커 복구 시 DB·Outbox와의 불일치 및 중복 전달을 점검하고 미완료 작업을 조정한다.
- 외부 API 타임아웃·재시도·쿼터 처리.
- SaaS에서는 익명 대량 호출로 발생하는 작업·LLM 비용을 통제할 최소한의 제한을 추가.
- 환경변수·Secret로 API 키 관리. 인증정보를 Docker 이미지·Git 저장소에 넣지 않음.

- N-F27은 키 서버 관리·사용자별 접근·요청/작업/LLM 비용 제한·분석 캐시·버전/비용/실행 절차·로그를 다룬다. 초기 식별은 코드+세션이며 정식 로그인·한도 수치·뉴스 이용 조건은 후속 결정 사항이다. PWA·OS 푸시, PDF 출력·지점 운영과 추가 업종/비상장 자동 수집은 초기 기능으로 표시하지 않는다.

## 개정 이력

| 버전 | 개정일 | 변경 |
|---|---|---|
| v0.3 | 2026.10.27 | 이전 설계 기준, Git 이력 보존 |
| v0.4 | 2026.10.28 | 최신 기획 연결·내부 관리 분리·기존 동작 계약 보존 |
