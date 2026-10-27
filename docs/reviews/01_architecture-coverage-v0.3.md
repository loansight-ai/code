# 아키텍처 v0.3 기능·화면 커버리지 검토

> 검토·반영일: 2026-10-27 · 문서 검토 기록

## 대상과 결론

- [기능 명세서 v0.0.4](https://github.com/loansight-ai/docs/blob/main/01-planning/functions.md): N-F01~41, blob `5dad72a65c14672a3ff61ed31cb4931cb9e07d87`.
- [화면설계서 PDF](<../02_LoanSight AI_화면설계서_v0.0.2_261026.pdf>): 물리 페이지 1~11. SHA256 `8ad2880327e7697212a16241009c2e90a27e966e093db8496098fabd7225e640`.
- [전체 아키텍처](../01_LoanSight_AI_Architecture_v0.3.md): 최초 검토는 커밋 `d1df9f3` 기준. 이후 범위 정정과 주제별 분리를 반영했다.

React·FastAPI·Worker·PostgreSQL·RabbitMQ·SSE 구조로 필요한 기능을 수용할 수 있다. 발견한 부족 사항은 아래 주제별 설계로 반영했다. **문서 반영은 구현·실행·모델 품질 검증 완료를 의미하지 않는다.**

사용자 지시에 따라 모델 학습은 이 저장소 범위 밖이다. 외부 문서의 모델 개발 기능은 외부 의존성으로 구분하고 제공물 연동·추론·검증 보고서 조회만 담당한다. PDF는 파일명 v0.0.2, 표지 v0.0.1·작성 2026.10.24로 표기되어 있어 위 해시로 원본을 식별한다.

## 발견 사항과 반영 위치

| ID | 확인한 문제 | 현재 반영 위치 |
|---|---|---|
| G01 | 필수 직접 입력의 후순위 표현·저장 계약 부족 | [입력·업종 변경](../design/01_data-and-analysis.md#input): 필수 입력·소유 범위·revision·출처/자동값 충돌 |
| G02 | 모델 개발 범위와 이 저장소 역할 혼동 | [외부 모델 연동](../design/03_ai-integration.md#prediction): 모델 개발 제외·인수/추론 계약 |
| G03 | 12개월 복합 위험 사건 목표·기준일 표현 불일치 | [예측 응답](../design/03_ai-integration.md#prediction): 외부 대상 정의/버전·재무/공시 시각 구분 |
| G04 | 필수 업종 비교·한국은행 통계·3/5개년 계약 부족 | [업종 비교](../design/01_data-and-analysis.md#benchmark): 원천/기간/표본·분류 fallback·비교 보류 |
| G05 | 예측 화면의 두 모델/영향/보류/보고서 계약 부족 | [외부 모델 연동](../design/03_ai-integration.md#prediction): 제공 결과·설명 단위·입력 부족·외부 지표 조회 |
| G06 | 경고 항목의 원문 열람 후 체크 조건 누락 | [검토 상태](../design/04_ui-and-review.md#review): 사용자/분석/근거 revision별 선행 열람 |
| G07 | 초안 재생성 시 사용자 수정 보존·충돌 처리 누락 | [초안 revision](../design/04_ui-and-review.md#review): 문단 유지/전체 재생성·담당자 의견·409 충돌 |
| G08 | 원문 드로어·하이라이트·교차참조·검수 계약 부족 | [근거 추출](../design/01_data-and-analysis.md#evidence), [요약](../design/03_ai-integration.md#summary) |
| G09 | 정의된 6개 축/6항목의 미정 처리·17항목 연결 부족 | [업무 범위](../design/01_data-and-analysis.md#scope), [재무·위험규칙](../design/01_data-and-analysis.md#financial) |
| G10 | 정답지·계정 확보·사용자 교차 실험 기록 부족 | [검증 기록](../design/06_delivery-and-validation.md#validation): 표본 목적·품질·시간/누락/수정량 |
| G11 | 옵션 변경·공통 컨텍스트·차트 데이터 계약 부족 | [입력 옵션](../design/01_data-and-analysis.md#input), [분석 키](../design/02_api-and-jobs.md#fingerprint), [UI](../design/04_ui-and-review.md#ui) |

## 미정과 검수의 관리

기능 41개의 담당 모듈·API/산출물·화면·검수 기준은 [기능 연결표](../design/06_delivery-and-validation.md#traceability) 한 곳에서 관리한다. 모델 개발 항목은 이 저장소의 누락/완료 의무로 처리하지 않는다. N-F12는 보완, N-F28~29는 확장으로 유지한다.

초기 사용자 식별은 사용자 지시에 따라 [5자리 숫자 코드+서버 세션](../design/05_project-and-deployment.md#identity)으로 정했다. 임계값·세부분류/복합 비중·산식 근사·17항목 원자료·최소 비교 표본·세부 권한/보존·검수 승인 등 남은 미정은 [결정 목록](../design/06_delivery-and-validation.md#pending)을 따른다. 숫자나 승인 상태를 임의로 확정하지 않는다.

코드·데이터 수집·외부 모델 품질·화면 실행 검증은 별도 수행 대상이다. 원본 기능 명세와 PDF는 수정하지 않았다.
