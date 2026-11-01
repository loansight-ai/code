import { useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, ChevronDown } from 'lucide-react'
import { SessionContext } from '../session/session-context'
import { request } from '../session/api'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import {
  baselineBundle,
  bundleContext,
  getBundleCandidate,
  type BundleCandidate,
  type EvidenceBundle,
} from './bundle-api'
import { factListSchema, factPath, kinds, type Fact } from './fact-api'
import { BundleContext } from './bundle-panel'
import './extraction-workspace.css'

const categories = [
  ['audit', '감사의견·계속기업'],
  ['borrowing', '차입 만기·재무약정'],
  ['credit', '신용등급'],
  ['collateral', '담보 제공'],
  ['litigation', '소송·제재'],
  ['off_balance', '부외거래·후속사건'],
] as const
const directions: Record<string, string> = {
  PROVIDED: '제공',
  RECEIVED: '수취',
  PLAINTIFF: '원고',
  DEFENDANT: '피고',
  ISSUER: '발행',
}
const amountLabels: Record<string, string> = {
  LIMIT: '한도',
  BALANCE: '잔액',
  CLAIM: '청구액',
  GUARANTEE: '보증금액',
  PRINCIPAL: '원금',
  UNKNOWN: '금액',
}
const location = (source?: BundleCandidate) =>
  source?.section_path.map((n) => n.title).join(' · ') || '원문 위치 확인 필요'

export function ExtractionWorkspace({ bundle }: { bundle: EvidenceBundle }) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const [active, setActive] = useState('audit')
  const [choice, setChoice] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const baseline = useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      'extraction-baseline',
      bundle.bundle_revision,
    ],
    queryFn: () =>
      bundle.baseline
        ? Promise.resolve(bundle.baseline)
        : baselineBundle(bundle),
    enabled: !!owner,
    retry: false,
  })
  const facts = useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      'facts',
      'overview',
      bundle.bundle_revision,
    ],
    enabled: !!owner,
    retry: false,
    queryFn: async ({ signal }) => {
      const all = new Map<string, Fact>()
      let offset = 0
      while (true) {
        const page = factListSchema.parse(
          await request(
            `${factPath(bundle.bundle_id)}/facts?offset=${offset}&limit=100`,
            { signal },
          ),
        )
        for (const fact of page.facts)
          if (!['REJECTED', 'SUPERSEDED'].includes(fact.state))
            all.set(fact.id, fact)
        if (page.next_offset === null) return [...all.values()]
        if (page.next_offset <= offset) throw new Error('invalid_fact_page')
        offset = page.next_offset
      }
    },
  })
  const rows = categories.map(([key, title]) => {
    const item = baseline.data?.items.find((i) => i.key === key)
    const entries = facts.data?.filter((f) => f.data.category === key) ?? []
    const detected = entries.filter((f) => f.data.detection === 'DETECTED')
    const absent = entries.filter((f) => f.data.detection === 'EXPLICITLY_NONE')
    const status = detected.length
      ? '검출'
      : absent.length
        ? '공시상 없음'
        : item?.total
          ? '검색 후보'
          : baseline.isError || facts.isError
            ? '조회 실패'
            : baseline.isPending || facts.isPending
              ? '확인 중'
              : '미검출'
    const first =
      item?.candidates.find(
        (c) => c.content_available !== false && !c.body_skipped,
      ) ?? item?.candidates[0]
    return {
      key,
      title,
      item,
      entries,
      status,
      first,
      count: entries.length
        ? String(entries.length)
        : item?.total
          ? `${item.total} 후보`
          : '—',
    }
  })
  const row = rows.find((r) => r.key === active)!
  const options = [
    ...row.entries.map((f) => ({
      id: `fact:${f.id}`,
      title: f.data.statement,
      fact: f,
      source: undefined as BundleCandidate | undefined,
    })),
    ...(row.item?.candidates ?? []).map((c) => ({
      id: `source:${c.segment_id}`,
      title: location(c),
      fact: undefined as Fact | undefined,
      source: c,
    })),
  ]
  const selected = options.find((o) => o.id === choice) ?? options[0]
  const fact = selected?.fact
  const segment =
    selected?.source?.segment_id ?? fact?.data.citations[0]?.segment_id
  const source = useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      'extraction-source',
      bundle.bundle_revision,
      segment,
    ],
    enabled: !!owner && !!segment,
    retry: false,
    queryFn: async ({ signal }) => {
      const candidate =
        selected?.source ?? (await getBundleCandidate(bundle, segment!))
      const context = await bundleContext(bundle, candidate, 0, 0, signal)
      return { candidate, context }
    },
  })
  const candidate = source.data?.candidate ?? selected?.source
  const directQuote = fact?.data.citations.find(
    (c) => c.field === 'statement',
  )?.quote
  const excerpt =
    directQuote ??
    source.data?.context.segments.find((s) => s.segment_id === segment)?.excerpt
      .text ??
    candidate?.excerpt.text
  const pending = fact ? fact.state !== 'APPROVED' : true
  const selectedStatus = fact
    ? fact.data.detection === 'EXPLICITLY_NONE'
      ? '공시상 없음'
      : '검출'
    : selected
      ? '검색 후보'
      : row.status
  return (
    <div className="extraction-layout">
      <section className="panel extraction-overview" aria-label="추출 현황">
        <div className="extraction-heading">
          <h2>추출 현황</h2>
          <div className="extraction-tags">
            <span>
              {baseline.data?.dictionary_version
                ? `검색 사전 ${baseline.data.dictionary_version}`
                : '공통 검색 사전'}
            </span>
            <span>공통 6항목</span>
          </div>
        </div>
        <div className="extraction-table-wrap">
          <table className="extraction-status-table">
            <thead>
              <tr>
                <th>추출 항목</th>
                <th>구분</th>
                <th>검출 상태</th>
                <th>건수</th>
                <th>원문 위치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={r.key === active ? 'is-selected' : ''}
                  onClick={() => {
                    setActive(r.key)
                    setChoice(null)
                  }}
                >
                  <th scope="row">
                    <button
                      aria-pressed={r.key === active}
                      onClick={() => {
                        setActive(r.key)
                        setChoice(null)
                      }}
                    >
                      {r.title}
                    </button>
                  </th>
                  <td>공통</td>
                  <td>
                    <span
                      className={`extraction-status ${r.status === '검출' ? 'is-found' : r.status === '공시상 없음' ? 'is-absent' : r.status === '조회 실패' ? 'is-failed' : 'is-pending'}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="extraction-count">{r.count}</td>
                  <td className="extraction-location">
                    <span>
                      {r.key === active && candidate
                        ? location(candidate)
                        : r.entries.length
                          ? location(
                              r.item?.candidates.find(
                                (c) =>
                                  c.segment_id ===
                                  r.entries[0].data.citations[0]?.segment_id,
                              ),
                            )
                          : r.first
                            ? location(r.first)
                            : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="extraction-footnote">
          검출은 구조화된 사실 후보 기준입니다. 검색 후보는 원문 확인 전이며,
          검수 승인과 구분합니다.
        </p>
        {(baseline.isError || facts.isError) && (
          <div className="extraction-error" role="alert">
            자료 일부를 불러오지 못했습니다.{' '}
            <Button
              variant="ghost"
              onClick={() => {
                void baseline.refetch()
                void facts.refetch()
              }}
            >
              다시 조회
            </Button>
          </div>
        )}
      </section>
      <aside className="panel extraction-detail" aria-label="선택 항목 근거">
        <div className="extraction-detail-title">
          <h2>{fact ? fact.data.statement : row.title}</h2>
          <span
            className={`extraction-status ${selectedStatus === '검출' ? 'is-found' : selectedStatus === '공시상 없음' ? 'is-absent' : 'is-pending'}`}
          >
            {selectedStatus}
          </span>
          {fact && directions[fact.data.direction] && (
            <span className="extraction-direction">
              {directions[fact.data.direction]}
            </span>
          )}
        </div>
        {options.length > 1 && (
          <label className="extraction-source-select">
            관련 근거{' '}
            <select
              value={selected?.id ?? ''}
              onChange={(e) => setChoice(e.target.value)}
            >
              {options.map((o, i) => (
                <option key={o.id} value={o.id}>
                  {i + 1}. {o.fact ? '구조화 사실' : '원문 후보'} · {o.title}
                </option>
              ))}
            </select>
            <ChevronDown size={12} aria-hidden="true" />
          </label>
        )}
        {selected ? (
          <>
            <dl className="extraction-detail-fields">
              <div>
                <dt>
                  {fact?.data.amount
                    ? (amountLabels[fact.data.amount_role] ?? '금액')
                    : '금액'}
                </dt>
                <dd className={fact?.data.amount ? 'is-amount' : ''}>
                  {fact?.data.amount
                    ? `${fact.data.amount.raw_value} ${fact.data.amount.unit}${fact.data.amount.currency === 'KRW' ? '' : ` (${fact.data.amount.currency})`}`
                    : '미확보'}
                </dd>
              </div>
              <div>
                <dt>만기</dt>
                <dd>{fact?.data.maturity ?? '미확보'}</dd>
              </div>
              <div>
                <dt>상대방</dt>
                <dd>{fact?.data.counterparty ?? '미확보'}</dd>
              </div>
              {fact?.data.status && (
                <div>
                  <dt>공시 기재</dt>
                  <dd>{fact.data.status}</dd>
                </div>
              )}
              <div>
                <dt>위치</dt>
                <dd>
                  {candidate
                    ? location(candidate)
                    : source.isPending
                      ? '원문 위치 확인 중'
                      : '위치 미확보'}
                </dd>
              </div>
              {fact && (
                <div>
                  <dt>기준 기간</dt>
                  <dd>{fact.data.period ?? '미확보'}</dd>
                </div>
              )}
              <div>
                <dt>접수번호</dt>
                <dd>
                  {bundle.receipt_no} · {bundle.period} 결산
                </dd>
              </div>
            </dl>
            {excerpt && (
              <blockquote className="extraction-quote">
                <p>“{excerpt}”</p>
              </blockquote>
            )}
            <p className="extraction-review-state">
              {pending ? '검수 전 후보' : '사실 검수 승인'}
              {fact
                ? ` · ${kinds[fact.data.kind][1]}`
                : ' · 금액·만기·상대방은 구조화 전입니다.'}
            </p>
            {source.isError && (
              <p className="extraction-error" role="alert">
                원문을 불러오지 못했습니다.{' '}
                <Button variant="ghost" onClick={() => void source.refetch()}>
                  다시 조회
                </Button>
              </p>
            )}
            <Button
              variant="ghost"
              className="extraction-open-source"
              disabled={!candidate || source.isPending}
              onClick={() => setOpen(true)}
            >
              <ExternalLink size={13} aria-hidden="true" />
              원문 열기
            </Button>
          </>
        ) : (
          <p className="extraction-empty">
            {baseline.isPending || facts.isPending
              ? '추출 현황을 확인하고 있습니다.'
              : '확인할 원문 근거가 없습니다. 미검출은 공시상 없음을 의미하지 않습니다.'}
          </p>
        )}
      </aside>
      {open && candidate && (
        <Modal
          open
          title="선택 근거 원문"
          description={`${bundle.period} · ${bundle.scope} · 접수번호 ${bundle.receipt_no}`}
          variant="drawer"
          className="extraction-source-dialog"
          onOpenChange={setOpen}
        >
          <div className="evidence-workspace bundle-panel-body">
            <BundleContext
              key={candidate.segment_id}
              bundle={bundle}
              candidate={candidate}
              onClose={() => setOpen(false)}
            />
          </div>
        </Modal>
      )}
    </div>
  )
}
