# LoanSight AI — 프로젝트 구조·배포 설계

> v0.3 · 2026-10-27 · 설계 초안

[전체 아키텍처](../01_LoanSight_AI_Architecture_v0.3.md) / 코드 배치·공통 이미지·SaaS/Self-hosted·사용자 식별·운영

<a id="structure"></a>

## 프로젝트 디렉터리와 책임 원칙

초기에는 **단일 저장소(Monorepo) + 두 개의 애플리케이션 배포 이미지(Frontend, Backend)** 로 시작한다. API·Worker·Outbox Relay는 동일 Backend 이미지의 실행 명령만 다르게 한다. PostgreSQL과 RabbitMQ는 별도 인프라 이미지 또는 외부 서비스로 제공한다.

아래는 구현 목표 구조다. 현재 저장소는 설계·협업 문서 단계이며 애플리케이션 골격·실행 환경은 아직 생성되지 않았다. 로컬 `docs/`에는 코드와 함께 변경하는 산식·규칙·데이터·API 계약을 두고, 기획·수행일지·제출·발표 자료는 별도 docs 저장소에서 관리한다.

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
│   │   │   ├── validation/          # 정답지·추출·계정·외부 보고서·사용자 실험 기록
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

**회원가입·로그인·익명 Workspace 토큰 등 구체적인 식별 방식은 아직 결정하지 않는다.** 이전에 논의한 랜덤 토큰 방식은 **확정된 요구사항이 아닌 검토안**이다.

현재 분리해서 생각할 데이터는 다음과 같다.

- **전역 공유 가능:** 기업 기본정보, 공개 공시 원본, 표준화 재무제표, 동일 조건의 공통 분석 결과.
- **사용자별 분리 필요:** 사용자가 선택한 기업 목록, 수동 입력 및 수정, 확인 체크리스트, 검토 메모.
- **사용자별 작업·알림:** 요청/관심 분석 연결, GNB 작업 목록, SSE 수신 범위, 완료·실패 알림 확인 상태.

**사용자별 GNB 작업 목록·SSE를 다중 사용자에게 공개하기 전, 또는 여러 사용자의 검토 데이터를 저장하기 전에는 최소한의 사용자·작업공간 식별과 서버 측 접근 범위 제한을 반드시 결정해야 한다.** 공개 공시 자체는 민감도가 낮아도 작업 요청 이력·메모·입력값과 서버 측 LLM API 키·실행 비용은 별도 보호 대상이다.

현재 구현에서는 인증 체계를 미리 복잡하게 설계하지 않는다. 사용자 식별이 확정되기 전까지는 개인별 검토 데이터를 여러 익명 이용자에게 공유하는 기능을 공개하지 않는다.

작업·알림 모델에는 사용자/Workspace 소유 범위를 표현한다. 초기 개발에서 단일 로컬 사용자를 사용할 수 있으나 공개 서비스의 식별·격리를 대신하지 않는다. 같은 사용자의 여러 기기 복구에는 지속적인 서버 측 식별이 필요하다. SSE 인증 방식은 식별 설계와 함께 확정하며, native EventSource의 사용자 정의 Authorization 헤더 제약을 고려해 동일 출처 세션 쿠키 등을 검토한다. 장기 인증 토큰을 URL에 넣지 않는다.

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

- N-F27은 키 서버 관리·사용자별 접근·요청/작업/LLM 비용 제한·분석 캐시·버전/비용/실행 절차·로그를 다룬다. 인증 방식·한도 수치·뉴스 이용 조건은 미정이다. PWA·OS 푸시, PDF 출력·지점 운영과 추가 업종/비상장 자동 수집은 초기 기능으로 표시하지 않는다.
