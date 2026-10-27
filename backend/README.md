# LoanSight AI Backend

[Issue #9](https://github.com/loansight-ai/code/issues/9)의 실행 기반과 [Issue #11](https://github.com/loansight-ai/code/issues/11)의 사용자·세션·비동기 작업 흐름을 제공합니다.

Python **3.12.15**, uv **0.13.5**를 사용합니다. 의존성 범위는 `pyproject.toml`, 실제 설치 버전은 `uv.lock`에서 관리합니다. 사용자 식별·해시 세션·접근 범위·Outbox·RabbitMQ·Worker·Relay·SSE를 구현했습니다. 실제 DART 수집·재무 분석·외부 모델 연동은 후속 구현입니다. 목표 구조와 후속 순서는 [프로젝트 설계](../docs/design/05_project-and-deployment.md), [개발 계획](../docs/design/06_delivery-and-validation.md#roadmap)을 따릅니다.

## 로컬 실행

저장소 루트에서 PowerShell로 실행합니다. PostgreSQL은 별도로 준비하고 연결 주소를 `backend/.env`에 입력합니다. 예시 비밀번호는 로컬 설명용입니다.

```powershell
cd backend
Copy-Item .env.example .env
# .env의 LOANSIGHT_DATABASE_URL을 실제 개발 DB 주소로 수정
uv sync --frozen
uv run --frozen alembic upgrade head
uv run --frozen python -m app app.main:app --reload
```

`.env` 경로는 현재 작업 디렉터리 기준이므로 `backend/`에서 실행합니다. 배포에서는 환경변수로 설정을 주입합니다. DB URL은 `postgresql+psycopg://` 형식과 host·database가 필수입니다. `LOANSIGHT_DATABASE_TIMEOUT_SECONDS`는 연결 및 readiness 확인 제한 시간(기본 3초, 0초 초과·60초 이하)인 기술 설정이며 업무 정책 수치가 아닙니다.

Windows에서는 Psycopg가 Selector 이벤트 루프를 요구하므로 위 `python -m app` 진입점을 사용합니다. 네이티브 실행은 PostgreSQL을 별도로 준비해야 하며, 전체 작업 흐름은 아래 Compose 실행을 권장합니다.

| 경로 | 동작 |
|---|---|
| `GET /api/v1/health/live` | DB 연결 없이 프로세스 응답 확인, 200 |
| `GET /api/v1/health/ready` | DB `SELECT 1` 성공 시 200, 연결 오류·시간 초과 시 503 |
| `/docs` | 현재 구현 API의 OpenAPI 문서 |

Readiness는 현재 DB 연결만 확인합니다. 업무 스키마·MQ·분석 처리 준비 여부를 보장하지 않습니다. API 시작 시 DB 연결이나 마이그레이션을 실행하지 않으므로 DB 장애에도 liveness는 응답합니다.

## 마이그레이션

`backend/`에서 별도 명령으로 실행하며 API 기동에 묶지 않습니다.

```powershell
uv run --frozen alembic heads
uv run --frozen alembic upgrade head
```

초기 revision `adaf5b89c881`은 사용자·Workspace·세션·시도 제한·작업·Outbox·사용자 작업 연결·이벤트 테이블을 생성합니다. 모델을 추가할 때 `migrations/env.py`에 모델 import를 등록하고 `uv run --frozen alembic revision --autogenerate -m "설명"`으로 생성한 내용을 검토한 뒤 적용합니다. `Database.transaction()`은 작업 단위로 세션을 만들고 정상 종료 시 커밋, 오류 시 롤백합니다.

## API와 DB 함께 실행 (권장)

Docker Desktop을 실행한 다음 **저장소 루트**에서 아래 명령을 실행합니다. PostgreSQL·RabbitMQ·API·Worker·Relay를 함께 만들고 5개 서비스가 healthy가 될 때까지 기다립니다. 별도 `migrate` 서비스가 DB 준비 후 마이그레이션을 단발 적용하고 API·Worker·Relay는 성공을 확인한 뒤 시작합니다. Compose는 개발 기본값과 선택적인 `backend/.env`를 읽습니다([설정 우선순위](#dotenv-compose)).

```powershell
docker compose -f deploy/compose.yaml up -d --build --wait
curl.exe http://localhost:8000/api/v1/health/ready
```

성공 응답은 HTTP 200과 `{"status":"ok"}`입니다. API는 `http://localhost:8000/docs`에서 확인합니다. DB가 준비된 후 API가 시작되도록 구성했습니다([Docker 시작 순서 문서](https://docs.docker.com/compose/how-tos/startup-order/)).

API 컨테이너는 DB 서비스 이름인 `db:5432`로 접속합니다. 컨테이너 안의 `localhost`는 해당 컨테이너 자신이므로 DB 주소로 사용하지 않습니다. DB 포트는 호스트에 공개하지 않으며 API는 로컬 호스트에만 공개합니다. 기본 DB 계정·비밀번호는 로컬 개발 예시이며 운영 배포용 설정은 별도로 준비해야 합니다.

<a id="dotenv-compose"></a>

### backend/.env 적용과 API 키

Compose 2.24 이상이 필요합니다. API·Worker·Relay·마이그레이션에 다음 순서로 설정을 전달합니다.

1. `deploy/backend.defaults.env`: 기존 로컬 개발 기본값입니다. 운영 정책 확정을 뜻하지 않습니다.
2. `backend/.env`: 있으면 기본값을 덮어씁니다. 없어도 기존 개발 기본값으로 기동합니다.
3. `compose.yaml`의 `environment`: DB·RabbitMQ 주소만 컨테이너 내부 주소로 고정합니다. 네이티브 실행용 `.env`의 `localhost`가 Compose 연결을 깨뜨리지 않도록 유지합니다.

DB·MQ를 외부 서비스로 바꾸려면 Compose 연결 설정도 명시적으로 변경해야 합니다. `backend/.env`에 `LOANSIGHT_ALLOWED_ORIGINS`를 지정한 경우 해당 목록을 우선하므로 개발 포트를 바꾸면 허용 Origin도 함께 수정합니다. 지정하지 않으면 기본 파일에서 현재 API·프론트엔드 포트를 반영합니다.

외부 API 키는 다음 두 이름을 지원합니다. 같은 입력원에 둘 다 있으면 `LOANSIGHT_` 이름을 우선하므로 한 형식으로 작성합니다.

| 설정 필드 | 권장 환경변수 | 기존 지원 이름 |
| --- | --- | --- |
| `open_dart_api_key` | `LOANSIGHT_OPEN_DART_API_KEY` | `open_dart_api_key` |
| `ecos_api_key` | `LOANSIGHT_ECOS_API_KEY` | `ecos_api_key` |
| `open_data_api_key` | `LOANSIGHT_OPEN_DATA_API_KEY` | `open_data_api_key` |

키는 선택 항목이며 빈 값·공백은 미설정으로 취급합니다. `SecretStr`로 보관해 설정 객체의 repr/JSON 출력에서 값을 가립니다. 이번 구현은 키 로딩까지이며 실제 OpenDART·ECOS·공공데이터 호출·유효성 검증은 후속 연동 범위입니다. `.env`는 Git과 Docker 빌드 컨텍스트에서 제외하고 런타임에만 주입합니다.

`.env`를 수정해도 실행 중인 컨테이너 환경이 즉시 바뀌지는 않습니다. 이미 DB·MQ가 실행 중이면 아래 명령으로 API·Worker·Relay만 재생성할 수 있습니다. **환경값 변경만으로 이미지 재빌드는 필요하지 않습니다.**

```powershell
docker compose -f deploy/compose.yaml up -d --no-build --no-deps --force-recreate --wait api worker outbox-relay
```

`start.cmd --backend --restart`도 적용할 수 있으나 현재 스크립트는 백엔드 전체 재생성과 `--build`를 수행합니다. 설정 코드·의존성이 같으면 빌드 캐시를 재사용합니다. 일반 `start.cmd`는 이미 healthy이면 건너뛰므로 환경값 변경 후에는 `--restart`가 필요합니다. 단순 `docker compose restart`는 바뀐 환경변수를 반영하지 않습니다. 네이티브 실행은 `backend/`에서 시작해야 `.env`를 읽으며 변경 후 프로세스를 다시 시작해야 합니다.

`docker compose config`나 컨테이너 환경 전체 출력에는 키 값이 포함될 수 있으므로 검증 시 실제 값 대신 설정 여부·일치 여부만 확인합니다. [Compose 환경파일 안내](https://docs.docker.com/compose/how-tos/environment-variables/set-environment-variables/), [restart 동작](https://docs.docker.com/reference/cli/docker/compose/restart/).

기존 단독 API가 8000 포트를 사용 중이면 해당 컨테이너를 중지한 뒤 실행합니다. 기존 서비스를 유지하려면 PowerShell에서 `$env:LOANSIGHT_API_PORT = '8001'`을 설정하고 같은 명령을 실행합니다. 이후 접근 주소도 8001을 사용합니다.

```powershell
# 상태와 로그
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs --tail 100 api worker outbox-relay
# 별도 마이그레이션 실행
docker compose -f deploy/compose.yaml exec api /app/.venv/bin/alembic upgrade head
# 종료: DB 데이터는 named volume에 보존
docker compose -f deploy/compose.yaml down
```

다시 `up`하면 기존 DB·MQ 데이터를 사용합니다. `down -v`는 영속 볼륨까지 삭제하므로 데이터 초기화가 필요할 때만 사용합니다. k3s 배포는 아직 포함하지 않습니다. Windows의 `start.cmd --backend`와 `stop.cmd --backend`도 5개 서비스를 함께 제어합니다.

## 사용자·작업 API

| 메서드·경로 | 동작 |
|---|---|
| `POST /api/v1/users` | 5자리 코드·기본 Workspace·세션 발급 |
| `POST /api/v1/session` | `{"user_code":"00427"}`로 재접속·현재 기기 사용자 전환 |
| `GET /api/v1/session` | 현재 사용자·Workspace 복원 |
| `DELETE /api/v1/session` | 현재 기기 세션 폐기·쿠키 삭제 |
| `POST /api/v1/me/tasks/diagnostics` | 명시적인 전달 경로 점검 작업 접수 |
| `GET /api/v1/me/tasks` | 진행 중·미확인 종료 작업과 일관된 `event_cursor` |
| `GET /api/v1/me/tasks/{id}` | 내 작업 상태·결과 |
| `GET /api/v1/me/task-events?after=...` | 영속 이벤트 재생 및 SSE |
| `PUT /api/v1/me/tasks/{id}/acknowledgement` | `{"state_version":3}`로 종료 버전 확인 |

쓰기 요청은 허용한 `Origin` 헤더가 필수입니다. 쿠키는 HttpOnly·SameSite=Lax·Path=/를 적용하고 HTTPS에서는 `LOANSIGHT_COOKIE_SECURE=true`를 사용합니다. 코드 발급·진입은 DB 기반 IP/코드/전체 제한을 적용합니다. 세션 만료·폐기는 열린 SSE에도 반영하며, 로그아웃은 다른 기기 세션을 유지합니다. 동일 사용자의 재접속은 같은 Workspace와 작업을 복원합니다.

세션 TTL·진입 제한·최대 작업 시도 횟수는 운영 정책이 미정이므로 코드에 기본값을 두지 않았습니다. `.env.example`과 Compose의 수치는 **로컬 개발 예시**이며 운영 정책 확정을 뜻하지 않습니다. 설정이 빠진 기능은 503으로 거부합니다. 허용 Origin도 명시적으로 설정하며 프록시의 임의 헤더로 IP나 권한을 신뢰하지 않습니다.

현재 지원 작업은 `PIPELINE_CHECK`뿐입니다. 요청은 `{"check_key":"UUID","shared":false}`입니다. 같은 키·범위는 실행과 내 작업 연결을 재사용하며 `shared:true`는 개인 입력이 없는 점검 작업의 사용자 간 실행 재사용을 검증합니다. 결과는 `financial_analysis_performed:false`를 명시합니다. 실제 `/analyses` API와 재무 분석 핸들러는 다음 단계에서 원천 revision·옵션 계약과 함께 구현합니다.

SSE는 내장 FastAPI SSE와 API 프로세스별 전용 PostgreSQL LISTEN 연결을 사용합니다. cursor는 Workspace 스트림 ID·커밋 순번이며 권한 증명이 아닙니다. `Last-Event-ID`가 `after`보다 우선합니다. 잘못된·다른 사용자 cursor나 재생 한도(`LOANSIGHT_EVENT_BATCH_SIZE`, 기본 100건) 초과 시 `reset`을 보내며 작업 목록을 다시 조회해야 합니다. 현재 이벤트는 삭제하지 않고 보존합니다. 자동 삭제·운영 보존 기간은 후속 정책 결정 사항입니다. 프론트엔드의 GNB/SSE 연결 UI는 이번 범위에 포함하지 않습니다.

Relay는 DB Outbox를 잠금 선점하고 persistent 메시지를 mandatory·publisher confirm으로 발행합니다. Worker는 generation·임대 소유권을 검사하고 결과·상태·이벤트 커밋 후 ACK합니다. 임대 만료는 Relay가 회수하며 새 generation의 Outbox를 생성합니다. 종료된 이전 Worker의 결과는 저장하지 않습니다. 재시도는 지연 Outbox로 예약하며 계약 오류·복구 불가 실패는 DLQ에 격리합니다. Worker·Relay healthcheck는 이벤트 루프가 동작하면서 DB·MQ에 연결되어 있는지 확인합니다.

## API 이미지만 실행

저장소 루트에서 실행합니다. `backend/.env`의 DB 호스트는 컨테이너에서 접근 가능한 주소로 지정해야 합니다.

```powershell
docker build -t loansight-backend:dev backend
docker run --rm --env-file backend/.env -p 8000:8000 loansight-backend:dev
```

이미지는 런타임 의존성만 설치하고 일반 사용자로 실행합니다. 이 방법은 PostgreSQL을 별도로 준비해야 하므로, 처음 실행할 때는 위 Compose 구성을 권장합니다.

## 검증

`backend/`에서 실행합니다.

```powershell
uv sync --frozen
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen pytest -q
```

PostgreSQL·RabbitMQ 통합 검증은 개발 볼륨과 분리된 환경에서 루트 기준으로 실행합니다. 각 테스트는 이름이 `_test`로 끝나는 DB 안에 독립 스키마를 만들고 종료 시 해당 스키마만 정리합니다. 아래 환경변수가 없으면 통합 테스트는 skip됩니다.

```powershell
docker compose -f deploy/compose.test.yaml up -d --wait
$env:LOANSIGHT_TEST_DATABASE_URL = 'postgresql+psycopg://loansight_test:test-only@localhost:15432/loansight_test'
$env:LOANSIGHT_TEST_RABBITMQ_URL = 'amqp://loansight_test:test-only@localhost:15673/'
backend\.venv\Scripts\python.exe -m pytest backend/tests -q
docker compose -f deploy/compose.test.yaml down
```

2026-10-27 검증: 기존 상태 확인 테스트와 실제 DB·MQ 통합 테스트, 초기 마이그레이션 upgrade·모델 일치·downgrade, Docker 전체 흐름을 검증합니다. 실제 실행 결과는 [검증 기록](../docs/reviews/02_sessions-and-pipeline-validation.md)에서 관리합니다. 샌드박스 캐시 쓰기 제약으로 pytest는 `-p no:cacheprovider`, Ruff는 `--no-cache` 옵션을 사용합니다. DB·MQ 볼륨 삭제·백업 복원과 k3s 운영 검증은 수행하지 않았습니다.
