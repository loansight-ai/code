import { useContext, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { SessionContext } from '../session/session-context'
import { ApiError, errorMessage, request } from '../session/api'
import { Button } from '../../shared/components/button'
import {
  extractionSchema,
  factListSchema,
  factPath,
  fields,
  historySchema,
  kinds,
  openingSchema,
  postFact,
  type Fact,
  type FactSource,
} from './fact-api'
import { FactForm } from './fact-form'
import type { EvidenceBundle } from './bundle-api'
import { StatusBadge } from '../../shared/components/status-badge'
import { ClipboardCheck, ArrowRight } from 'lucide-react'

const states = {
  PENDING: '검수 대기',
  APPROVED: '승인',
  REJECTED: '반려',
  SUPERSEDED: '수정본으로 대체',
}
const decisions: Record<string, string> = {
  APPROVE: '승인',
  REJECT: '반려',
  REOPEN: '재검수',
  SUPERSEDE: '수정본 작성',
}
function reviewError(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      fact_evidence_must_be_opened:
        '현재 사실의 원문을 다시 열고 검토해 주세요.',
      fact_validation_blocked: '근거 확인 항목을 수정한 뒤 다시 검수해 주세요.',
      fact_source_changed:
        '저장 후 원문이 바뀌었습니다. 수정본을 만들어 다시 확인해 주세요.',
      approved_fact_conflict:
        '다른 값으로 승인된 사실이 있습니다. 기존 승인을 재검수한 뒤 결정해 주세요.',
      fact_version_conflict:
        '검수 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.',
    }
    if (messages[error.detail]) return messages[error.detail]
  }
  return errorMessage(error)
}
export function FactPanel({ bundle }: { bundle: EvidenceBundle }) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const client = useQueryClient()
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const key = ['server', owner, bundle.bundle_id, 'facts']
  const extraction = useQuery({
    queryKey: [...key, 'extraction'],
    enabled: !!owner,
    queryFn: async () =>
      extractionSchema.parse(
        await request(`${factPath(bundle.bundle_id)}/fact-extraction`),
      ),
    retry: false,
    refetchInterval: (q) =>
      ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(
        q.state.data?.run?.status ?? '',
      )
        ? 1000
        : false,
  })
  const running = ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(
    extraction.data?.run?.status ?? '',
  )
  const list = useQuery({
    queryKey: [...key, offset, extraction.data?.run?.status],
    enabled: !!owner,
    queryFn: async () =>
      factListSchema.parse(
        await request(`${factPath(bundle.bundle_id)}/facts?offset=${offset}`),
      ),
    retry: false,
  })
  const start = useMutation({
    mutationFn: () => postFact(bundle.bundle_id, '/fact-extraction'),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const audit = useMutation({
    mutationFn: () => postFact(bundle.bundle_id, '/fact-audit-candidates'),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  return (
    <section className="panel bundle-facts-panel" aria-label="구조화 사실 검수">
      <div className="panel-heading">
        <h2>
          <ClipboardCheck size={18} aria-hidden="true" />
          구조화 사실 검수
        </h2>
        <StatusBadge>
          {list.data ? `목록 ${list.data.facts.length}개` : '검수 대기'}
        </StatusBadge>
      </div>
      <div className="bundle-panel-body">
        <p className="bundle-intro">
          덤프와 구조화 HTML에서 추출한 사실을 함께 검토합니다. 승인은 사실별로
          기록되며, 예측 모델 투입은 보류됩니다.
        </p>
        <div className="bundle-action-row">
          <Button
            variant="outline"
            disabled={audit.isPending}
            onClick={() => audit.mutate()}
          >
            감사기록 후보 가져오기
          </Button>{' '}
          <Button
            disabled={!extraction.data?.available || running || start.isPending}
            onClick={() => start.mutate()}
          >
            Codex로 사실 후보 추출
          </Button>
        </div>
        {!extraction.data?.available && (
          <p className="bundle-help">
            Codex 추출은 서버 인증·실행 제한 설정 후 사용할 수 있습니다.
          </p>
        )}
        <p className="bundle-help">
          검색한 원문의 ‘사실 후보 작성’에서 직접 추가할 수도 있습니다.
        </p>
        {(audit.isError || start.isError) && (
          <p role="alert">{reviewError(audit.error ?? start.error)}</p>
        )}
        {audit.isSuccess && (
          <p>
            감사기록 후보를 확인했습니다. 같은 후보를 중복 저장하지 않습니다.
          </p>
        )}
        {extraction.data?.run && (
          <div>
            <p>
              사실 추출 작업: {extraction.data.run.status}
              {running ? ' · 실행 중' : ''}
            </p>
            {extraction.data.run.result && (
              <>
                <p>
                  저장 후보 {extraction.data.run.result.candidate_count ?? 0}개
                  · 추출 범위{' '}
                  {extraction.data.run.result.execution_status === 'COMPLETED'
                    ? '탐색 완료'
                    : '일부만 확인'}
                </p>
                <p>{extraction.data.run.result.limitations}</p>
                {extraction.data.run.result.stop_reason && (
                  <p>중단 사유: {extraction.data.run.result.stop_reason}</p>
                )}
              </>
            )}
            {extraction.data.run.error_code && (
              <p>작업 오류: {extraction.data.run.error_code}</p>
            )}
          </div>
        )}
        {extraction.isError && (
          <p role="alert">추출 작업 상태를 불러오지 못했습니다.</p>
        )}
        {list.isError && <p role="alert">사실 후보를 불러오지 못했습니다.</p>}
        {list.data?.facts.length === 0 && (
          <p>저장된 사실 후보가 없습니다. 위험이 없다는 뜻은 아닙니다.</p>
        )}
        <ul className="bundle-fact-list">
          {list.data?.facts.map((f) => (
            <li key={f.id}>
              <Button
                className="bundle-fact-open"
                variant="ghost"
                onClick={() => setSelected(f.id)}
              >
                <span>
                  {kinds[f.data.kind][1]} · {f.data.statement} ·{' '}
                  {states[f.state]}
                </span>
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
              <p>
                {f.validation.status === 'BLOCKED'
                  ? '근거 보완 필요'
                  : '인용 일치 확인'}{' '}
                · 수정 {f.revision}차 ·{' '}
                {f.origin.kind === 'CODEX_EXTRACTION'
                  ? 'Codex 추출'
                  : f.origin.kind === 'DUMP_AUDIT_CANDIDATE'
                    ? '덤프 감사기록'
                    : '사용자 작성'}
              </p>
              {f.related?.some((r) => r.relation === 'POSSIBLE_CONFLICT') && (
                <p>다른 값의 관련 후보가 있습니다. 충돌 여부를 검토하세요.</p>
              )}
              {f.related?.some((r) => r.relation === 'SAME_FIELDS') && (
                <p>동일 필드의 관련 후보가 있습니다. 원문을 비교하세요.</p>
              )}
            </li>
          ))}
        </ul>
        {offset > 0 && (
          <Button onClick={() => setOffset(Math.max(0, offset - 30))}>
            이전 사실
          </Button>
        )}
        {list.data?.next_offset != null && (
          <Button onClick={() => setOffset(list.data!.next_offset!)}>
            다음 사실
          </Button>
        )}
        {selected && (
          <FactReview
            key={selected}
            bundle={bundle}
            factId={selected}
            onSelect={setSelected}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </section>
  )
}

export function FactReview({
  bundle,
  factId,
  onSelect,
  onClose,
}: {
  bundle: EvidenceBundle
  factId: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const client = useQueryClient()
  const key = ['server', bundle.bundle_id, 'fact-review', factId]
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const history = useQuery({
    queryKey: key,
    queryFn: async () =>
      historySchema.parse(
        await request(`${factPath(bundle.bundle_id)}/facts/${factId}`),
      ),
    retry: false,
  })
  const opened = useMutation({
    mutationFn: async () =>
      openingSchema.parse(
        await postFact(bundle.bundle_id, `/facts/${factId}/open`),
      ),
  })
  const review = useMutation({
    mutationFn: (decision: 'APPROVE' | 'REJECT' | 'REOPEN') =>
      postFact(bundle.bundle_id, `/facts/${factId}/reviews`, {
        request_id: requestId,
        expected_version: history.data!.fact.version,
        reason,
        decision,
        opening_id: decision === 'APPROVE' ? opened.data?.opening_id : null,
      }),
    onSuccess: async () => {
      setReason('')
      setRequestId(crypto.randomUUID())
      opened.reset()
      await client.invalidateQueries({ queryKey: ['server'] })
    },
  })
  const fact = history.data?.fact
  const canApprove =
    !!fact &&
    opened.data?.fact.version === fact.version &&
    opened.data.current_validation.status === 'CITATIONS_VALID'
  return (
    <section className="bundle-fact-review" aria-label="선택 사실 검수">
      <div className="bundle-search-heading">
        <h3>사실 검수</h3>
        <Button variant="ghost" onClick={onClose}>
          검수 닫기
        </Button>
      </div>
      {history.isError && <p role="alert">사실을 불러오지 못했습니다.</p>}
      {fact && (
        <>
          <FactSummary fact={fact} />
          <p>
            {states[fact.state]} · 수정 {fact.revision}차
          </p>
          {fact.validation.issues.map((v, i) => (
            <p key={i}>{v.message}</p>
          ))}
          <Button
            disabled={opened.isPending || review.isPending}
            onClick={() => {
              opened.reset()
              opened.mutate()
            }}
          >
            인용 원문을 열고 검토
          </Button>
          {opened.isError && <p role="alert">{reviewError(opened.error)}</p>}
          {opened.data?.contexts.map((s) => (
            <SourceReview key={s.segment_id} source={s} />
          ))}
          {opened.data && (
            <p>
              원문 열람이 기록되었습니다. 내용과 대상·방향·기간을 대조한 뒤
              결정하세요.
            </p>
          )}
          <label className="bundle-review-reason">
            검수 사유{' '}
            <textarea
              maxLength={2000}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                setRequestId(crypto.randomUUID())
              }}
            />
          </label>
          <Button
            disabled={
              !canApprove ||
              !reason.trim() ||
              review.isPending ||
              fact.state === 'APPROVED' ||
              fact.state === 'SUPERSEDED'
            }
            onClick={() => review.mutate('APPROVE')}
          >
            승인
          </Button>{' '}
          <Button
            variant="outline"
            disabled={
              !reason.trim() ||
              review.isPending ||
              fact.state === 'REJECTED' ||
              fact.state === 'SUPERSEDED'
            }
            onClick={() => review.mutate('REJECT')}
          >
            반려
          </Button>{' '}
          <Button
            variant="outline"
            disabled={
              !reason.trim() ||
              review.isPending ||
              !['APPROVED', 'REJECTED'].includes(fact.state)
            }
            onClick={() => review.mutate('REOPEN')}
          >
            재검수로 돌리기
          </Button>{' '}
          <Button
            variant="outline"
            disabled={fact.state === 'SUPERSEDED' || review.isPending}
            onClick={() => setEditing((v) => !v)}
          >
            수정본 작성
          </Button>
          {review.isError && (
            <p role="alert">
              {reviewError(review.error)}{' '}
              <Button
                onClick={() => {
                  opened.reset()
                  setRequestId(crypto.randomUUID())
                  void history.refetch()
                }}
              >
                검수 상태 새로고침
              </Button>
            </p>
          )}
          {review.isSuccess && <p role="status">검수 결정을 저장했습니다.</p>}
          {editing && (
            <FactForm
              key={fact.version}
              bundle={bundle}
              sourceId={fact.data.citations[0].segment_id}
              initial={fact}
              onClose={() => {
                setEditing(false)
                opened.reset()
              }}
            />
          )}
          <h4>검수 이력</h4>
          <nav aria-label="사실 수정 이력">
            {history.data?.revisions.map((v) => (
              <Button
                key={v.id}
                variant="ghost"
                disabled={v.id === fact.id}
                onClick={() => onSelect(v.id)}
              >
                수정 {v.revision}차 ·{' '}
                {states[v.state as Fact['state']] ?? v.state}
              </Button>
            ))}
          </nav>
          {history.data?.reviews.length === 0 && (
            <p>아직 검수 결정이 없습니다.</p>
          )}
          <ul>
            {history.data?.reviews.map((r) => (
              <li key={r.id}>
                {decisions[r.decision] ?? r.decision} ·{' '}
                {new Date(r.created_at).toLocaleString('ko-KR')} · {r.reason}
              </li>
            ))}
          </ul>
          {fact.supersedes_id && (
            <p>
              이전 사실 <code>{fact.supersedes_id}</code>의 수정본입니다.
            </p>
          )}
        </>
      )}
    </section>
  )
}
function FactSummary({ fact }: { fact: Fact }) {
  const labels: Record<string, string> = {
    UNKNOWN: '미확인',
    PROVIDED: '제공',
    RECEIVED: '수취',
    PLAINTIFF: '원고',
    DEFENDANT: '피고',
    ISSUER: '발행',
    BALANCE: '잔액',
    LIMIT: '한도',
    CLAIM: '청구액',
    GUARANTEE: '보증액',
    PRINCIPAL: '원금',
    LOAN_BALANCE: '대출잔액',
    COMMITMENT: '보증·약정',
    RELATED_PARTY: '특수관계자 제공분',
    PROVISION: '소송충당부채',
    DETAIL: '상세행',
    SUBTOTAL: '소계행',
    TOTAL: '총계행',
    PF_GUARANTEE: 'PF 대출보증',
    COMPLETION_SUPPORT: '책임준공 미이행 시 채무인수',
    FUNDING_SUPPORT: '자금보충',
    BUYER_GUARANTEE: '수분양자 중도금 보증',
    OTHER: '기타 보증·조건부 의무',
  }
  return (
    <>
      <p>
        {kinds[fact.data.kind][1]} · {fact.data.statement}
      </p>
      <dl>
        {(
          [
            'subject',
            'direction',
            'period',
            'counterparty',
            'amount_role',
            'maturity',
            'status',
            ...(
              [
                'obligation_type',
                'aggregation_level',
                'project_count',
                'case_number',
                'case_count',
                'filing_date',
                'case_note',
              ] as const
            ).filter((k) => fact.data[k] != null && fact.data[k] !== 'UNKNOWN'),
          ] as const
        ).map((k) => (
          <div key={k}>
            <dt>{fields[k]}</dt>
            <dd>
              {fact.data[k] != null && fact.data[k] !== ''
                ? (labels[String(fact.data[k])] ?? String(fact.data[k]))
                : '미확인'}
            </dd>
          </div>
        ))}
      </dl>
      {fact.data.amount && (
        <p>
          원문 금액 {fact.data.amount.raw_value} {fact.data.amount.unit} ·{' '}
          {fact.data.amount.currency} · 환산값{' '}
          {fact.validation.normalized_amount ?? '미확인'}
        </p>
      )}
      <p>
        {fact.data.detection === 'EXPLICITLY_NONE'
          ? '공시상 명시적 없음 후보'
          : '기재 발견 후보'}{' '}
        · 예측 모델 투입 보류
      </p>
    </>
  )
}
function SourceReview({ source }: { source: FactSource }) {
  return (
    <section aria-label="검수 인용 원문">
      <h4>{source.title}</h4>
      <p>
        {source.origin === 'dump' ? '덤프 자료' : '구조화 HTML'} ·{' '}
        {source.scope}
      </p>
      {source.source_url && (
        <Link to={source.source_url}>기존 원문 강조 열기</Link>
      )}
      <p style={{ whiteSpace: 'pre-wrap' }}>{source.text}</p>
      {source.cells && (
        <div className="table-scroll">
          <table aria-label="검수 원문 표">
            <tbody>
              {source.cells.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {source.citations?.map((c, i) => (
        <blockquote key={i}>
          <strong>{fields[c.field]}</strong> {c.quote}
        </blockquote>
      ))}
      <small>
        원문 버전 {source.revision} · SHA-256 {source.sha256}
      </small>
    </section>
  )
}
