# 사용방법

버전 0.8.4. 연결·별도 재무제표 주석을 각각 분리한 로컬 HTML이 입력이다. 이 모듈은 HTML을 수집하지 않고, OpenDART API 키나 네트워크 연결을 요구하지 않는다.

## 1. 설치해서 사용하기

Python 3.10 이상이 필요하다. 배포받은 wheel을 가상환경에 설치한다. `lxml>=5,<7`은 pip가 의존성으로 설치한다.

```powershell
python -m pip install ./dart_note_hierarchy-0.8.4-py3-none-any.whl
note-hierarchy --version
note-hierarchy input/notes.html --profile dart --link-periods --output outputs/review
```

Windows에서 명령 경로가 잡히지 않으면 `python -m note_hierarchy`를 사용한다. API의 import 이름은 그대로 `note_hierarchy`다. 프로젝트마다 같은 소스를 복사할 필요가 없다. PyPI에는 게시하지 않았으므로 `pip install dart-note-hierarchy`가 아니라 wheel 경로를 지정한다.

저장소에서 직접 설치하거나 개발 중 수정 사항을 즉시 반영하려면:

```powershell
python -m pip install .
# 개발용
python -m pip install -e .
```

정식 빌드 명령은 저장소 루트에서 실행한다.

```powershell
python -m pip install build
python -m build --outdir outputs/distributions
```

wheel과 `.tar.gz` 소스 배포본이 만들어진다. 소스 배포본을 설치할 때는 빌드 도구가 필요하다. wheel에는 실행 코드·기본 JSON 설정·문서·가상 예제만 포함하고, 테스트·기업 데이터·수집기·API 키·평가 workflows는 제외한다. Python 소스는 플랫폼 공통이지만 `lxml`의 설치 가능 여부는 대상 Python과 운영체제에 따라 달라질 수 있다.

### 소스 복사 방식도 가능

실행용 ZIP을 프로젝트 루트에 풀거나 다음 파일을 구조 그대로 복사한다.

```text
프로젝트/
  note_hierarchy/
    __init__.py
    __main__.py
    api.py
    settings.py
    requirements.txt
    config/             # default.json 필수. 이 폴더를 빼면 import 실패
    engine/
    adapters/
    finance/
    rendering/
  input/
    notes.html
```

하위 폴더의 Python 파일과 `__init__.py`를 모두 포함한다. `workflows/`, 테스트, 과거 호환·실행 스크립트, 수집 데이터, `.env`, `outputs/`, `__pycache__/`는 공개 API 사용에 필요하지 않다.

복사 방식을 선택한 경우 아래 명령은 `note_hierarchy/`가 들어 있는 프로젝트 루트에서 실행한다.

```powershell
python -m pip install -r note_hierarchy/requirements.txt
python -m note_hierarchy --version
```

Python 3.10 이상, `lxml>=5,<7`이 필요하다.

## 2. Python API

```python
from note_hierarchy import DocumentProcessor

processor = DocumentProcessor("dart", link_periods=True)
result = processor.process_file(
    "input/notes.html",
    document_id="company_2025_separate",
    metadata={
        "title": "기업명",
        "period": "2025.12",
        "kind": "별도",
    },
)

nodes = result.data["nodes"]
blocks = result.data["blocks"]
scopes = result.data["numbering_scopes"]
tables = result.table_units
paths = result.write("outputs/company_2025_separate")
print(paths["review"])  # 트리와 본문 대조 화면
```

- `dart`를 명시한다. 생략하면 `generic`이며 금융 기간 연결을 켤 수 없다.
- `link_periods=False`로 당기·전기 연결을 생략할 수 있다. DART 표 추출·문맥·내용 크기는 유지된다.
- `document_id`는 문서마다 고유하게 지정한다. 파일 입력에서 생략하면 파일명이 사용된다. 노드·블록 ID는 문서 내부 ID이며 다른 문서의 같은 ID와 합치면 안 된다.
- 기본 인코딩은 UTF-8이다. 필요하면 `DocumentProcessor("dart", encoding="euc-kr")`처럼 지정한다.
- 기존 출력 폴더에는 같은 파일명이 덮어써지고, 이전 실행의 잔여 파일은 자동 삭제되지 않는다. 실행별 새 폴더를 권장한다.

메모리의 HTML도 처리할 수 있다.

```python
result = processor.process_html(
    html_string_or_bytes,
    document_id="company_2025_consolidated",
    metadata={"title": "기업명", "period": "2025.12", "kind": "연결"},
)
```

문자열은 디코딩된 HTML로 처리하고 원본 저장 시 UTF-8로 인코딩한다. 바이트·파일 입력의 원본 해시는 실제 입력 바이트 기준이다.

## 3. CLI

```powershell
python -m note_hierarchy input/notes.html --profile dart --link-periods --document-id company_2025_separate --title "기업명" --period 2025.12 --kind 별도 --output outputs/company_2025_separate
python -m note_hierarchy --help
```

`--config`는 부분 설정 JSON, `--encoding`은 입력 인코딩, `--base-url`은 검토 HTML의 상대 자원 기준 URI다. `--link-periods`는 표를 숫자로 합산하거나 연도별 보고서를 이어 붙이는 옵션이 아니다.

예제 파일이 포함된 배포본에서는 아래 명령으로 동작을 확인할 수 있다.

```powershell
python -m note_hierarchy note_hierarchy/examples/dart_notes.html --profile dart --link-periods --document-id demo --period 2025.12 --kind 별도 --output outputs/demo
```

예제는 가상 문서다. `1. → 2-1. → 2-2. → 3.`의 같은 레벨 분할과 당기말·전기말 표를 포함한다.

## 4. 여러 파일 처리

```python
from pathlib import Path
from note_hierarchy import DocumentProcessor

processor = DocumentProcessor("dart", link_periods=True)
for source in sorted(Path("input").glob("*.html")):
    result = processor.process_file(source, document_id=source.stem)
    result.write(Path("outputs") / source.stem)
```

이 예시는 파일명이 문서별로 고유하다고 가정한다. 연결·별도와 결산기간이 다른 문서는 별도 ID·출력 폴더를 사용한다. 한 문서의 상태를 다음 문서의 번호 판단에 이어 사용하지 않는다.

## 5. 출력 파일

| 파일·폴더 | 내용 |
|---|---|
| `structure.json` | 블록·계층·번호 범위·부분 관계·크기·제목 후보·검증 정보 |
| `table_units.json` | 원본 표 HTML, 소속 노드, 제목·단위·앞뒤 설명 |
| `source_original.html` | 입력 원문 바이트. 문자열 입력은 UTF-8 저장 |
| `source.html` | 원문 위치 앵커를 추가한 검토용 파생 HTML |
| `review.html` | 계층과 원문을 함께 보는 화면 |
| `tables/` | 표와 주변 문맥별 HTML |
| `period_table_candidates.json`, `period_candidates/` | 기간 표 후보 전체와 판정 근거. 옵션 사용 시 |
| `period_groups/` | 연결된 당기·전기 표 비교 화면. 연결이 있을 때 |

CSS·이미지를 모듈이 내려받지는 않는다. 필요하면 `metadata["source_url"]`과 `write(base_url=...)`로 기준 URI를 지정한다. 브라우저는 해당 URI의 외부 자원을 요청할 수 있다. 기존 로컬 자원 메타데이터가 있다면 `write(resource_root=...)`로 그 경로 기준을 지정한다.

## 6. 계층과 부분 관계 읽기

```python
by_id = {node["id"]: node for node in result.data["nodes"]}
for node in result.data["nodes"][1:]:
    print(node["marker_raw"], node["title"], node["level"], node["parent_id"])
    print(node.get("known_ancestor_ids", []), node.get("sibling_group_id"))
```

기본 탑다운 방식의 주요 필드:

| 필드 | 의미 |
|---|---|
| `parent_id` | 추론한 직접 부모. 불명확하면 null |
| `level` | 절대 depth. root는 0, 상위 주석은 1. 결정할 수 없으면 null |
| `status=inferred` | 직접 부모와 절대 depth를 부여한 상태. 정답 확정이라는 뜻은 아님 |
| `status=relative_only` | 직접 부모는 있지만 상위 깊이가 미확정이라 자신의 depth도 null |
| `status=unresolved` | 직접 부모 미확정 |
| `known_ancestor_ids` | root부터 안쪽 순서로 보존된 조상 소속. 인접한 ID가 반드시 직접 부모·자식인 것은 아님 |
| `containment_status` | `ancestor_known_parent_unknown`, `parent_known`, `document_only`로 소속 상태 구분 |
| `numbering_scope_id`, `sibling_group_id` | `numbering_scopes`의 문서 내부 그룹 ID |
| `previous_sibling_id`, `next_sibling_id` | 같은 목록의 원문 순서. 직접 부모 판정과 분리 |
| `display_level` | 화면 들여쓰기용. 집계용 확정 depth로 사용하면 안 됨 |
| `evidence`, `review_flags`, `confidence` | 규칙 근거·검토 사유·근거 강도. 정확도 확률이 아님 |

예를 들어 `13. 무형자산` 아래 가상자산 `(1)~(3)`의 중간 부모가 불명확해도 `13.` 소속과 세 항목의 형제 관계는 보존할 수 있다. 이를 위해 가상 제목·부모를 합성하지 않는다.

같은 레벨의 분할 번호는 `numbering_interpretation="split_sibling"`, `sequence_value`, `split_index`, `split_evidence`로 표시한다. `34-1.`은 원래 `marker_type="numeric_path"`, `numeric_path=[34,1]`을 보존하므로 **번호 타입만 보고 자식 depth라고 판단하면 안 된다.** 실제 부모·깊이와 해석 필드를 확인한다.

`numbering_scopes`에는 부모/제안 부모, 범위 블록, 실제 표기 패턴, 번호 목록, 구성원 ID와 상태가 있다. 범위마다 다른 형식 체계를 허용하며 문서 전체에 하나의 고정 형식 순위를 강제하지 않는다.

`unnumbered_heading_candidates`는 번호 없는 제목 제안일 뿐이다. 실제 트리에 자동 삽입하지 않는다. `review_queue`에도 설명 문장 여부 등의 경고가 들어갈 수 있으므로 개수 전체를 부모 미확정 수로 해석하지 않는다.

## 7. 내용 크기·말단·RAG

`node["content_metrics"]["direct"]`는 직속 내용, `["subtree"]`는 실제 직접 부모 연결로 이어진 자손 포함 범위다.

| 지표 | 측정 기준 |
|---|---|
| `narrative_characters` | 제목·표를 제외한 본문 공백 제외 글자수 |
| `heading_characters` | 제목 공백 제외 글자수 |
| `table_text_characters` | 표 안 텍스트 공백 제외 글자수 |
| `text_characters_total` | 위 세 글자수의 합 |
| `table_count`, `table_rows`, `table_cells` | 데이터 표 단위와 실제 HTML 행·셀 수. 병합 펼침 후 논리 격자 수가 아님 |

말단은 현재 그래프에서 자식이 없는 노드다.

```python
from collections import Counter

nodes = result.data["nodes"]
children = Counter(n["parent_id"] for n in nodes if n["parent_id"] is not None)
leaves = [n for n in nodes if n["id"] != "root" and not children[n["id"]]]
known_leaves = [n for n in leaves if n["level"] is not None]
unknown_leaves = [n for n in leaves if n["level"] is None]
```

말단은 의미적으로 분리가 끝났다는 뜻이 아니다. 제목만 있는 말단과 표가 여러 개 묶인 큰 말단 모두 존재할 수 있다. 말단만 취하면 비말단 직속 본문·표가 빠지므로, RAG 입력은 **모든 노드의 직속 소유 내용**도 확인해야 한다. root 직속 내용 역시 확인한다.

부모 subtree와 자식 subtree를 합하면 중복 집계된다. `known_ancestor_ids`로 보존한 소속은 누락된 직접 부모 간선을 대신하지 않으므로 subtree 통계에 자동 합산하지 않는다. 원문 블록은 한 소유자에만 배정하고 root의 전체 범위는 문서 전체를 포함한다.

실제 검색 입력의 크기는 사용할 토크나이저로 측정한다. 글자수는 토큰 수가 아니며, 큰 표를 어떻게 나눌지는 이 계층 모듈 밖의 후속 처리다.

## 8. 표와 당기·전기 연결

`result.table_units`의 `raw_table_html`, `owner_node_id`, `display_title`, 앞뒤 문맥과 `shape`를 확인한다. 문맥 경계는 휴리스틱이며 원문 표와 별도로 보존된다.

`link_periods=True`는 같은 직속 계층의 연속 당기·전기 표를 후보로 잡고, 같은 축의 라벨과 제목·단위·기간 역할을 비교한다. 연속 `당기·당기·전기·전기` 묶음도 처리한다. 표를 전치하거나 금액을 합산하지 않는다.

`period_table_candidates`는 후보 전체, `period_title_links`는 연결된 제목 그룹, `period_table_runs`는 연속 묶음의 교차 비교와 보류 정보를 담는다. 제목 연결은 셀·금액의 일대일 대응을 보장하지 않는다. 자세한 내용은 [표·기간 연결](finance/README.md)을 참고한다.

## 9. 설정 변경

`config/default.json`을 직접 고치기보다 부분 설정을 전달한다.

```python
processor = DocumentProcessor(
    "dart",
    link_periods=True,
    config={"hierarchy": {"support_split_sibling_numbers": False}},
)
```

```json
{
  "hierarchy": {
    "strategy": "top_down",
    "allow_integer_enclosure_variants": true,
    "support_split_sibling_numbers": true,
    "split_sibling_min_members": 2
  }
}
```

파일로 저장했다면 `config="my_rules.json"` 또는 CLI `--config my_rules.json`을 사용한다. `strategy="sequential"`은 이전 순차 방식과 비교할 때만 선택한다. 이 방식에는 최신 부분 관계 필드가 모두 있지 않을 수 있다.

딕셔너리는 부분 병합, 배열은 전체 교체다. 알 수 없는 키와 잘못된 타입·정규식은 거부한다. 설정 적용 범위는 처리기 호출마다 격리된다. 자세한 설명은 [설정 문서](config/README.md)를 참고한다.

## 10. 전체 소스의 유지보수 도구

아래 명령은 전체 소스 체크아웃에서만 실행한다. 실행용 ZIP에는 해당 Python 스크립트나 검증 데이터가 없다.

```powershell
python -m unittest discover -s note_hierarchy -p 'test_*.py' -q
python -m note_hierarchy.workflows.export_runtime --output outputs/note_hierarchy_runtime_0.8.4.zip
python -m note_hierarchy.workflows.evaluate_split_numbering
python -m note_hierarchy.workflows.analyze_current_leaves
```

데이터셋 워크플로는 이 프로젝트의 `outputs` 자료가 필요하다. 기업 선정·수집 스크립트는 구조화 모듈과 별개이며, 기존 동결 평가에는 코드·설정 해시 검사가 있어 최신 코드로 무조건 재실행할 수 없다. 과거 import 호환층은 전체 소스에서만 유지한다.

PDF·이미지·일반 XML·XBRL은 직접 입력할 수 없다. CSS 계산 좌표·JavaScript 실행도 하지 않는다. 구조 검사 통과는 원문 보존과 소속 일관성에 대한 확인이며 제목·부모·표 문맥의 의미 정확도 보증이 아니다.
