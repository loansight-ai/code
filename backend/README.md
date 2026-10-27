# LoanSight AI Backend

[Issue #9](https://github.com/loansight-ai/code/issues/9)의 초기 실행 기반입니다. FastAPI 앱, 환경설정 검증, SQLAlchemy/Psycopg 비동기 세션, Alembic 실행 기반, 상태 확인 API를 제공합니다.

Python **3.12.15**, uv **0.13.5**를 사용합니다. 의존성 범위는 `pyproject.toml`, 실제 설치 버전은 `uv.lock`에서 관리합니다. 업무 모듈·사용자 세션·Worker·Relay·RabbitMQ·SSE·외부 연동은 아직 구현하지 않았습니다. 목표 구조와 후속 순서는 [프로젝트 설계](../docs/design/05_project-and-deployment.md), [개발 계획](../docs/design/06_delivery-and-validation.md#roadmap)을 따릅니다.

## 로컬 실행

저장소 루트에서 PowerShell로 실행합니다. PostgreSQL은 별도로 준비하고 연결 주소를 `backend/.env`에 입력합니다. 예시 비밀번호는 로컬 설명용입니다.

```powershell
cd backend
Copy-Item .env.example .env
# .env의 LOANSIGHT_DATABASE_URL을 실제 개발 DB 주소로 수정
uv sync --frozen
uv run --frozen uvicorn app.main:app --reload
```

`.env` 경로는 현재 작업 디렉터리 기준이므로 `backend/`에서 실행합니다. 배포에서는 환경변수로 설정을 주입합니다. DB URL은 `postgresql+psycopg://` 형식과 host·database가 필수입니다. `LOANSIGHT_DATABASE_TIMEOUT_SECONDS`는 연결 및 readiness 확인 제한 시간(기본 3초, 0초 초과·60초 이하)인 기술 설정이며 업무 정책 수치가 아닙니다.

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

현재 업무 테이블과 revision은 없습니다. 모델을 추가할 때 `migrations/env.py`에 모델 import를 등록하고 `uv run --frozen alembic revision --autogenerate -m "설명"`으로 생성한 내용을 검토한 뒤 적용합니다. `Database.transaction()`은 작업 단위로 세션을 만들고 정상 종료 시 커밋, 오류 시 롤백합니다.

## API와 DB 함께 실행 (권장)

Docker Desktop을 실행한 다음 **저장소 루트**에서 아래 명령을 실행합니다. 로컬 개발용 PostgreSQL과 API를 함께 만들고 두 서비스의 상태 확인이 성공할 때까지 기다립니다. `backend/.env`를 복사할 필요 없이 Compose에서 DB 연결 설정을 전달합니다.

```powershell
docker compose -f deploy/compose.yaml up -d --build --wait
curl.exe http://localhost:8000/api/v1/health/ready
```

성공 응답은 HTTP 200과 `{"status":"ok"}`입니다. API는 `http://localhost:8000/docs`에서 확인합니다. DB가 준비된 후 API가 시작되도록 구성했습니다([Docker 시작 순서 문서](https://docs.docker.com/compose/how-tos/startup-order/)).

API 컨테이너는 DB 서비스 이름인 `db:5432`로 접속합니다. 컨테이너 안의 `localhost`는 해당 컨테이너 자신이므로 DB 주소로 사용하지 않습니다. DB 포트는 호스트에 공개하지 않으며 API는 로컬 호스트에만 공개합니다. 기본 DB 계정·비밀번호는 로컬 개발 예시이며 운영 배포용 설정은 별도로 준비해야 합니다.

기존 단독 API가 8000 포트를 사용 중이면 해당 컨테이너를 중지한 뒤 실행합니다. 기존 서비스를 유지하려면 PowerShell에서 `$env:LOANSIGHT_API_PORT = '8001'`을 설정하고 같은 명령을 실행합니다. 이후 접근 주소도 8001을 사용합니다.

```powershell
# 상태와 로그
docker compose -f deploy/compose.yaml ps
docker compose -f deploy/compose.yaml logs --tail 100 api db
# 별도 마이그레이션 실행
docker compose -f deploy/compose.yaml exec api /app/.venv/bin/alembic upgrade head
# 종료: DB 데이터는 named volume에 보존
docker compose -f deploy/compose.yaml down
```

다시 `up`하면 기존 DB 데이터를 사용합니다. `down -v`는 DB 볼륨까지 삭제하므로 데이터 초기화가 필요할 때만 사용합니다. k3s·Worker·Relay·RabbitMQ는 아직 포함하지 않습니다.

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

2026-10-27 검증: pytest 16개, Ruff 린트·포맷 검사, lockfile 일치 검사, `git diff --check` 통과. Alembic의 빈 heads 조회·오프라인 SQL 생성과 FastAPI 내장 SSE import를 확인했습니다. 샌드박스 캐시 쓰기 제약으로 pytest는 `-p no:cacheprovider`, Ruff는 `--no-cache` 옵션을 사용했습니다.

상태 API 단위 테스트는 DB 연결을 대체하여 성공·장애·시간 초과·비밀값 비노출을 확인했습니다. 후속 Compose 검증에서 이미지 빌드, PostgreSQL·API healthy 상태, 실제 DB 연결을 사용하는 `/api/v1/health/ready`의 HTTP 200 응답을 확인했습니다. 컨테이너에서 `alembic upgrade head`도 성공했으며, 현재 업무 revision이 없어 업무 테이블 변경 검증은 포함하지 않습니다. DB 볼륨을 삭제·복구하는 검증은 수행하지 않았습니다.
