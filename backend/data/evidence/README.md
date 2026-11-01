# 선택 적재 공시 근거

현재 시범 자료는 `loansight_ofs_20261031.dump`에서 선택한 보고서 4건이다.
선택 사유는 [pilot_selection.json](pilot_selection.json), 원천별 행 수·바이트·SHA-256은
[pilot_manifest.json](pilot_manifest.json)에 보존한다. 원천 본문과 접속정보는 Git에 넣지 않는다.

| 대상 | 선택 행 수 | 내용 |
|---|---:|---|
| report | 4 | 기업·접수번호·기간·공시일·정정/수집 상태 |
| note_section | 108 | 선택 보고서의 OFS 주석 본문·표·단위·캡션 |
| doc_section | 180 | 같은 보고서의 공통 영역. 64행은 body_skipped |
| audit_opinion | 8 | OFS 4행·CFS 4행을 원래 범위대로 보존 |

선택 추출물은 합계 2,855,361바이트이며 정규화 구간은 1,300개다. OFS 묶음의 조회는
OFS·회사 공통·범위 미확인 구간만 포함하고 CFS 감사 자료는 제외한다. 뉴트리·현대건설·
삼성전자의 2025년 보고서와 재무 미보유 사건 기업의 2016년 보고서를 시범 대상으로 삼았다.
이는 전 기업 적재나 전체 주석 커버리지 확보를 의미하지 않는다.

## 추출·적재

```sh
# backend에서 실행. 호스트에 pg_restore가 필요하며 아카이브 SQL은 실행하지 않는다.
python -m app.modules.evidence.dump_archive --archive ../loansight_ofs_20261031.dump --selection data/evidence/pilot_selection.json --output ../.run/evidence-selected
alembic upgrade head
# 별도 원천 DB의 적재 계정 URL을 LOANSIGHT_SOURCE_DATABASE_URL 환경변수에 설정한다.
python -m app.modules.evidence.dump_load --directory ../.run/evidence-selected
```

명시한 기업·접수번호에 속한 네 테이블만 추출한다. note_section은 OFS만 선택한다.
service.* 복사 테이블, 재무 원본과 구체화 뷰는 포함하지 않는다. 원본 표 JSON의 불규칙
행·대시·문자열과 보고서 영역·회계 범위를 보존한다. 표를 새 HTML 원본으로 만들지 않는다.

관리자가 현재 PostgreSQL 인스턴스에 별도 원천 DB를 생성하고 전용 적재 계정에만
생성/쓰기 권한을 부여한다. 읽기 역할은 CONNECT·스키마 USAGE·테이블 SELECT만 부여한다.
서비스 API에는 원천 DB 접속정보를 제공하지 않는다. 로컬 적용 DB는 loansight_source,
적재 역할은 loansight_source_loader, 읽기 역할은 loansight_source_reader(NOLOGIN)다.
재사용 시 기존 DB 소유자를 확인하며 기존 DB 삭제나 전체 복원을 하지 않는다.

원천 DB의 evidence_load / evidence_raw에는 선택 manifest·체크포인트와 원래 행 JSON을
저장한다. 파일 해시·선택 키를 검증한 뒤 100행 단위로 체크포인트를 저장해 재실행한다.
서비스 게시 트랜잭션이 실패하면 정규화 결과 전체가 롤백돼 부분 버전이 노출되지 않는다.
동일 패키지는 재사용한다. 원천 DB와 서비스 DB를 함께 백업한다.

서비스 DB에는 evidence_dataset / evidence_report / evidence_segment로 정규화 결과를
저장한다. 기본 재무·기존 HTML 구조화 결과를 덮어쓰지 않는다. 어댑터의 의미가 바뀌면
dump-evidence 버전을 올려 새 패키지·새 정규화 버전으로 처리한다.

## 보고서별 근거 묶음

POST /api/v1/me/evidence-bundles에 corp_code, receipt_no, scope를 제출하면 정확히
일치하는 최신 READY 덤프 버전과 사용자 소유의 완료된 공식 HTML 결과를 연결한다.
사용자 업로드는 structure_ids에 명시해야 하며 소유권·기업·접수번호·범위·기간을 검사한다.
빈 배열은 HTML을 제외한다. 현재 덤프는 OFS를 지원하며 CFS는 기존 소유 HTML이 필요하다.

묶음은 Workspace·원천 revision·HTML 목록·당시 사건/조회 범위 적재 ID를 고정한다.
새 자료가 생기면 새 묶음을 만들고 기존 URL은 유지한다. 기존 HTML의 structure_id와
실제 XPath는 보존하고 덤프 위치는 원천 행·표 seq·JSON 행/열로 표현한다.

| API (/api/v1/me 아래) | 역할 |
|---|---|
| GET /companies/{corp_code}/evidence-reports | 재무 보유 여부와 무관한 적재 보고서 목록 |
| POST /evidence-bundles, GET /evidence-bundles/{id} | 개인별 불변 자료 집합 생성/조회 |
| GET /evidence-bundles/{id}/sections | HTML·덤프 목차와 생략 상태 |
| POST /evidence-bundles/{id}/search | 공백 정규화 키워드 검색·서버 페이지 처리 |
| GET /evidence-bundles/{id}/context | 고정된 본문·단위·표 행 페이지 |
| GET /evidence-bundles/{id}/segments/{segment_id} | 인용 근거 이동 |
| POST /evidence-bundles/{id}/baseline | 기존 공통 6항목 후보 검색 저장 |
| GET/POST /evidence-bundles/{id}/agent | 기존 Codex 실행 기반의 비동기 보완 탐색 |

통합 도구는 후보별 출처를 유지한다. 동일 사실의 자동 병합·충돌 금액의 자동 선택은 하지
않으며 서로 다른 출처의 후보가 나란히 표시된다. 인용은 고정 묶음의 실제 읽은 구간인지와
정확한 문자열 일치를 검사한다. 결과는 PENDING이며 문자열 검사는 의미 검수와 다르다.
중단 작업의 재전달은 모델을 자동 재호출하지 않는다. 인증·실행 제한은
[기존 Codex 설정](../../README.md#note-agent)을 사용한다.

## 화면과 한계

기업 선택 패널의 '저장된 주석·공시 근거', 기존 주석 화면의 '함께 근거 검색', 재무 분석의
주석·예측 메뉴에서 진입한다. /reports/{기업}/{접수번호}/{OFS|CFS}/evidence에서 불변
/evidence/{bundle_id}/evidence로 이동하며 prediction 메뉴는 같은 묶음의 근거와 고정된
사건 이력을 제공한다. 기존 /notes 주소와 원문 강조는 유지한다.

본문 생략·미확인 범위·자료 부족·미검수를 표시한다. 부분 영역이 있다고 전체 감사보고서
검토를 완료한 것으로 처리하지 않는다. 후보 없음은 공시상 없음이 아니다. 덤프 표에는
병합 정보가 없으며 긴 셀/많은 열은 기술 제한에 따라 잘릴 수 있다.

모델 입력은 WITHHELD_UNVERIFIED로 유지한다. 예측 모델 호출·위험규칙 판정·수치 보완의
자동 채택은 후속이다. 사실별 검수 저장은 아래 계약으로 지원한다. 덤프의 note_fill / fs4_note_applied는 이번에
적재하지 않았다. 실행 결과는 [검증 기록](../../../docs/reviews/27_dump-evidence-integration-validation.md),
후속 순서는 [통합 계획](../../../docs/design/07_dump-evidence-integration.md)을 따른다.

<a id="structured-facts"></a>

## 구조화 사실과 사람 검수

동일 근거 묶음의 덤프·HTML에서 사실 후보를 함께 저장한다. 대상은 감사의견·계속기업,
차입금 만기·약정, 신용등급, 담보, 소송·제재, 보증·후속 사건이다. 사실에는 대상·방향·
기준 기간·상대방·금액 역할·원문 금액·통화·단위·만기·상태와 항목별 정확한 인용을 보존한다.
확인되지 않은 필드는 null/UNKNOWN으로 남기며 미검출을 0이나 '공시상 없음'으로 바꾸지 않는다.

서비스 DB의 evidence_fact는 내용을 수정하는 대신 새 revision을 추가한다. fact_review에는
검수자·사유·결정·전후 상태·버전을 기록하고 fact_opening에는 해당 사용자의 원문 열람 버전과
본문/표 해시를 기록한다. 모두 근거 묶음의 Workspace 권한을 따른다. 새 migration은
06a9c2d40210이며 기존 재무·원천 DB를 변경하지 않는다.

| API (근거 묶음 /api/v1/me/evidence-bundles/{id} 아래) | 역할 |
|---|---|
| GET/POST /facts | 후보 페이지 조회 / 직접 작성. 같은 내용은 재사용 |
| GET /fact-sources?segment_id=... | 검수용 본문 4,000자·표 20행 페이지와 실제 셀 좌표 |
| GET /facts/{fact_id} | 현재 내용·검수 이력·수정본 목록 |
| POST /facts/{fact_id}/open | 현재 원문·전체 인용 열람과 사용자별 열람 기록 |
| POST /facts/{fact_id}/revisions | expected_version·사유·수정 내용으로 새 PENDING 생성 |
| POST /facts/{fact_id}/reviews | request_id·expected_version·사유·APPROVE/REJECT/REOPEN |
| POST /fact-audit-candidates | 명시적 덤프 감사기록을 재사용해 PENDING 후보 생성 |
| GET/POST /fact-extraction | 설정된 Codex 런타임으로 제한된 비동기 구조화 추출 |

인용 문자열·항목별 인용·금액 셀·단위·통화·기간 머리글을 기계적으로 검사한다. 금액은
저장된 원문 셀을 직접 가리켜야 하며 단위도 해당 표에 표시돼 있어야 한다. 단위가 다른
표/본문에만 있거나 머리글의 기간이 모호하면 금액 승인을 차단한다. 안전하게 연결할 수 없는
경우 금액을 비우고 비수치 사실만 검수하거나 추가 근거를 확보한다. 대시·빈값을 0으로
변환하거나 금액을 합산·추정·절댓값 처리하지 않는다. Decimal로 단위 환산하며 환율 변환은 없다.
HTML의 rowspan/colspan은 기존 표 격자 도구로 실제 셀에 대응하고, 덤프는 저장된 JSON 좌표를 쓴다.

CITATIONS_VALID는 인용과 수치의 기계적 검사 결과다. 사실의 의미·방향·기간에 대한 사람의
승인과 구분한다. 승인에는 같은 사용자·같은 사실 버전의 원문 열람 기록과 검수 사유가
필요하다. 원문 변경·오래된 버전·다른 금액으로 승인된 관련 사실이 있으면 거부한다. 검수는
버전 잠금과 요청 ID로 중복 적용·동시 변경을 막는다. 수정본은 새 PENDING이며 이전 승인을
물려받지 않는다. 반려·재검수와 이전 수정본 이동도 지원한다.

대상·종류·방향·기간·상대방·금액 역할·만기가 같은 후보의 값이 같으면 '동일 필드', 다르면
'충돌 가능'으로 표시한다. 이는 완전한 동일 사실 판정이 아니며 자동 병합·출처 우선순위·
허용 오차 정책을 만들지 않는다. 기존 승인을 재검수하거나 잘못된 후보를 수정한 뒤 결정한다.

Codex는 기존 인증·도구 예산·시간 제한·Outbox/Worker 기반을 사용한다. 여섯 항목별 실제
검색과 읽은 범위 안의 정확한 인용을 확인하고, 오류·미조회 인용은 미완료로 남긴다. 작업이
중단돼 재전달되면 모델을 자동 재호출하지 않는다. 재시도는 사용자가 다시 요청한다. 명시적
감사기록 가져오기는 모델을 호출하지 않으며 Y/N 플래그만으로 계속기업 위험의 부재를 만들지 않는다.

두 화면의 '구조화 사실 검수'에서 후보를 가져오고 원문을 열어 승인·반려·수정한다. 검색한
원문의 '사실 후보 작성'으로 직접 추가할 수 있고, 편집 중 다른 HTML/덤프 구간도 검색해
항목별로 연결할 수 있다. 승인 후에도 model_eligible=false이며 보고서 묶음 전체가 승인된
것으로 취급하지 않는다. 예측 시점·공개 시각·모델 특징 계약과 위험규칙 연결은 후속이다.
실행 검증은 [사실 검수 검증 기록](../../../docs/reviews/28_structured-fact-review-validation.md)을 따른다.

<a id="risk-inputs"></a>

## 현재 위험징후 규칙 입력

GET /api/v1/me/evidence-bundles/{id}/signals는 같은 Workspace의 사실에서 현재 규칙 입력과
판정 상태를 계산한다. facts / next_offset으로 30개씩 조회하며 limit은 최대 100이다. 원문
열람과 검수는 기존 사실 API를 사용한다. 이 조회는 재무 분석이나 사실의 승인 상태를 수정하지 않는다.

입력은 APPROVED인 사실 중 인용/수치 재검증 통과, 저장 당시와 동일한 원문 해시, 묶음과
동일하고 명시적인 기준 기간, 미해결 충돌 없음인 경우에만 READY다. 반려·대체된 사실은
사용하지 않는다. 재검수·수정본·원문 변경·다른 값의 미해결 후보가 있으면 다음 조회에서
제외한다. 사실 조회의 공유 행 잠금과 검수의 묶음 잠금으로 승인 철회와 조회를 일관되게 처리한다.
과거 기간 또는 기간 없는 감사 후보도 기계 인용 검사를 통과했다는 이유만으로 사용하지 않는다.
감사기록 가져오기는 원천 행의 period가 묶음 기간과 정확히 같을 때만 해당 값과 직접 인용을
채운다. 원천 기간이 없거나 다르면 묶음 기간으로 추정해 채우지 않는다.

여섯 주석 범주별로 입력 미확보·검수 대기·입력 보류·규칙 정의 대기·평가/부분 평가를
구분한다. 사건 관계는 기재된 사실/명시적 부정과 규칙에 따른 조건 존재/실제 사유 발생을
분리한다. 기재나 검색어 일치만으로 위험 단계를 만들지 않는다.

규칙은 서버의 modules/risk/registry.py에서 버전 관리한다. HTTP 요청으로 임계값이나
판정 기준을 주입할 수 없다. 규칙 ID·버전·기준 출처·주석 범주·사실 종류·판단 관점·단계·
사건 관계와 정확한 필드 조건이 필요하다. 실제 사유 발생 규칙에는 명시적인 상태 조건이
필수다. 금액 조건은 통화와 한도/잔액 등 역할이 일치해야 하고 Decimal로 비교한다. 이
초기 실행기는 한 사실의 정확한 필드 조건과 단일 금액 비교를 지원하며 복수 사실 합산,
환율 변환, 시계열/업종별 복합 규칙과 표시 우선순위는 구현 범위에 포함하지 않는다.

현재 저장소의 N-U12/17과 23개 RISK 원자료·단계 기준은 미정이다. 따라서 운영 registry는
빈 상태로 두며 DEFINITION_PENDING을 반환한다. 데모 조건이나 테스트 임계값을 운영 규칙으로
등록하지 않는다. 경고 0건·정상으로 대체하지 않고, 확정된 기준을 제공받아 검토한 코드 변경으로
정의를 추가한다. 테스트용 합성 정의로 실행기 동작만 검증한다.

응답은 사실 버전·현재 근거 해시·실행기 버전·규칙 버전을 반영한 input_revision과
registry_revision을 포함한다. 현재 결과는 조회 시 계산하며 별도의 과거 판정 실행 스냅샷을
저장하지 않는다. 이전 판정의 영속 저장과 분석 revision 통합은 실제 규칙 등록 단계에서 연결한다.
규칙 입력 준비는 예측 모델 사용 승인과 다르며 model_eligible=false를 유지한다.

두 화면의 '현재 위험징후 규칙' 패널에서 입력 상태와 판정 기준/버전, 사실 검수 근거를
연결한다. 검수 저장 뒤 쿼리를 무효화하며 다른 사용자의 캐시와 분리한다. 실행 결과와
실제 Codex 호출 준비 상태는 [후속 검증 기록](../../../docs/reviews/29_risk-inputs-and-live-extraction-validation.md)을 따른다.

<a id="exposure-summary"></a>

## 보증 구성·1년 내 만기·소송 현황

`GET /api/v1/me/evidence-bundles/{id}/exposure-summary`는 같은 Workspace의 승인 사실을
재검증해 화면 3·4번의 집계 자료를 반환한다. 묶음 revision·기간·회계 범위를 유지하고,
원문 변경·충돌·검수 대기·다른 통화/범위의 금액은 제외한다. 조회는 사실을 승인하거나
위험규칙·모델을 실행하지 않는다. 응답 금액은 원 단위의 Decimal 문자열이다.

- 금액 역할을 `LIMIT` 한도, `COMMITMENT` 보증·약정, `LOAN_BALANCE` 대출잔액,
  `RELATED_PARTY` 특수관계 제공분, `PROVISION` 소송충당부채로 구분한다. 원금이나 일반
  보증액을 대출잔액으로 대체하지 않는다. 새 역할도 표 셀·단위·기간·역할 인용이 필요하다.
- `obligation_type`은 PF 보증·책임준공/채무인수·자금보충·중도금 보증 등을 구분한다.
  `aggregation_level`은 `DETAIL`/`SUBTOTAL`/`TOTAL`/`UNKNOWN`이며 원문 인용과 행 구분을
  확인한다. 상세가 있으면 총계/소계를 더하지 않고, 총계만 있으면 단일 총계 행만 사용한다.
  같은 유형의 여러 원문 표는 중복 여부를 해결하기 전까지 합산하지 않는다.
- 제공과 수취를 분리하고 제공 대출잔액 합계를 분자로 쓴다. 자기자본은 묶음에 고정된
  CSV 적재 버전·기업·접수번호·범위·사업연도가 맞는 12월 결산 단일 행의 `bs_te`를 사용한다.
  자기자본 미확보/0 이하 또는 분자 미확인 시 비율을 보류한다. 이는 확보분의 설명용
  비율이며 운영 위험규칙 등록/판정과 별개다.
- `project_count`는 직접 공시된 사업장 수다. 피보증처 수로 대체하거나 서로 다른 의무 행의
  수를 임의로 더하지 않는다. 단일 행 또는 직접 공시된 총계가 있어야 표시한다.
- 차입금·사채 잔액과 제공 의무의 대출잔액을 공시 기준일(결산월 말일)에서 달력상 1년으로
  나눈다. 정확한 날짜로 확인되는 만기만 분류하고, 미확인/미공시와 기준일 전 만기는 별도
  구간으로 둔다. 빈값·대시를 0으로 만들지 않는다. 구간 요약과 같은 자료를 만기 사다리에서 연다.
- 피고 소송의 직접 공시된 총건수·소송가액·충당부채와 사건번호가 확인된 상위 3건을 표시한다.
  `case_number`/`case_count`도 직접 인용이 필요하다. 같은 사건의 여러 출처를 더하지 않으며
  원고와 피고를 합산하지 않는다. 소송가액을 확정 손실로 표시하지 않는다.
  상위 사건에는 소제기일(`filing_date`)·원고(`counterparty`)·내용(`statement`)·진행상황(`status`)을
  연결한다. `filing_date`는 날짜와 소제기일 문맥을 인용해야 하며 공시일·기일로 대체하지 않는다.
  소송 관련 설명(`case_note`)은 원문을 직접 인용하고 해당 원문 출처를 함께 반환한다.
  같은 사건의 메타데이터가 다르면 임의로 하나를 고르지 않고 미확보로 표시한다. 원고의
  공시 총건수·소송가액은 별도 참고 통계로 제공하며 피고와 합산하지 않는다.

집계 필드는 기존 사실 편집의 **구성·만기·소송 집계 정보**에서 작성하고 검수한다.
JSON 사실 계약을 확장했으며 테이블 migration은 필요하지 않다. 기존 사실의 미확인 필드는
자동으로 확정하지 않는다. [화면·집계 검증](../../../docs/reviews/32_exposure-and-maturity-ui-validation.md)을 참고한다.
