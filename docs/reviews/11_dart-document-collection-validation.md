# DART 원문 자동 수집·주석 구조화 검증

> 2026-10-28 · dart-note-hierarchy 0.8.4 · PostgreSQL 17 · 실제 Compose/RabbitMQ/Worker

## 변경과 계약

선택한 사업보고서의 공식 원본 ZIP/XML과 주석 뷰어 HTML을 각각 보존하고, 기존 Workspace별 주석 구조화 작업을 자동 접수한다. 상세 계약은 [DART 원문 자동 수집](../../backend/README.md#dart-원문-자동-수집)에서 관리한다. XML→HTML 변환을 구현한 것으로 해석하지 않는다.

## 실제 자료 결과

뉴트리 `01214248`의 `[첨부추가]사업보고서 (2025.12)`, 접수번호 `20260320001416`을 실제 API→Outbox→RabbitMQ→Worker로 처리했다. 요청은 검증용으로 새로 발급한 사용자 세션에서 수행했으며 기존 사용자의 세션·작업을 변경하지 않았다. 인증키·사용자 코드·쿠키는 출력하거나 검증 문서에 기록하지 않았다.

| 항목 | 결과 |
| --- | --- |
| 원본 ZIP | 370,390 bytes, SHA-256 기반 저장 |
| ZIP 내부 XML | 3개, 각각 원본 바이트·해시·파일명·크기 보존 |
| 목차 | 원본 HTML 보존, 연결·별도 주석 locator 각각 확인 |
| 별도(OFS) 주석 HTML | 368,032 bytes, 구조화 784개 구간 |
| 연결(CFS) 주석 HTML | 459,937 bytes, 구조화 867개 구간 |
| 원본 재사용 | 두 범위가 동일 ZIP 해시를 참조하며 재요청은 기존 작업 재사용 |
| 출처·구조 검사 | 저장 HTML 해시와 파서 입력 해시 일치, `input_origin=dart_viewer_note_html`, 구조 검사 통과 |
| DB 보존 | `dart_document` 1건·`dart_note` 2건과 Workspace별 원문·구조·구간 참조 확인 |

이 결과는 앞선 [실제 보고서 패키지 검증](05_note-hierarchy-real-report-validation.md)의 같은 입력 크기·구간 수와 일치한다. 의미적 정답지 대조·금액/위험규칙 정확도 검증을 뜻하지 않으며 `evidence_verified=false`와 미확정 계층을 유지한다. 원문 HTML은 앱에서 실행·렌더링하지 않는다.

## 검사

| 검사 | 결과 |
| --- | --- |
| 전체 백엔드 검사 | 94개 통과, 5개 건너뜀 |
| 수집 단위 검사 | 정확한 범위 식별·중복/잘못된 접수번호 거부·원본 바이트 보존·경로 추출 금지·잘못된 ZIP/HTML 거부·독립 Worker 모델 등록 통과 |
| 수집/기존 파서 통합 | 3개 통과: 기존 파서 자동 접수, 중복·회계 범위 분리, 위조 요청 거부, 실패 시 부분 구조 미등록, 공개 파일 재사용과 Workspace별 접근 격리 |
| 마이그레이션 | 격리된 테스트 DB에서 upgrade·모델 비교·downgrade 통과 |
| 프론트엔드 검사 | 57개 통과, 빌드·ESLint 통과 |
| 실제 Chrome PC·태블릿 | 기업 검색/보고서 선택 2개와 실제 수집·구조화·알림 2개, 합계 4개 통과 |

백엔드 건너뜀은 임시 테스트 컨테이너에 제공하지 않은 RabbitMQ 개별 검사 2개·Docker Compose CLI 검사 2개·Windows 전용 파일 검사 1개다. 별도 실제 수집 흐름과 브라우저 검사는 실행 중인 Compose와 RabbitMQ로 확인했다. 초기 실제 Worker 실행에서 발견한 기업 모델 등록 누락을 수정하고 API를 불러오지 않는 독립 Worker 회귀 검사를 추가했다.

검증 원문 정보·해시 요약은 Git 제외 경로 `.cache/dart-collection/live-result.json`, 브라우저 캡처는 `frontend/test-results/`에 보관한다. 서비스에는 마이그레이션 upgrade와 API/Worker 갱신만 적용했으며 DB·MQ·원본 볼륨은 유지했다.
