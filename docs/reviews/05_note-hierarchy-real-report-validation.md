# 주석 구조화 패키지 실제 사업보고서 실행 검증

> 2026-10-27 · dart-note-hierarchy 0.8.4 · Python 3.12.15 · Windows · Chrome

## 대상과 수집 방법

`backend/.env`에 설정된 DART 키로 공식 API를 호출했다. 키 값과 인증키가 포함된 요청 URL은 출력하거나 산출물에 저장하지 않았다. 사용자가 제공한 wheel을 설치한 분리 가상환경을 사용했으며 서비스 의존성·패키지 원본은 수정하지 않았다.

| 항목 | 확인한 값 |
| --- | --- |
| 기업 | 뉴트리 · 종목코드 270870 · 기업고유번호 01214248 |
| 보고서 | [첨부추가]사업보고서 (2025.12) |
| 접수번호·접수일 | 20260320001416 · 2026-03-20 |
| 원문 | [DART 사업보고서](https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260320001416) |
| 처리 범위 | 같은 보고서의 `3. 연결재무제표 주석`과 `5. 재무제표 주석`을 각각 처리 |
| wheel SHA-256 | `b216e022e13fa3706e11052f5e8d84207e6784c475256aaf64b364825417cb63` |

공시검색 API에 접수기간 2026-03-01~2026-03-31, 코스닥, 사업보고서 A001, 최종보고서 검색, 페이지 크기 10을 지정했다. 결과 중 보고기간이 2025.12이고 이름에 `정정`이 없는 첫 보고서를 선택했다. 통계적 무작위 표본이나 대표성 있는 품질 평가 표본은 아니다. 검색 계약은 [OpenDART 공시검색 가이드](https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019001)를 참조했다.

`https://opendart.fss.or.kr/api/document.xml`로 원본 ZIP과 포함된 XML 3개를 확보해 보관했다. 모듈은 일반 XML을 직접 지원하지 않으므로 XML을 그대로 입력하지 않았다. DART 보고서 목차의 주석 구간 locator로 공개 `report/viewer.do` HTML을 내려받아 연결·별도 입력으로 사용했다. 이 HTML의 보존과 원본 ZIP 보관을 구분하며, XML→HTML 변환의 의미적 동등성을 검증했다고 해석하지 않는다.

## 실행 결과

두 입력 모두 UTF-8이며 `DocumentProcessor("dart", link_periods=True)`로 처리했다. 기업·기간·연결/별도·접수번호·공개 원문 URL과 문서별 고유 ID를 metadata에 연결했다.

| 관찰 항목 | 연결(CFS) | 별도(OFS) |
| --- | ---: | ---: |
| 입력 HTML 크기(bytes) | 459,937 | 368,032 |
| 계층 노드(root 포함) | 216 | 206 |
| 본문 블록 | 867 | 784 |
| 데이터 표 단위 | 120 | 107 |
| 당기·전기 표 후보 / 연결된 제목 그룹 | 24 / 24 | 18 / 18 |
| 직접 부모 미확정(`unresolved`, root 제외) | 48 | 50 |
| 절대 깊이 미확정(`unresolved` + `relative_only`, root 제외) | 67 | 67 |
| 검토 큐 항목 | 112 | 104 |
| 정규화 텍스트 글자수(원문 = 블록) | 66,352 = 66,352 | 55,243 = 55,243 |
| 모듈 구조 검사 | 통과, 오류 0 | 통과, 오류 0 |

원시 HTML의 전체 `<table>` 수는 연결 164개·별도 142개다. 위 표의 데이터 표 단위 수와 집계 대상이 다르므로 차이를 곧바로 표 누락으로 해석하지 않는다. 정규화 텍스트 보존은 확인했지만 모든 표의 의미적 분류를 수동 검수하지는 않았다.

두 결과 모두 다음을 확인했다.

- `structure.json`, `table_units.json`, 원문·검토 HTML, 표별 HTML과 기간 연결 산출물 생성.
- 내려받은 HTML과 `source_original.html` 바이트 일치, 입력 SHA-256과 결과의 `source_sha256` 일치.
- 정규화 원문 텍스트와 블록 텍스트의 글자수·해시 일치(`normalized_text_equal=true`).
- 문서 내 노드 ID 유일성, 존재하는 직접 부모 참조, 모듈 `structural_checks_passed=true`.
- Chrome에서 연결 215행·별도 205행의 계층(root 제외)과 원문 iframe 표시, 첫 미확정 항목 필터·원문 앵커 이동. 페이지 JavaScript 오류 0건.
- 저장된 검증 파일에서 설정된 DART 키 값이 발견되지 않음.

상위 주석에는 연결의 `1. 지배기업의 개요`, 별도의 `1. 당사의 개요`, 양쪽의 `4. 현금및현금성자산`, `5. 금융자산` 등이 생성됐다. 금융자산의 당기말·전기말 표가 같은 축 라벨을 근거로 연결된 사례를 확인했다. `matched`는 셀 값 대응·단위 변환·금액 정확도 검증을 의미하지 않는다.

## 산출물과 해석 범위

검증 산출물은 Git에서 제외한 `.run/dart-real-report-check/`에 있다. 아래 링크는 이번 작업 환경의 로컬 산출물이며 새 체크아웃에 포함되지 않는다.

- [연결 주석 검토 HTML](../../.run/dart-real-report-check/CFS/result/review.html), [별도 주석 검토 HTML](../../.run/dart-real-report-check/OFS/result/review.html)
- [기계 판독용 검증 요약](../../.run/dart-real-report-check/validation-summary.json), [Chrome 검증 결과](../../.run/dart-real-report-check/browser-validation.json)
- 원본 ZIP·공시검색 응답·선택 보고서 정보·보고서 목차·연결/별도 입력 HTML·화면 캡처·이번 검증의 다운로드/처리 스크립트도 같은 폴더에 보관했다.

이번 검증으로 실제 보고서 한 건의 주석 HTML에 대해 패키지 실행·원문 보존·산출물 표시가 동작함을 확인했다. 결과 상태는 여전히 `rule_based_draft_not_gold`, `semantic_accuracy_measured=false`다. 직접 부모 미확정 48/50개와 절대 깊이 미확정 67/67개를 보존했으며, 검토 화면의 미확정 안내는 절대 깊이 미확정 항목을 포함하므로 직접 부모 미확정 집계와 구분한다. 검토 큐 개수도 부모 오류 수나 정확도 지표가 아니다.

전체 계층·표 연결의 정답지 대조, 항목별 사실 추출, 금액·위험규칙 정확도, 다른 기업·기간·업종 적용 품질, 전체 회귀 테스트, 서비스 API·Worker·DB·프론트 통합은 이번 검증에서 수행하지 않았다. 업무 근거로 연결할 때는 [주석 구조화 경계](../design/01_data-and-analysis.md#note-hierarchy)의 검수 절차를 적용한다.
