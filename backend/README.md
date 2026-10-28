# LoanSight AI Backend

[Issue #9](https://github.com/loansight-ai/code/issues/9)의 실행 기반과 [Issue #11](https://github.com/loansight-ai/code/issues/11)의 사용자·세션·비동기 작업 흐름을 제공합니다.

Python **3.12.15**, uv **0.13.5**를 사용합니다. 의존성 범위는 `pyproject.toml`, 실제 설치 버전은 `uv.lock`에서 관리합니다. 사용자 식별·해시 세션·접근 범위·Outbox·RabbitMQ·Worker·Relay·SSE를 구현했습니다. 실제 DART 수집·재무 분석·외부 모델 연동은 후속 구현입니다. 목표 구조와 후속 순서는 [프로젝트 설계](../docs/design/05_project-and-deployment.md), [개발 계획](../docs/design/06_delivery-and-validation.md#roadmap)을 따릅니다.

로컬 재무제표 주석 HTML을 처리하는 [dart-note-hierarchy wheel](app/modules/dart_note_hierarchy-0.8.4-py3-none-any.whl) v0.8.4를 uv·Docker 의존성에 등록했습니다. 인증된 접수 API→Outbox→RabbitMQ→Worker로 구조화하고 원문과 구간을 영속 저장합니다. 프론트 원문 뷰어와 사실 추출·검수는 후속 작업입니다.

<a id="note-hierarchy"></a>

## 재무제표 주석 구조화 모듈

패키지의 기능·출력 스키마·설정·한계는 [v0.8.4 사용방법](app/modules/사용방법_dart_note_hierarchy-0.8.4-py3-none-any.md)에서 관리합니다. 배포 패키지명은 `dart-note-hierarchy`, Python import명은 `note_hierarchy`, CLI는 `note-hierarchy`입니다. 이 저장소에서는 로컬 wheel 경로와 해시를 `pyproject.toml`·`uv.lock`에 등록했으므로 `backend/`에서 다음처럼 준비합니다.

```powershell
cd backend
uv sync --frozen
uv run --frozen python -m note_hierarchy --version
uv run --frozen python -m note_hierarchy input/notes.html --profile dart --link-periods --document-id company_2025_separate --period 2025.12 --kind 별도 --output ../.run/note-hierarchy-review
```

`input/notes.html`은 사용자가 준비한 연결·별도 주석 HTML입니다. 출력의 `review.html`을 브라우저에서 확인하며 패키지는 수집이나 OpenDART API 호출을 하지 않습니다. Python에서는 설치 위치와 관계없이 `from note_hierarchy import DocumentProcessor`를 사용합니다. CLI가 PATH에 있으면 `note-hierarchy`도 같은 인자를 받습니다.

wheel은 `lxml>=5,<7`을 설치 의존성으로 선언하고 기본 JSON 설정·문서·가상 예제를 포함합니다. 설치 시 pip가 의존성을 함께 준비합니다. 별도 소스 복사나 `PYTHONPATH` 지정은 필요하지 않습니다. 동봉 예제는 작업 디렉터리의 `note_hierarchy/examples/` 경로가 아니라 설치 패키지 리소스로 읽습니다.

설치 후 가상 예제로 Python API를 확인하는 예시입니다(`backend/` 기준).

```python
from importlib.resources import files
from note_hierarchy import DocumentProcessor

source = files("note_hierarchy").joinpath("examples/dart_notes.html").read_bytes()
result = DocumentProcessor("dart", link_periods=True).process_html(
    source,
    document_id="demo",
    metadata={"period": "2025.12", "kind": "별도"},
)
result.write("../.run/note-hierarchy-demo")
```

다른 pip 환경에서는 `python -m pip install ./app/modules/dart_note_hierarchy-0.8.4-py3-none-any.whl`로 설치할 수 있습니다(`backend/` 기준). PyPI에는 게시하지 않았으므로 wheel 경로를 지정합니다. Dockerfile은 `uv sync` 전에 wheel을 복사하며 API·Worker·Relay가 같은 버전의 이미지를 사용합니다.

wheel에는 테스트·평가 workflows·기업 데이터·수집기·API 키가 포함되지 않습니다. 전체 회귀 테스트와 데이터셋 평가는 패키지 원본 저장소에서 수행해야 합니다. 후속 근거 저장·검수 연동은 [주석 구조화 경계](../docs/design/01_data-and-analysis.md#note-hierarchy)를 따릅니다.

2026-10-27 문서 검증에서는 분리 가상환경의 pip 설치와 `pip check`, `note-hierarchy`·`python -m note_hierarchy` 버전 조회, 위 uv 일회성 실행을 확인했습니다. v0.8.4 Python API와 패키지 내 가상 예제로 JSON·검토 HTML 생성, 원문 해시·초안 상태 보존, 다른 작업 디렉터리에서의 CLI 실행도 확인했습니다. 전체 회귀 테스트·실제 기업 정확도·서비스 연동 검증은 실행하지 않았습니다.

이후 DART API로 받은 뉴트리 사업보고서(2025.12)의 연결·별도 주석 HTML에 대해서도 실행·원문 보존·Chrome 표시를 확인했습니다. 미확정 계층과 검증 한계, 실제 수치는 [실제 보고서 실행 검증 기록](../docs/reviews/05_note-hierarchy-real-report-validation.md)에서 관리합니다.

<a id="note-import-api"></a>

## 주석 HTML 접수와 원문 구간 저장

| 메서드·경로 | 동작 |
| --- | --- |
| `POST /api/v1/me/note-imports` | `text/html` 원문 바이트와 query 문서 정보를 받아 작업·Outbox를 접수(202) |
| `GET /api/v1/me/note-imports/{structure_id}` | 작업 상태, 출처/해시·파서/설정 버전, 완료 후 계층·검토 상태 조회 |
| `GET /api/v1/me/note-imports/{structure_id}/segments` | 원문 구간을 문서 순서로 조회. `after=-1`, `limit=100` 기본, 최대 500개 |
| `GET /api/v1/me/note-imports/{structure_id}/segments/{segment_id}` | 같은 결과에 속한 구간의 원문 위치·내용·표 문맥 조회 |

접수 query는 `corp_code`(8자리), `receipt_no`(14자리), `scope=CFS|OFS`, `period=YYYY.MM`이 필수입니다. `encoding=utf-8|euc-kr`(기본 UTF-8), `link_periods=true|false`(기본 true)를 선택할 수 있습니다. 연결·별도 주석을 분리한 HTML을 준비해야 하며 이 API가 전체 보고서를 수집하거나 주석 영역을 자동 분리하지는 않습니다. 문서 정보는 사용자가 제출한 값이며 DART 원천 진위를 승인한 정보로 간주하지 않습니다.

로그인 쿠키와 허용된 Origin이 필요하며 결과는 현재 Workspace에 격리합니다. 동일 사용자·문서 정보·원문·파서/규칙/옵션/저장 어댑터 버전의 재접수는 기존 작업과 결과를 반환합니다. 입력·옵션·버전 변경은 별도 구조화 revision입니다. 미완료 결과의 구간 목록은 409, 다른 사용자 결과와 잘못된 구간 ID는 404입니다. 페이지의 `next_after`가 null이면 마지막 페이지입니다.

Compose 서버를 시작한 뒤 `backend/`에서 아래 예시처럼 접수합니다. query 문서 정보는 실제 입력 파일에 맞춰 지정합니다. 쿠키 파일은 Git 제외 경로에 둡니다.

```powershell
curl.exe -c ../.run/note-cookies.txt -H "Origin: http://localhost:8000" -X POST http://localhost:8000/api/v1/users
curl.exe -b ../.run/note-cookies.txt -H "Origin: http://localhost:8000" -H "Content-Type: text/html" --data-binary "@input/notes.html" "http://localhost:8000/api/v1/me/note-imports?corp_code=01214248&receipt_no=20260320001416&scope=CFS&period=2025.12"
```

접수 응답의 `task_id`는 기존 작업/SSE API에서, `structure_id`는 위 조회 API에서 사용합니다. `NOTE_STRUCTURE` 완료는 구조화 저장 완료이며 사실 검수 완료가 아닙니다. 결과는 `rule_based_draft_not_gold`, `evidence_verified=false`를 유지합니다. 원문 HTML은 아직 브라우저 응답으로 제공하지 않고 표 HTML도 JSON 문자열로만 반환합니다. 뷰어 연결 전 원문 정제·열람 기록 처리가 필요합니다.

원본은 `LOANSIGHT_ARTIFACT_ROOT` 아래 SHA-256 기반 불변 파일로 저장하고, PostgreSQL에는 `source_artifact`·`note_structure`·`source_segment`를 저장합니다. Native API/Worker는 같은 디렉터리를 사용해야 하며 기본값은 실행 디렉터리 기준 `.run/artifacts`입니다. Compose는 두 프로세스에 `/data/artifacts`와 `source-artifacts` named volume을 공유합니다. DB와 이 볼륨을 함께 보존해야 합니다. `LOANSIGHT_NOTE_IMPORT_MAX_BYTES`는 요청당 기술적 크기 제한이며 기본 20 MiB입니다.

Worker는 저장된 파서·규칙 버전으로 처리하고 원문 해시·구조 검사를 확인합니다. 구간 저장과 작업 완료·SSE 이벤트는 실행 임대/소유권 확인 후 같은 DB 트랜잭션으로 확정합니다. 재전달이나 이전 Worker의 늦은 결과로 구간이 중복 확정되지 않습니다. 파일 저장과 DB는 별도이므로 접수 실패 시 미참조 파일이 남을 수 있으며 자동 삭제/보관 정책은 아직 없습니다.

설계 매핑은 [원문 구간 저장 계약](../docs/design/01_data-and-analysis.md#note-storage), 실행 결과는 [저장 연동 검증 기록](../docs/reviews/06_note-source-storage-validation.md)을 따릅니다.

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

API 컨테이너는 DB 서비스 이름인 `db:5432`로 접속합니다. 컨테이너 안의 `localhost`는 해당 컨테이너 자신이므로 DB 주소로 사용하지 않습니다. 호스트의 DB 도구는 `127.0.0.1:5432`, 데이터베이스/사용자 `loansight`, 비밀번호 `local-example`로 접속합니다. DB·API 포트는 로컬 호스트에만 공개합니다. DB 호스트 포트를 바꾸려면 PowerShell에서 `$env:LOANSIGHT_DB_PORT = '5433'`을 설정한 뒤 Compose를 다시 적용합니다. 기본 DB 계정·비밀번호는 로컬 개발 예시이며 운영 배포용 설정은 별도로 준비해야 합니다.

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

현재 지원 작업은 연결 점검 `PIPELINE_CHECK`와 주석 구조화 `NOTE_STRUCTURE`입니다. 연결 점검 요청은 `{"check_key":"UUID","shared":false}`입니다. 같은 키·범위는 실행과 내 작업 연결을 재사용하며 `shared:true`는 개인 입력이 없는 점검 작업의 사용자 간 실행 재사용을 검증합니다. 주석 접수는 [별도 API](#note-import-api)를 사용하고 Workspace별로 격리합니다. 두 작업 모두 결과에 `financial_analysis_performed:false`를 명시합니다. 실제 `/analyses` API와 재무 분석 핸들러는 후속 구현입니다.

SSE는 내장 FastAPI SSE와 API 프로세스별 전용 PostgreSQL LISTEN 연결을 사용합니다. 연결 시작 시 주석을 즉시 전송하여 유휴 스트림도 프록시를 거쳐 연결을 확정합니다. cursor는 Workspace 스트림 ID·커밋 순번이며 권한 증명이 아닙니다. `Last-Event-ID`가 `after`보다 우선합니다. 잘못된·다른 사용자 cursor나 재생 한도(`LOANSIGHT_EVENT_BATCH_SIZE`, 기본 100건) 초과 시 `reset`을 보내며 작업 목록을 다시 조회해야 합니다. 현재 이벤트는 삭제하지 않고 보존합니다. 자동 삭제·운영 보존 기간은 후속 정책 결정 사항입니다. 프론트엔드 연결 UI는 [프론트엔드 안내](../frontend/README.md#서버-세션작업-연동)를 참고합니다.

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
