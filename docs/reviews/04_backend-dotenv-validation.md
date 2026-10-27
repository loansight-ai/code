# 백엔드 .env 런타임 적용 검증

> 2026-10-27 · Python 3.12.15 · Compose 5.5.0

## 변경 범위

Compose의 고정 설정을 개발 기본 환경파일과 선택적인 `backend/.env`로 분리했다. 공통 backend 앵커를 사용하는 API·Worker·Relay·마이그레이션이 함께 읽는다. DB·MQ의 컨테이너 내부 연결 주소는 유지한다. 우선순위·지원 API 키 이름·재적용 방법은 [백엔드 실행 안내](../../backend/README.md#dotenv-compose)에서 관리한다.

Settings에 OpenDART·ECOS·공공데이터 키를 선택적 `SecretStr`로 추가했다. 기존 소문자 이름도 읽고 빈 값은 미설정으로 정규화한다. 실제 외부 API 호출 기능을 추가한 것은 아니다.

## 검증 결과

| 검증 방법 | 기대 결과 | 실제 결과 |
| --- | --- | --- |
| `ruff check --no-cache .`, `ruff format --check .` | 정적 검사·형식 검사 성공 | 통과 |
| `python -m pytest -q -p no:cacheprovider` | 설정·health·Compose 테스트 성공 | 28개 통과, 별도 DB·MQ 통합 환경 15개 skip |
| 격리된 Compose fixture에서 `.env` 생략 | 기존 개발 기본값과 사용자 지정 포트의 Origin 유지 | 통과 |
| fixture의 `.env`에 정책값·키·Origin 지정 | 기본값 덮어쓰기, DB·MQ 내부 주소 유지, 4개 backend 서비스에 적용 | 통과 |
| Settings의 권장/소문자 이름·빈 값·출력 검사 | 키 로딩·빈 값 None·repr/JSON 값 비노출 | 통과 |
| `docker compose -f deploy/compose.yaml build` | 새 Settings 코드가 포함된 이미지 생성 | 성공 |
| `docker compose -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 120` | 기존 볼륨으로 backend 서비스 준비 | 5개 서비스 healthy, 마이그레이션 정상 종료 |
| 실제 API·Worker·Relay 안에서 `.env`와 키 비교 | 세 키가 파일과 일치하며 값은 출력하지 않음 | 3개 프로세스 모두 일치·설정됨 확인 |
| 같은 컨테이너에서 DB/MQ 주소 및 `/app/.env` 확인 | 내부 서비스 주소 유지, 이미지에 `.env` 없음 | 통과 |
| `GET /api/v1/health/ready` | HTTP 200 | HTTP 200 |

키 비교는 로컬 검증 프로세스에서 비공개 파일을 읽고 컨테이너 표준입력으로 전달하여 수행했으며, 결과에는 설정 여부와 일치 여부만 남겼다. 실제 키·해시·환경 전체를 출력하거나 문서/Git/이미지에 넣지 않았다. 기존 `backend/.env`와 사용자가 수정 중인 `.env.example`은 변경하지 않았다.

DB·MQ 데이터 볼륨 삭제, 외부 API 호출·키 유효성, 별도 DB·MQ 통합 테스트 재실행, 프론트엔드 검사는 수행하지 않았다.
