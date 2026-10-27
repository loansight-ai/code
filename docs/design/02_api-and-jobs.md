# LoanSight AI — API·작업 처리 설계

> v0.4 · 2026-10-28 · 설계 초안

이번 변경은 설계 목표의 개정이다. 실행 코드·DB 마이그레이션·실제 화면 구현 완료를 뜻하지 않는다.

[전체 아키텍처](../01_LoanSight_AI_Architecture_v0.4.md) / REST·분석 재사용·RabbitMQ·SSE·GNB 진행 알림

<a id="api"></a>

## API 경로와 접근 전제

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/v1/users` | 새 사용자·기본 Workspace·5자리 코드 자동 발급 및 세션 시작 |
| POST | `/api/v1/session` | 요청 본문의 5자리 코드로 기존 사용자 세션 시작·전환 |
| GET | `/api/v1/session` | 현재 세션의 사용자 코드·기본 Workspace 조회, 미식별/만료는 401 |
| DELETE | `/api/v1/session` | 현재 세션 폐기·쿠키 삭제 |
| GET | `/api/v1/companies` | 기업 검색 |
| GET | `/api/v1/companies/{corpCode}/disclosures` | 공시 목록 |
| POST/GET | `/api/v1/me/manual-inputs` | 직접 입력 revision 생성·내 입력 목록, 출처·재무 기준일·자동값 충돌 병기 |
| POST/GET | `/api/v1/me/industry-overrides` | 업종 변경 revision 생성·이력, 변경 사유·근거·권한 검증 |
| POST | `/api/v1/analyses` | 분석 요청 또는 기존 실행 재사용 |
| POST | `/api/v1/me/tasks/diagnostics` | 현재 구현의 전달 경로 점검 작업. 실제 재무 분석은 수행하지 않음 |
| GET | `/api/v1/me/tasks/{taskId}` | 세션 소유 범위의 작업 상세·결과 조회 |
| GET | `/api/v1/analyses/{id}` | 실행 메타데이터 및 상태 |
| GET | `/api/v1/analyses/{id}/financials` | 재무지표·산식 |
| GET | `/api/v1/analyses/{id}/benchmarks` | 업종 비교 |
| GET | `/api/v1/analyses/{id}/evidences` | 주석 근거 |
| GET | `/api/v1/analyses/{id}/source-segments/{segmentId}` | 근거가 연결된 원문 구간·하이라이트·교차참조 |
| GET | `/api/v1/analyses/{id}/signals` | 규칙 기반 징후 |
| GET | `/api/v1/analyses/{id}/prediction` | 제공 모델 결과·입력/제공 보류·영향·원문·추가 질문 |
| GET | `/api/v1/analyses/{id}/review-context` | 해당 분석의 규칙 제안·23개 RISK 후보·원문 열람/담당자 확인 상태 |
| POST | `/api/v1/reviews` | 사용자·분석별 검토 생성 또는 기존 검토 반환 |
| GET | `/api/v1/me/tasks` | 내 진행 중·미확인 완료/실패 작업 스냅샷과 event_cursor |
| GET | `/api/v1/me/task-events` | 내 작업 변경 SSE, 최초 `after` cursor 및 재연결 `Last-Event-ID` 지원 |
| PUT | `/api/v1/me/tasks/{taskId}/acknowledgement` | 해당 완료·실패 버전의 알림 확인 처리(멱등) |
| POST | `/api/v1/reviews/{reviewId}/evidence-views` | 사용자의 해당 경고 근거 revision 열람 기록 |
| PUT | `/api/v1/reviews/{reviewId}/items/{itemId}` | 체크/해제, 경고 선행 열람 검증·revision 충돌 처리 |
| GET/PUT | `/api/v1/reviews/{reviewId}/draft` | 초안 조회·기반 revision 검증 후 편집 저장 |
| POST | `/api/v1/reviews/{reviewId}/draft-regenerations` | 수정 문단 유지/전체 재생성 선택, 비동기 생성·저장 충돌 검증 |

**원칙:** 프론트엔드가 화면마다 전체 분석을 재요청하지 않고, 저장된 `analysis_run_id`에 대응하는 필요한 데이터만 조회한다.

`/me`는 5자리 코드 진입 후 발급된 서버 세션의 사용자·기본 Workspace를 의미한다. 코드·사용자 ID를 매 요청의 인증값으로 보내지 않고 동일 출처 쿠키를 REST·SSE에 적용한다. 미등록/비활성 코드의 진입 실패 응답은 동일하게 처리하고 시도 제한 시 429를 반환한다. 요청 파라미터의 사용자 ID만으로 접근을 허용하지 않는다. 사용자 범위의 SSE 하나로 GNB와 상세 화면을 함께 갱신한다. 발급·전환·만료와 접근 경계는 [사용자 식별](05_project-and-deployment.md#identity)을 따른다.

분석 생성 요청은 공시 또는 직접 입력의 기준 revision, 적용 업종 override·계산 옵션을 명시한다. 개인 입력·검토·원문 열람·초안·내부 검증 API는 모두 서버 측 소유/역할 범위를 검증한다. 원문 구간 ID나 review ID를 안다는 이유만으로 접근을 허용하지 않는다. 업무별 요청·응답 규칙은 [데이터·분석](01_data-and-analysis.md#input), [AI 연동](03_ai-integration.md#prediction), [화면·검토](04_ui-and-review.md#review) 설계를 따른다.

<a id="fingerprint"></a>

## 분석 실행 키

단순히 `corp_code`만으로 분석 결과를 식별하지 않는다.

```text
analysis_fingerprint = HASH(
  visibility_scope / company / input_source_revision / accounting_scope
  + effective_industry / industry_override_revision / analysis_options_hash
  + parser_version / formula_version / industry_rule_version
  + risk_rule_version / input_override_revision
)
```

`input_source_revision`은 공시 원본 revision 또는 직접 입력 revision을 식별한다. `analysis_options_hash`에는 리스부채 포함 등 결과에 영향을 주는 옵션을 정규화해 포함한다. 입력 원문·계정/업종 매핑·주석 사전 버전과 비교군 원천의 버전 의존성도 산출물 키로 기록한다. 개인 입력·override가 있는 결과는 소유 범위를 포함한 비공개 결과로 관리한다.

예측과 LLM 출력은 각각 외부 모델/특징/대상 정의·추론용 전처리·설명·보고서 버전, 프롬프트/공급자 등의 추가 키를 사용한다. 동종 비교는 동일 `analysis_run_id`에 연결한 비교 스냅샷으로 고정하고 비교군·분류·통계 revision을 포함한다. 비교군이 바뀌면 새로운 비교 스냅샷과 분석 버전을 사용하여 같은 실행의 화면 값이 서로 달라지지 않게 한다.

**`analysis_run_id`가 같으면 모든 화면은 같은 기준의 데이터를 조회**한다. 새 정정공시, 업종 수동 변경, 규칙 변경 등으로 입력이 바뀌면 새 분석 버전을 생성한다.

<a id="cache"></a>

## 계층별 중복 방지

| 계층 | 구현 | 목적 |
|---|---|---|
| 브라우저 | TanStack Query + 공유 Query Key | 동일 결과 반복 요청 억제, 진행 중 요청 공유 |
| HTTP | ETag / 조건부 응답(선택) | 변경 없는 응답 본문 전송 최소화 |
| API/DB | `analysis_fingerprint` 조회 | 기존 완료 분석 결과 재사용 |
| 작업 전달·실행 | DB 유니크 키·Outbox + message_id·실행 소유권 검증 | MQ 중복 전달에도 동일 분석의 중복 결과 확정 방지 |
| 실시간 알림 | 사용자별 event cursor + 작업 상태 버전 | 이벤트 재전송 중복 제거, 오래된 상태의 역전 방지 |
| 외부 DART | 접수번호별 원본 저장 | 공시 재다운로드 방지 |
| LLM | 입력 근거 해시 + 프롬프트·모델·설정 버전 | 동일 요약 재호출 최소화 |

**캐시 무효화:** 공시 정정, 파서·산식·규칙 변경, 수동 입력 수정 등은 새 버전/키를 생성한다. 분석 결과를 단순 TTL만으로 관리하지 않는다.

<a id="mq"></a>

## RabbitMQ 작업 전달

```text
POST /analyses
  ├─ 동일한 완료 스냅샷 존재 → 사용자 작업 연결 후 기존 analysis_run_id 반환
  ├─ 동일한 진행 중 작업 존재 → 사용자 작업 연결 후 기존 job_id 반환
  └─ 신규 작업 필요 → 작업·사용자 연결·Outbox 저장(202 Accepted)
                         ↓
                   Relay → RabbitMQ → Worker
                                         ↓
                       상태·결과·사용자별 이벤트 DB 저장 → ACK
                                         ↓
                              NOTIFY → FastAPI → SSE
```

- Worker는 aio-pika를 사용하는 RabbitMQ consumer로 구독한다. PostgreSQL 작업 테이블을 주기적으로 조회해 신규 분석을 가져가는 방식은 사용하지 않는다. 구체적인 큐 종류는 구현 시 확정한다. 라이브러리 구성은 [백엔드 설계](05_project-and-deployment.md#backend-stack)를 따른다.
- API는 `analysis_job`, 사용자 작업 연결, `outbox_message`를 같은 DB 트랜잭션에 저장한다. DB 커밋 후 MQ에 직접 발행하는 이중 쓰기를 피한다. `202`는 요청의 영속 접수를 뜻하며 MQ 전달 완료를 뜻하지 않는다.
- Relay는 Outbox를 읽어 durable 큐에 persistent 메시지를 발행하고, publisher confirm과 라우팅 실패를 확인한 뒤 발행 완료를 기록한다. 메시지에는 `message_id`, `job_id`, 실행 세대와 계약 버전을 포함하고 원문·결과는 ID로 참조한다.
- DB 커밋과 MQ 전달 사이의 장애는 미발행 Outbox 재전송으로 복구한다. Relay의 대기·재시도 확인에는 제한적인 내부 조회를 허용한다. 여러 Relay의 Outbox 선점에는 `FOR UPDATE SKIP LOCKED` 등을 사용할 수 있으며 분석 작업 큐와 구분한다.
- 전달 보장은 **at-least-once**를 전제로 한다. Worker는 DB에서 실행 임대와 attempt 소유권을 원자적으로 확보하고, 완료 작업·중복 메시지를 멱등 처리한다. 임대 상실 Worker의 늦은 결과 저장은 소유권 토큰 검사로 차단한다.
- 정상 실행은 결과·최종 상태·이벤트를 커밋한 후 수동 ACK한다. ACK 전에 종료되면 재전달되며, 유효한 기존 실행이 있으면 작업을 중복 시작하지 않고 지연 재확인한다.
- 재시도 가능한 오류는 횟수 제한·backoff를 적용한다. 현재 시도의 종료 상태와 다음 시도의 예약 Outbox를 함께 커밋한 뒤 ACK하여, 무한 즉시 requeue를 피한다. 복구 불가 오류는 실패 상태를 확정하고 DLQ 등으로 격리한다.
- heartbeat·실행 임대 만료를 감시해 고아 작업을 복구한다. 장시간 분석에 맞는 ACK timeout·prefetch·동시 실행 수를 설정하고, AMQP heartbeat가 소비 ACK 제한 시간을 연장한다고 가정하지 않는다.
- 일부 주석 추출 실패 시 확보한 재무 결과를 유지하고 `PARTIAL_SUCCEEDED` 및 단계별 실패 내역을 표시한다. 브라우저 종료·SSE 해제는 분석 취소를 의미하지 않는다.

<a id="sse"></a>

## SSE와 내부 변경 알림

**작업 실행은 MQ, 현재 상태와 이력은 DB, 브라우저 알림은 SSE가 담당한다.** 브라우저의 주기적 상태 폴링을 기본 흐름으로 사용하지 않으며 요청·결과 조회·알림 확인은 REST로 처리한다. 현재 요구에는 서버→브라우저 단방향 알림이면 충분하므로 WebSocket은 도입하지 않는다.

- SSE 응답은 FastAPI 내장 EventSourceResponse·ServerSentEvent로 구성하고 내부 변경 알림은 Psycopg 3의 전용 LISTEN 연결로 수신한다. 현재 상태 복원과 이벤트 재생은 아래 DB 기반 계약으로 구현한다.
- Worker의 상태 변경과 연결된 사용자들의 `task_event` 저장을 같은 트랜잭션에서 처리한다. 이미 실행 중인 분석에 새 사용자가 연결되는 경우에도 현재 상태를 작업 목록에 포함하고 이후 변경이 누락되지 않도록 연결 등록과 상태 변경을 동기화한다.
- 이벤트는 `task.created`, `task.updated`, `task.completed`, `task.failed`, `task.acknowledged` 등으로 구분한다. 부분 완료는 `task.completed`와 `PARTIAL_SUCCEEDED`로 표현한다.
- SSE의 `id`는 수신 사용자·Workspace 스트림의 cursor이며 payload에 `task_id`, `task_type`, `job_id`, `analysis_run_id`, 해당 시 `review_id`, `status`, `stage`, `state_version`, 발생 시각을 포함한다. 진행률은 산출 근거가 있는 경우에만 선택적으로 포함한다.
- 상태 저장 트랜잭션에서 `NOTIFY`를 호출하고 API는 커밋된 이벤트를 읽어 전달한다. 알림 payload에는 식별자만 넣고 개인 메모·인증정보를 포함하지 않는다. `LISTEN/NOTIFY` 자체는 영속 큐나 이벤트 이력이 아니다.
- 각 API 프로세스는 전용 LISTEN 연결을 유지하고, 해당 프로세스의 SSE 연결에 권한 범위별로 배포한다. MQ 작업 큐를 API 인스턴스끼리 경쟁 소비해 진행 알림을 배포하지 않는다.
- LISTEN 등록·커밋 후 DB 이벤트를 확인하며, LISTEN 재연결 시에도 마지막 전달 cursor 이후를 재조회한다. API가 바뀌어도 영속 상태로 복구하므로 sticky session을 필수로 두지 않는다.
- SSE는 `text/event-stream`, 캐시 금지, 주기적 heartbeat 주석을 사용한다. Nginx/Ingress의 해당 경로 버퍼링을 끄고 idle timeout을 heartbeat 간격보다 길게 설정한다.
- 느린 클라이언트에는 제한된 버퍼를 적용하고 초과 시 재연결·재동기화하도록 한다. 상태 버전으로 오래된 이벤트를 무시하며 완료 알림 등 필수 이벤트는 재생 가능하게 보관한다.

<a id="recovery"></a>

## 새로고침·브라우저 재실행 복구

1. 앱 진입 시 `GET /me/tasks`로 사용자 작업 목록과 일관된 `event_cursor`를 받는다. 분석 상세 URL `/analyses/{analysis_run_id}`에서는 기존 결과·상태도 조회하며 분석 요청을 다시 만들지 않는다.
2. `GET /me/task-events?after={event_cursor}`를 연결한다. 서버는 cursor 이후 영속 이벤트를 재생한 뒤 실시간 전달로 전환한다. 스냅샷 조회→연결 및 이벤트 재생→실시간 전환 사이의 변경이 빠지지 않아야 한다.
3. 같은 EventSource의 네트워크 재연결에는 `Last-Event-ID`를 사용한다. 헤더가 있으면 최초 `after`보다 우선한다. 새로고침·브라우저 재실행으로 새 EventSource가 생성되면 서버 스냅샷에서 다시 시작한다. 이전 이벤트 ID가 브라우저에 자동 보존된다고 가정하지 않는다.
4. cursor가 보관 기간을 벗어나거나 유효하지 않으면 `reset` 이벤트로 재동기화를 지시한다. 클라이언트는 연결을 닫고 작업 목록을 재조회한 뒤 새 cursor로 구독한다. 이벤트가 만료돼도 현재 작업 상태와 결과는 별도 보관 정책으로 복원한다.
5. 닫혀 있는 동안 완료된 작업은 재방문 시 미확인 완료 목록에 표시한다. 완료 알림 확인은 서버에 저장하고 동일 사용자의 다른 연결에도 반영한다. 브라우저가 닫힌 동안 OS 푸시 알림을 보내는 기능은 포함하지 않는다.

**cursor의 순서 보장:** 사용자·Workspace 스트림별 순번 발급을 트랜잭션 잠금으로 직렬화하는 등, 후행 cursor를 보낸 뒤 더 작은 cursor의 이벤트가 늦게 커밋되는 문제가 없도록 한다. 여러 수신자를 갱신할 때는 일정한 잠금 순서를 사용한다. 단순 전역 sequence의 최댓값을 스냅샷 cursor로 사용하는 것만으로 일관성을 보장하지 않는다.

<a id="gnb"></a>

## GNB 작업 상태

- 앱 공통 Provider에 **탭당 활성 사용자·Workspace 범위 SSE 연결 하나**를 두어 페이지 이동 중에도 유지한다. GNB와 상세 화면은 동일 상태를 사용하며 TanStack Query 캐시를 갱신하거나 필요한 결과 Query를 무효화한다.
- GNB는 진행 중 작업 수와 미확인 완료·실패 알림 수를 구분하고, 작업 종류·기업/보고서명, 현재 단계, 최종 상태, 갱신 시각, 상세 이동을 제공한다. 초안 재생성 작업은 해당 검토 화면으로 연결하고 분석 재실행으로 취급하지 않는다. 재시도 대기와 부분 완료도 구분한다.
- 진행 단계는 대기→수집→정규화·검증→재무 분석→주석·규칙→완료 등을 사용한다. 실제 작업량에 근거하지 않는 진행률이나 예상 완료 시간을 임의로 표시하지 않는다.
- 공개 공시의 동일 분석은 여러 사용자가 공유할 수 있지만 **사용자 작업 연결과 알림 확인 상태는 각각 저장**한다. 같은 분석을 두 사용자가 요청해도 실제 실행은 재사용하고 양쪽 GNB에 각각 반영한다.
- 사용자·Workspace가 바뀌거나 로그아웃되면 기존 연결·캐시를 정리한다. 목록, 상세, SSE 재생, 알림 확인에 동일한 접근 범위를 적용하며 cursor나 분석 ID를 권한 증명으로 사용하지 않는다.
- 같은 브라우저의 로컬 저장소는 최근 분석 링크의 편의 기능으로만 사용할 수 있다. 서버에서 내 작업 목록을 복원하거나 여러 기기에서 동기화하려면 사용자·Workspace 식별이 필요하다([식별·접근 범위](05_project-and-deployment.md#identity)).

## 기술 동작 참고

현재 구현 범위·요청 예시·설정은 [백엔드 실행 안내](../../backend/README.md#사용자작업-api), 실제 검증 결과는 [검증 기록](../reviews/02_sessions-and-pipeline-validation.md)을 참조한다. 위 분석·검토 API 목록 전체가 구현 완료된 것은 아니다.

- [RabbitMQ ACK·publisher confirms](https://www.rabbitmq.com/docs/confirms), [Consumer 설정](https://www.rabbitmq.com/docs/consumers)
- [PostgreSQL LISTEN](https://www.postgresql.org/docs/current/sql-listen.html), [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html)
- [HTML Standard: Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html)

## 개정 이력

| 버전 | 개정일 | 변경 |
|---|---|---|
| v0.3 | 2026.10.27 | 이전 설계 기준, Git 이력 보존 |
| v0.4 | 2026.10.28 | 최신 기획 연결·내부 관리 분리·기존 동작 계약 보존 |
