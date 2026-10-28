# LoanSight AI Backend

[Issue #9](https://github.com/loansight-ai/code/issues/9)의 실행 기반과 [Issue #11](https://github.com/loansight-ai/code/issues/11)의 사용자·세션·비동기 작업 흐름을 제공합니다.

Python **3.12.15**, uv **0.13.5**를 사용합니다. 의존성 범위는 `pyproject.toml`, 실제 설치 버전은 `uv.lock`에서 관리합니다. 사용자 식별·해시 세션·접근 범위·Outbox·RabbitMQ·Worker·Relay·SSE를 구현했습니다. DART 기업코드 수집·검색을 구현했으며 공시 수집·재무 분석·외부 모델 연동은 후속 구현입니다. 목표 구조와 후속 순서는 [프로젝트 설계](../docs/design/05_project-and-deployment.md), [개발 계획](../docs/design/06_delivery-and-validation.md#roadmap)을 따릅니다.

로컬 재무제표 주석 HTML을 처리하는 [dart-note-hierarchy wheel](app/modules/dart_note_hierarchy-0.8.4-py3-none-any.whl) v0.8.4를 uv·Docker 의존성에 등록했습니다. 인증된 접수 API→Outbox→RabbitMQ→Worker로 구조화하고 원문과 구간을 영속 저장합니다. 저장된 결과는 프론트 원문 뷰어에 연결했으며 사실 추출·검수는 후속 작업입니다.

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
| `GET /api/v1/me/note-imports/{structure_id}/source-view` | 원문 해시를 확인한 뒤 열람용 HTML·구간별 앵커를 JSON으로 반환 |

접수 query는 `corp_code`(8자리), `receipt_no`(14자리), `scope=CFS|OFS`, `period=YYYY.MM`이 필수입니다. `encoding=utf-8|euc-kr`(기본 UTF-8), `link_periods=true|false`(기본 true)를 선택할 수 있습니다. 연결·별도 주석을 분리한 HTML을 준비해야 하며 이 API가 전체 보고서를 수집하거나 주석 영역을 자동 분리하지는 않습니다. 문서 정보는 사용자가 제출한 값이며 DART 원천 진위를 승인한 정보로 간주하지 않습니다.

로그인 쿠키와 허용된 Origin이 필요하며 결과는 현재 Workspace에 격리합니다. 동일 사용자·문서 정보·원문·파서/규칙/옵션/저장 어댑터 버전의 재접수는 기존 작업과 결과를 반환합니다. 입력·옵션·버전 변경은 별도 구조화 revision입니다. 미완료 결과의 구간 목록은 409, 다른 사용자 결과와 잘못된 구간 ID는 404입니다. 페이지의 `next_after`가 null이면 마지막 페이지입니다.

Compose 서버를 시작한 뒤 `backend/`에서 아래 예시처럼 접수합니다. query 문서 정보는 실제 입력 파일에 맞춰 지정합니다. 쿠키 파일은 Git 제외 경로에 둡니다.

```powershell
curl.exe -c ../.run/note-cookies.txt -H "Origin: http://localhost:8000" -X POST http://localhost:8000/api/v1/users
curl.exe -b ../.run/note-cookies.txt -H "Origin: http://localhost:8000" -H "Content-Type: text/html" --data-binary "@input/notes.html" "http://localhost:8000/api/v1/me/note-imports?corp_code=01214248&receipt_no=20260320001416&scope=CFS&period=2025.12"
```

접수 응답의 `task_id`는 기존 작업/SSE API에서, `structure_id`는 위 조회 API에서 사용합니다. `NOTE_STRUCTURE` 완료는 구조화 저장 완료이며 사실 검수 완료가 아닙니다. 결과는 `rule_based_draft_not_gold`, `evidence_verified=false`를 유지합니다.

구간 목록은 `node_id`(저장된 부모 관계의 하위 노드 포함), `q`(본문 부분 검색), `tables_only=true`로 필터링합니다. `total`은 필터 결과 수이며 프론트는 30개씩 추가 조회합니다. 원문 뷰어의 HTML 전체는 한 번에 가져옵니다.

`source-view`는 Workspace 권한을 확인한 뒤 SHA-256 검증을 거쳐 원문 바이트를 읽고, 저장된 XPath에 구간 앵커를 부여한 파생 HTML을 JSON으로 반환합니다. 원본 파일은 수정하지 않습니다. 미완료는 409, 다른 사용자 결과는 404, 파일 누락·변조 또는 위치 불일치는 503이며 응답은 `no-store`, `nosniff`입니다. 클라이언트는 DOMPurify의 태그·속성 허용 목록으로 HTML을 정제하고 스크립트·외부 리소스를 막는 CSP 및 `sandbox="allow-same-origin"` iframe에서 표시합니다. 원문 자체의 스타일·링크·이미지는 허용하지 않으며 앱의 열람 서식을 적용합니다. 구간 선택 시 해당 앵커를 강조합니다. 열람 사실·담당자 검수 기록과 교차참조 이동은 아직 제공하지 않습니다.

원본은 `LOANSIGHT_ARTIFACT_ROOT` 아래 SHA-256 기반 불변 파일로 저장하고, PostgreSQL에는 `source_artifact`·`note_structure`·`source_segment`를 저장합니다. Native API/Worker는 같은 디렉터리를 사용해야 하며 기본값은 실행 디렉터리 기준 `.run/artifacts`입니다. Compose는 두 프로세스에 `/data/artifacts`와 `source-artifacts` named volume을 공유합니다. DB와 이 볼륨을 함께 보존해야 합니다. `LOANSIGHT_NOTE_IMPORT_MAX_BYTES`는 요청당 기술적 크기 제한이며 기본 20 MiB입니다.

Worker는 저장된 파서·규칙 버전으로 처리하고 원문 해시·구조 검사를 확인합니다. 구간 저장과 작업 완료·SSE 이벤트는 실행 임대/소유권 확인 후 같은 DB 트랜잭션으로 확정합니다. 재전달이나 이전 Worker의 늦은 결과로 구간이 중복 확정되지 않습니다. 파일 저장과 DB는 별도이므로 접수 실패 시 미참조 파일이 남을 수 있으며 자동 삭제/보관 정책은 아직 없습니다.

설계 매핑은 [원문 구간 저장 계약](../docs/design/01_data-and-analysis.md#note-storage), 실행 결과는 [저장 연동 검증 기록](../docs/reviews/06_note-source-storage-validation.md)을 따릅니다.

<a id="note-search-api"></a>

## 주석 근거 검색 도구와 기본 검색

저장된 재무제표 주석의 목차·문단·표를 PostgreSQL에서 검색합니다. 임베딩·외부 검색 서버·LLM 호출은 사용하지 않습니다. [공통 6항목](../docs/design/01_data-and-analysis.md#evidence)의 초기 검색어 사전을 `common-six-draft-v1`, 도구를 `note-keyword-v1`로 관리합니다. 검색 일치는 사실 검출·위험 발생·검수 완료가 아닙니다.

아래 경로는 `/api/v1/me/note-imports/{structure_id}` 뒤에 붙입니다. 모든 조회는 Workspace 소유권과 완료된 구조화 revision에 제한하며 `no-store`입니다. 다른 사용자 결과는 404, 미완료는 409, 잘못된 도구 인자는 422입니다. POST는 허용된 Origin도 확인합니다.

| 메서드·하위 경로 | 동작 |
|---|---|
| `GET /search/sections` | 목차·알려진 부모·검토 상태·직속 구간 수. `parent_id`, `offset`, `limit` |
| `POST /search/segments` | JSON `terms`, `mode=ANY|ALL`, 선택적 `node_id`, `kind=table|text`, `offset`, `limit`로 검색 |
| `GET /search/context` | `segment_id`의 앞뒤 본문·표 문맥. `before`, `after`, `text_offset`, `row_offset`, `row_limit` |
| `POST /search/baseline` | 6항목 기본 검색을 실행하고 저장. 같은 사용자·revision·사전/도구 버전이면 기존 결과 재사용 |
| `GET /search/baseline` | 저장된 실행을 `run`으로 조회. 미실행이면 null |

검색어와 비교 텍스트의 공백·대소문자를 정규화하며 원문은 변경하지 않습니다. LIKE 와일드카드는 이스케이프해 리터럴로 취급합니다. 본문, 알려진 목차 경로, 표 제목, 저장된 표 문맥을 검색하고 일치 검색어 수 → 목차 일치 여부 → 문서 순서로 정렬합니다. 목차 필터는 명시된 부모 관계로만 하위 내용을 포함합니다. 필터가 없으면 root·비말단·부모 미확정 노드의 직속 내용도 검색합니다. 검색 조건·집계·페이지 제한은 SQL에서 수행하며 전체 구간을 Python 메모리에 적재하지 않습니다. 별도 전문/벡터 인덱스는 아직 없습니다.

응답은 문서 출처·해시·도구 버전, 전체 후보 수, 후보별 구간 ID·목차·정확한 원문 발췌 위치·일치 필드·원문 화면 링크와 `next_offset`·잘림 상태를 반환합니다. 표 문맥은 보존된 파서의 추정 상태를 유지합니다. 표는 원시 행과 rowspan/colspan을 제공하며 `th` 헤더와 앞쪽 행을 따로 반환합니다. `td`를 헤더로 확정하거나 셀의 당기/전기를 추정하지 않습니다. 원문 HTML은 도구 응답에 포함하지 않습니다.

초기 응답 크기 제한은 기술적 기본값이며 업무 판정 기준이 아닙니다. 검색어 최대 20개·각 100자, 검색 페이지 기본 10/최대 30개, 목차 페이지 기본 30/최대 100개, 검색 발췌 600자입니다. 문맥은 앞뒤 각각 기본 2/최대 5개·구간당 4,000자이며 긴 대상 본문은 `next_text_offset`으로 계속 읽습니다. 표 행은 기본 10/최대 30개·행당 최대 40셀·셀당 1,000자, 주변 표 문맥은 최대 12개·각 1,000자입니다. 표 문맥·행/셀 잘림과 원문 링크를 제공하므로 제한된 응답을 전체 표로 해석하지 않습니다. 표 HTML 파싱은 별도 스레드로 실행합니다.

`note_search_run`에 6항목별 검색어·검색 완료 여부·후보 수·상위 5개 후보·추가 조회 위치·미확보 영역·출처/버전을 저장합니다. 같은 실행의 중복 요청은 유일 제약과 충돌 처리로 하나의 결과를 반환합니다. 전체 보고서 검색 범위는 `PARTIAL`, AI는 `NOT_RUN`, 검수는 `PENDING`입니다. 후보가 없으면 `NO_MATCH`이며 ‘공시상 없음’으로 바꾸지 않습니다. 실행 전체가 실패하면 부분 결과를 완료로 저장하지 않습니다. 수동 도구 조회 이력·LLM 탐색 이력 저장은 후속입니다.

향후 공급자 연결은 `NoteSearchTools.owned(...)`로 권한을 확인한 실행 범위를 만든 뒤 `definitions()`의 JSON Schema와 `call(name, arguments)`를 사용합니다. 도구는 `list_note_sections`, `search_note_segments`, `read_note_context`만 허용하며 Workspace·SQL·파일 경로 같은 추가 인자를 거부합니다. `validate_citations()`는 같은 revision의 실제 구간·발췌 일치를 검사하는 내부 함수이며 의미 검수를 대신하지 않습니다. Codex/OpenAI API 실행·시점 기준 예측 검색·사실 추출·검수 저장은 아직 연결하지 않았습니다. [설계](../docs/design/03_ai-integration.md#evidence-search)와 [검증 기록](../docs/reviews/13_note-evidence-search-validation.md)을 참고합니다.

## DART 원문 자동 수집

코드 접속 후 `POST /api/v1/me/disclosure-collections`에 `corp_code`, `receipt_no`, `scope=CFS|OFS`, 선택 항목 `link_periods`(기본 true)를 JSON으로 제출합니다. 허용된 Origin과 세션 쿠키가 필요합니다. 서버가 해당 기업의 검증된 사업보고서 목록에서 접수번호·결산기간·철회 여부를 확인하므로 임의 문서 URL이나 사용자가 지정한 결산기간을 받지 않습니다.

접수는 `DART_COLLECT` 작업·Workspace 연결·Outbox를 한 트랜잭션으로 등록합니다. Worker는 공식 `document.xml` 원본 ZIP을 보존하고 포함된 XML을 경로 추출 없이 바이트로 보존합니다. 별도로 DART 보고서 목차 HTML을 저장하고, 연결/별도 주석의 정확한 제목과 접수번호·문서 식별자·구간 위치를 확인하여 공개 `report/viewer.do` HTML을 수집합니다. 내려받은 JavaScript를 실행하거나 XML을 임의로 HTML로 변환하지 않습니다. 선택한 범위의 목차가 없거나 중복되면 다른 범위를 대신 사용하지 않고 실패로 기록합니다. 주석 HTML의 제목·표·인코딩도 확인합니다.

파일은 기존 SHA-256 저장소에 불변 바이트로 보존합니다. PostgreSQL `dart_document`는 ZIP·XML 목록·목차 해시·목차 locator·수집 시각, `dart_note`는 접수번호별 회계 범위·HTML 해시/크기·인코딩·locator·수집기 버전을 저장합니다. `dart_collection_request`는 사용자 작업과 요청 기준을 연결합니다. 다른 정정 접수번호는 별도 원본이며, 같은 접수번호·범위는 최초 수집본을 재사용합니다. 목록 캐시의 1시간 갱신이 저장된 원문을 덮어쓰거나 자동 재분석하지 않습니다. 동일 접수번호의 원문 변경 자동 감지와 정정 전후 비교는 아직 제공하지 않습니다.

수집이 끝나면 같은 Workspace의 기존 `NOTE_STRUCTURE` 작업을 자동 등록합니다. 수집과 구조화는 각각 작업/SSE 알림으로 표시합니다. 수집 작업 결과의 `note_task_id`, `structure_id`로 후속 상태와 기존 주석 조회 API를 사용할 수 있습니다. 공개 원본 바이트는 중복을 제거하지만 사용자별 작업·`source_artifact`·구조화 revision과 접근 권한은 분리합니다. 자동 수집 출처는 `dart_note_id`, `input_origin=dart_viewer_note_html`로 추적하며 사용자 제출 HTML과 구분합니다.

`LOANSIGHT_DART_DOCUMENT_MAX_BYTES`(기본 50 MiB)는 ZIP/목차 응답의 기술적 수집 한도입니다. 주석 HTML은 기존 `LOANSIGHT_NOTE_IMPORT_MAX_BYTES` 한도를 사용합니다. ZIP의 파일 수·총 비압축 크기도 검사하며 원본 파일명으로 로컬 경로를 만들지 않습니다. 파일 저장 후 DB 등록이 실패하면 미참조 불변 파일이 남을 수 있고 자동 삭제는 하지 않습니다. 파일·DB 볼륨을 함께 보존해야 합니다.

수집 및 구조화 완료는 실제 재무 분석·사실 검수 완료가 아닙니다. 원문 열람·강조는 [주석 조회 계약](#note-import-api), 수집 검증은 [DART 자동 수집·구조화 검증](../docs/reviews/11_dart-document-collection-validation.md), 화면 검증은 [결과 화면 검증](../docs/reviews/12_note-results-view-validation.md)을 참고합니다.

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

Readiness는 현재 DB 연결만 확인합니다. 업무 스키마·MQ·기업 원장 적재·분석 처리 준비 여부를 보장하지 않습니다. API 시작 시 기업 원장을 백그라운드에서 적재하지만 서버 시작을 막지 않으므로 DB 장애에도 liveness는 응답합니다. 마이그레이션은 별도로 적용합니다.

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

키는 선택 항목이며 빈 값·공백은 미설정으로 취급합니다. `SecretStr`로 보관해 설정 객체의 repr/JSON 출력에서 값을 가립니다. OpenDART 기업코드 다운로드는 아래 기업 검색에서 사용하며, ECOS·공공데이터 호출은 후속 연동 범위입니다. `.env`는 Git과 Docker 빌드 컨텍스트에서 제외하고 런타임에만 주입합니다.

## 기업 검색

기업 검색은 PostgreSQL의 `company` 테이블을 조회합니다. API 시작 시 `company_import` 체크포인트가 없으면 전체 원장과 KSIC11 기업정보를 한 트랜잭션으로 최초 적재합니다. 재시작 시 체크포인트가 있으면 기존 DB를 사용하며 원장을 다시 읽지 않습니다. 여러 API 프로세스가 동시에 시작해도 PostgreSQL advisory lock과 `corp_code` 기본키로 중복 적재를 막습니다. 초기 적재 중 첫 검색은 적재 완료를 기다리며, 실패하면 체크포인트와 부분 데이터가 남지 않고 재시도합니다.

검색어·업종 조건·전체 건수·정렬·`OFFSET`/`LIMIT`은 모두 DB에서 처리하고 요청한 페이지만 응답합니다. 검색 요청마다 ZIP/CSV를 읽거나 전체 기업 목록을 애플리케이션 메모리에 올리지 않습니다. 원본 파일은 아래 수집·이력 보존 경로로 유지합니다. 적재 후에는 원본 파일이나 DART 인증키가 없어도 기존 DB 검색이 가능합니다.

백그라운드 적재 작업은 60초마다 입력 변경 여부를 확인합니다. 주간 원장·기업정보 스냅샷·코드표가 변경된 경우에만 DB를 동기화하고 변경 없는 행은 갱신하지 않습니다. 최신 원장에서 빠진 기업은 삭제 대신 `active=false`로 보존하고 검색에서 제외하며 다시 나타나면 활성화합니다. 동기화가 실패하면 이전 적재 데이터와 체크포인트를 유지합니다. 현재 적재 여부·건수는 `company_import.company_count`, `imported_at`으로 확인합니다.

DB 적재·검색·마이그레이션 검증 결과는 [기업 원장 PostgreSQL 적재 검증](../docs/reviews/09_company-database-validation.md)을 참고합니다.

선택 항목 `industry`는 `제조`, `건설`, `도소매`, `부동산 임대`를 받습니다. 제공된 KSIC11 코드표의 계층에서 각각 `C`, `F`, `G`, `6811`과 그 하위 분류를 검색하며, 검색어와 함께 적용한 뒤 전체 건수와 페이지를 계산합니다. `부동산 임대`는 개발·공급(`6812`)과 관리·중개를 포함하지 않습니다. 더 넓은 부동산 분류만 확보한 기업의 세부 업종은 추정하지 않습니다. `matched`인 기업만 업종별 검색에 포함하며 미매칭·재검토 기업은 업종을 지정하지 않은 전체 검색에서 확인할 수 있습니다. 이는 검색용 분류이며 서비스 대상/제외·복합 업종의 최종 판정을 뜻하지 않습니다.

`GET /api/v1/companies?q=삼성&offset=0&limit=10`으로 기업명·영문명·종목코드·DART 고유번호를 부분 검색합니다. 공백과 영문 대소문자를 구분하지 않으며 정확히 일치하는 이름/코드를 우선 표시합니다. 응답은 `items`, `total`, `offset`, `limit`이고 `items`에는 `corp_code`, `corp_name`, `corp_eng_name`, `stock_code`, `modify_date`, `ksic11_code`, `ksic11_name`, `ksic11_level`, `ksic11_status`, `induty_code`, `corp_cls`, `acc_mt`, `industry`가 있습니다. `industry`는 DB에 저장된 KSIC11 검색용 검토 업종이며 미확정이면 `null`입니다. 고유번호와 종목코드는 앞자리 0을 보존하는 문자열이며 영문 종목코드도 허용합니다. 미확보 값은 `null`입니다. `limit`은 기본 10(허용 범위 1–100), `offset`은 0 이상입니다.

원천은 [OpenDART 고유번호 API](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019018)의 ZIP/XML입니다. 인증키는 서버에서만 사용합니다. 최초 DB 적재 시 기존 원본 ZIP을 우선 사용하고 없으면 다운로드하여 검증한 ZIP을 `LOANSIGHT_ARTIFACT_ROOT/company/CORPCODE.zip`에 보관합니다. Native 기본 경로는 backend에서 실행할 때 `backend/.run/artifacts/company/CORPCODE.zip`, Compose는 `source-artifacts` 볼륨의 `/data/artifacts/company/CORPCODE.zip`입니다. 두 실행 방식의 원본 캐시는 별개입니다. 캐시가 있으면 최초 적재에도 인증키·외부 요청이 필요하지 않습니다. 공개 기업 식별정보 원본은 Git에 포함하지 않습니다. 서비스 이용은 OpenDART 이용 조건과 호출 제한을 따릅니다.

backend 디렉터리에서 미리 준비하거나 명시적으로 갱신합니다.

```sh
uv run python -m app.modules.company.catalog
uv run python -m app.modules.company.catalog --refresh
```

API가 실행 중이고 인증키가 설정되어 있으면 **마지막 기업코드 다운로드 성공 시점부터 7일마다** 원장을 갱신합니다. `LOANSIGHT_COMPANY_SYNC_ENABLED=false`로 중지할 수 있습니다. 60초마다 기한을 확인하며, 기한 전에 재시작해도 저장된 성공 시각을 유지합니다. 기한이 지난 채 중지되었다면 다음 시작 시 갱신합니다. 여러 API 프로세스는 공유 저장소의 OS 파일 잠금으로 중복 실행을 막으며 프로세스 종료 시 잠금이 해제됩니다. 갱신 파일을 검증한 뒤 원자적으로 교체하고 실패하면 기존 캐시로 검색을 유지합니다. 초기 캐시도 없는 키 미설정·다운로드 실패·잘못된 ZIP/XML·캐시 저장 실패는 빈 결과 대신 503을 반환하며 응답에 키나 원천 오류 본문을 노출하지 않습니다.

### 기업별 사업보고서

`GET /api/v1/companies/{corp_code}/reports`는 해당 기업의 실제 사업보고서 선택 목록을 반환합니다. 고유번호는 8자리이며 활성 기업 원장에 없는 번호는 404, 잘못된 형식은 422입니다. [OpenDART 공시검색 공식 계약](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001)의 `A001`(사업보고서), `last_reprt_at=Y`(최종보고서)로 1999-01-01부터 조회 당일 한국 시각 접수일까지 모든 페이지를 조회합니다. 최근 3개년으로 잘라내지 않습니다. 접수일 검색 범위 이전 자료의 존재 여부를 단정하지 않습니다.

응답은 `corp_code`, `items`, `checked_at`, `search_start`, `search_end`입니다. 각 항목은 `receipt_no`, `report_name`, `fiscal_year`, `period`, `receipt_date`, `withdrawn`을 포함합니다. 사업연도와 결산월은 보고서명 안의 기간에서 읽고 제출연도에서 추정하지 않습니다. 정정 표시는 원래 보고서명으로 유지하고 철회 표시는 선택 불가로 제공합니다. 연도 사이의 공백을 보고서가 있는 것으로 채우지 않습니다. 사업보고서 목록은 연결/별도 재무정보의 제공 여부를 보장하지 않습니다.

조회 결과와 빈 목록 모두 PostgreSQL `company_report_catalog`에 저장합니다. 같은 기업에 대한 동시 요청은 DB 잠금으로 중복 외부 호출을 막습니다. 캐시 유효기간은 기술 설정 `LOANSIGHT_COMPANY_REPORTS_CACHE_SECONDS`(기본 3600초, 0이면 매번 재조회)이며 기간 내 캐시는 API 키 없이도 사용할 수 있습니다. 만료 후 조회가 실패하면 DB의 기존 목록을 덮어쓰지 않고 503을 반환합니다. DART의 자료 없음(`013`)은 성공한 빈 목록, 키 미설정·요청 제한·통신 오류·잘못된 응답·부분 페이지 수집은 조회 실패로 구분합니다. 인증키와 원천 오류 메시지는 응답에 노출하지 않습니다.

원본 페이지 응답은 `LOANSIGHT_ARTIFACT_ROOT/company/reports/originals/`에 SHA-256 기반으로 보존하고 해시를 DB에 기록합니다. 실제 원문 열람은 접수번호로 DART 공식 뷰어에 연결하며 본 API가 보고서 본문이나 재무·주석을 수집·분석하지는 않습니다.

### KSIC11 스냅샷과 갱신 상태

[초기 데이터 안내](data/company/README.md)의 `companies_opendart_ksic11.csv`와 `ksic11_codes.csv`를 사용합니다. 전자는 전체 기업 원장이 아닌 매칭된 기업정보 스냅샷입니다. **두 CSV를 Git에 포함하므로 저장소를 복제하면 초기 수입 자료가 함께 준비됩니다.** 원본 입력 파일은 수정하지 않습니다. UTF-8 BOM과 앞자리 0을 보존하고 기본키 `corp_code`로만 연결합니다. KSIC는 제공 코드표의 11차 코드와 계층을 검증하며 대분류 1자리·숫자 2~5자리의 원래 분류 수준을 유지합니다. `induty_code`는 DART 원본 값이고 `ksic11_code`에 복사하지 않습니다.

기본 입력은 `backend/data/company/`이며 실행 디렉터리와 무관하게 찾습니다. Docker 이미지에도 `/app/data/company/`로 포함하므로 별도 파일 경로 설정이나 호스트 폴더 마운트 없이 사용할 수 있습니다. 외부 자료로 대체할 때만 `LOANSIGHT_COMPANY_SEED_CSV`, `LOANSIGHT_KSIC11_CODES_CSV`로 경로를 바꿉니다. 기존 컨테이너에는 이미지 재빌드와 API 재생성이 필요합니다. 수입 후 갱신되는 운영 데이터와 이력은 기존대로 `LOANSIGHT_ARTIFACT_ROOT`에 저장합니다.

첫 수입에서는 제공 스냅샷에 있는 기업의 현재 ZIP 변경일을 **비교 기준선**으로 기록하며 이를 전 기업 API 조회 완료로 간주하지 않습니다. 스냅샷 밖의 기업은 `outside_seed`로 두고 신규 기업으로 단정하지 않습니다. 이후 ZIP에 추가·변경된 기업은 `company.json` 조회 대기열에 넣으며 조회 시각·원본 SHA-256을 기록합니다. 변경일이 바뀐 기존 KSIC 매핑은 값을 보존하면서 `review_required`로 표시합니다. 최신 ZIP에서 빠진 코드와 기존 기업정보는 삭제하지 않고 별도 비활성/검토 상태로 보존합니다.

기업개황은 기본적으로 분당 최대 20건의 체크포인트 단위로 순차 조회합니다(`LOANSIGHT_COMPANY_PROFILE_BATCH_SIZE`, 0이면 기업개황 호출만 중지). 이 값은 처리 속도 설정이며 전체 대상 수를 제한하지 않습니다. 중단 후 남은 대기열을 이어 처리하며 조회 실패·공란으로 기존 정상 값을 덮어쓰지 않습니다. 인증·요청 제한·통신 오류 발생 시 기업개황 호출을 1시간 쉬고 다시 시도합니다. 기업코드의 주간 갱신은 별도로 유지합니다.

[기업개황 공식 응답](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002)에는 업종명 필드가 없으므로, 코드표만으로 신규 기업의 DART 업종코드를 KSIC11로 변환하지 않습니다. 매칭 근거가 없는 기업은 `unmatched`, 기업정보 변경으로 기존 매핑 재확인이 필요하면 `review_required`입니다. 제공된 KSIC11 코드가 검증된 기업은 `matched`입니다. 명칭을 매칭할 때는 원문 일치만 허용하고 같은 명칭이 여러 분류에 있으면 확인 가능한 공통 상위 코드까지만 선택하는 도구를 제공합니다. 별도 업종명 원천/검증 매핑은 아직 없으므로 신규 기업에 대한 자동 명칭 매칭은 실행하지 않습니다.

`LOANSIGHT_ARTIFACT_ROOT/company/` 아래에 `sync-current.json`(활성 스냅샷 포인터), `history/`(입력·ZIP·기업개황 원본·불변 기준 스냅샷과 증분), `review.csv`(미매칭·재검토·조회 실패·등록번호 충돌·원장 누락)를 보관합니다. 원본 해시·ZIP의 `modify_date`·조회일은 기업 CSV 밖의 동기화 상태에 기록합니다. 법인/사업자번호 충돌은 검토 대상으로 남기며 기업을 병합하지 않습니다. 전체 스냅샷은 원장/입력 변경 시 보존하고 기업개황 조회 진행은 증분으로 보존합니다. 보관 기간·자동 삭제 정책은 확정하지 않았습니다.

수동 수입/동기화·강제 주간 갱신·API 없이 스케줄러를 실행하려면 backend에서 다음 명령을 사용합니다. API 스케줄러와 함께 실행해도 같은 저장소의 잠금으로 보호합니다.

```sh
uv run python -m app.modules.company.sync --profile-limit 0
uv run python -m app.modules.company.sync --force
uv run python -m app.modules.company.sync --watch
```

Compose 수동 동기화는 `docker compose -f deploy/compose.yaml exec api /app/.venv/bin/python -m app.modules.company.sync --force`입니다. 기존 `catalog --refresh`도 사용 가능하지만 원장만 갱신하며, 변경 비교와 검토 목록은 다음 동기화에서 처리합니다. 서비스 대상 4개 업종 판정·공시 목록·실제 분석 연결은 후속 범위입니다. 공개 기업 목록 검색은 사용자 세션 없이 가능하며 사용자별 검토 데이터는 포함하지 않습니다.

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
