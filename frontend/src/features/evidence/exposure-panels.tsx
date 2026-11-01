import { useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { BundleContext } from './bundle-panel'
import { getBundleCandidate, type EvidenceBundle } from './bundle-api'
import {
  exposureMoney as money,
  useExposureSummary,
  type ExposureSource,
  type ExposureSummary,
} from './exposure-api'
import './exposure-panels.css'
import { SessionContext } from '../session/session-context'

const types = [
  ['PF_GUARANTEE', 'PF 대출보증'],
  ['COMPLETION_SUPPORT', '책임준공 미이행 시 채무인수'],
  ['FUNDING_SUPPORT', '자금보충'],
  ['BUYER_GUARANTEE', '수분양자 중도금 보증'],
]
const columns = [
  ['limit', '보증한도'],
  ['commitment', '보증·약정'],
  ['loan_balance', '대출잔액'],
  ['related_party', '특수관계'],
] as const
const buckets = [
  ['within', '1년 이내'],
  ['beyond', '1년 초과'],
  ['undisclosed', '만기 미공시'],
] as const
type OpenSource = (source: ExposureSource) => void

function SourceLinks({
  sources,
  onOpen,
}: {
  sources: ExposureSource[]
  onOpen: OpenSource
}) {
  return (
    <span className="exposure-sources">
      {sources.map((s) => (
        <button key={s.segment_id} title={s.title} onClick={() => onOpen(s)}>
          {s.title}
          <ArrowUpRight size={11} aria-hidden="true" />
        </button>
      ))}
    </span>
  )
}

function SourceDrawer({
  bundle,
  source,
  onClose,
}: {
  bundle: EvidenceBundle
  source: ExposureSource
  onClose: () => void
}) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const candidate = useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      bundle.bundle_revision,
      'exposure-original',
      source.segment_id,
    ],
    queryFn: () => getBundleCandidate(bundle, source.segment_id),
    retry: false,
  })
  return (
    <Modal
      open
      title="구성·만기·소송 원문"
      description={`${bundle.period} · ${bundle.scope} · ${source.title}`}
      variant="drawer"
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      className="extraction-source-dialog"
    >
      <div className="evidence-workspace bundle-panel-body">
        {candidate.data ? (
          <BundleContext
            bundle={bundle}
            candidate={candidate.data}
            onClose={onClose}
          />
        ) : candidate.isError ? (
          <p role="alert">
            원문을 불러오지 못했습니다.{' '}
            <Button variant="outline" onClick={() => void candidate.refetch()}>
              다시 조회
            </Button>
          </p>
        ) : (
          <p role="status">원문을 불러오는 중입니다.</p>
        )}
      </div>
    </Modal>
  )
}

function MaturityBar({
  label,
  data,
  onOpen,
}: {
  label: string
  data?: ExposureSummary['maturity']['debt']
  onOpen: OpenSource
}) {
  const amount = Number(data?.total ?? 0)
  const visibleBuckets = [
    ...buckets,
    ...(Number(data?.values.overdue ?? 0) > 0
      ? [['overdue', '기준일 전 만기'] as const]
      : []),
  ]
  return (
    <div className="exposure-maturity-group">
      <div className="exposure-maturity-heading">
        <h3>{label}</h3>
        <SourceLinks sources={data?.sources ?? []} onOpen={onOpen} />
      </div>
      <div
        className={`exposure-maturity-bar ${data?.total == null ? 'is-empty' : ''}`}
        role="img"
        aria-label={
          data?.total == null
            ? `${label}: 만기 정보 미확보`
            : `${label}: ${visibleBuckets.map(([k, v]) => `${v} ${money(data.values[k])}억원`).join(', ')}`
        }
      >
        {data?.total == null ? (
          <span>만기 정보 미확보</span>
        ) : (
          visibleBuckets.map(([k]) => (
            <span
              key={k}
              className={`is-${k}`}
              style={{
                width: `${amount > 0 ? (Number(data.values[k] ?? 0) / amount) * 100 : 0}%`,
              }}
            />
          ))
        )}
      </div>
      <div
        className="exposure-maturity-values"
        style={{
          gridTemplateColumns: `repeat(${visibleBuckets.length},minmax(0,1fr))`,
        }}
      >
        {visibleBuckets.map(([k, v]) => (
          <span key={k}>
            <span className="sr-only">{v} </span>
            <strong>{money(data?.values[k])}</strong>
            {k === 'within' && data?.within_percent != null && (
              <small> ({Number(data.within_percent).toFixed(0)}%)</small>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ExposurePanels({ bundle }: { bundle: EvidenceBundle }) {
  const query = useExposureSummary(bundle)
  const data = query.data
  const legendBuckets = [
    ...buckets,
    ...(Number(data?.maturity.debt.values.overdue ?? 0) > 0 ||
    Number(data?.maturity.obligation.values.overdue ?? 0) > 0
      ? [['overdue', '기준일 전 만기'] as const]
      : []),
  ]
  const [source, setSource] = useState<ExposureSource | null>(null)
  const rows = [
    ...types,
    ...(data?.provided.rows
      .filter((r) => !types.some(([key]) => key === r.type))
      .map((r) => [r.type, r.label]) ?? []),
  ]
  return (
    <div className="exposure-layout">
      {query.isError && (
        <div className="exposure-query-error" role="alert">
          구성·만기·소송 자료를 불러오지 못했습니다.{' '}
          <Button variant="outline" onClick={() => void query.refetch()}>
            다시 조회
          </Button>
        </div>
      )}
      <section
        className="panel exposure-composition"
        aria-label="제공 보증·조건부 의무 구성"
      >
        <div className="exposure-panel-heading">
          <h2>제공 보증·조건부 의무 구성</h2>
          <div className="extraction-tags">
            <span>{bundle.scope === 'OFS' ? '별도' : '연결'} · 억원</span>
            <span>분자 기준: 대출잔액</span>
          </div>
        </div>
        <div className="exposure-table-scroll">
          <table
            className="exposure-composition-table"
            aria-label="제공 보증 구성 표"
          >
            <thead>
              <tr>
                <th>유형 (사업장 수)</th>
                {columns.map(([k, v]) => (
                  <th
                    key={k}
                    className={k === 'loan_balance' ? 'is-numerator' : ''}
                  >
                    {v}
                  </th>
                ))}
                <th>원문 위치</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, label]) => {
                const r = data?.provided.rows.find((r) => r.type === key)
                return (
                  <tr key={key}>
                    <th scope="row">
                      {label}
                      {r?.project_count != null && (
                        <span className="exposure-project-count">
                          {' '}
                          ({r.project_count})
                        </span>
                      )}
                    </th>
                    {columns.map(([k]) => (
                      <td
                        key={k}
                        className={k === 'loan_balance' ? 'is-numerator' : ''}
                      >
                        {money(r?.values[k])}
                      </td>
                    ))}
                    <td>
                      {r ? (
                        <SourceLinks sources={r.sources} onOpen={setSource} />
                      ) : (
                        <span className="exposure-unavailable">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              <tr className="exposure-total">
                <th scope="row">분자 합계</th>
                <td />
                <td />
                <td className="is-numerator">
                  {money(data?.provided.totals.loan_balance)}
                </td>
                <td>{money(data?.provided.totals.related_party)}</td>
                <td className="exposure-equity-ratio">
                  ÷ 자기자본 {money(data?.equity)}
                  <strong>
                    {data?.ratio_percent != null
                      ? `= ${Number(data.ratio_percent).toFixed(1)}%`
                      : '비율 미산출'}
                  </strong>
                </td>
              </tr>
            </tbody>
            {!!data?.received.rows.length && (
              <tbody className="exposure-received">
                {data.received.rows.map((r) => (
                  <tr key={r.type}>
                    <th scope="row">
                      제공받은 보증 (참고)<small>{r.label}</small>
                    </th>
                    <td>{money(r.values.limit)}</td>
                    <td>{money(r.values.commitment)}</td>
                    <td colSpan={2}>합산 제외</td>
                    <td>
                      <SourceLinks sources={r.sources} onOpen={setSource} />
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        <p className="exposure-footnote">
          제공분의 대출잔액을 분자로 사용합니다. 총괄행과 하위 행은 중복
          합산하지 않으며, 수취분은 참고로만 표시합니다.
        </p>
        <p className="exposure-footnote">
          {query.isPending
            ? '구성 자료를 불러오는 중입니다.'
            : data?.provided.complete
              ? '동일 기준 기간·회계 범위의 검수 완료 금액입니다.'
              : '검수·유형·상세행 구분이 확인된 자료가 있어야 합계를 산출합니다.'}{' '}
          사업장 수 미확보 시 피보증처 수로 대체하지 않습니다.
        </p>
      </section>
      <div className="exposure-summary-column">
        <section
          className="panel exposure-maturity"
          aria-label="1년 내 만기 요약"
        >
          <div className="exposure-panel-heading">
            <h2>1년 내 만기 요약</h2>
            <Link
              to="?tab=signals&detail=maturity"
              className="exposure-detail-link"
            >
              만기 사다리 보기 →
            </Link>
          </div>
          <div className="exposure-maturity-meta">
            <div className="exposure-maturity-legend">
              {legendBuckets.map(([k, v]) => (
                <span key={k}>
                  <i className={`is-${k}`} />
                  {v}
                </span>
              ))}
            </div>
            <span>억원 · {data?.as_of ?? bundle.period}부터</span>
          </div>
          <MaturityBar
            label="차입금·사채"
            data={data?.maturity.debt}
            onOpen={setSource}
          />
          <MaturityBar
            label="제공 보증·조건부 의무"
            data={data?.maturity.obligation}
            onOpen={setSource}
          />
          <p className="exposure-maturity-note">
            구간 경계는 <strong>공시 기준일에서 1년</strong>입니다
            {data ? ` (${data.as_of} → ${data.cutoff})` : ''}. 만기를 확인하지
            못한 금액은 0으로 두지 않고 미공시로 분리합니다. 기준일 전 만기는
            별도 구간으로 표시합니다. 검수 완료된 확보분 기준이며 자료가
            부족하면 전체 비중으로 해석할 수 없습니다.
          </p>
        </section>
        <section
          className="panel exposure-litigation"
          aria-label="소송 현황 피고"
        >
          <div className="exposure-panel-heading">
            <h2>
              소송 현황 <span>(피고)</span>
            </h2>
            <span className="exposure-unavailable">억원</span>
          </div>
          <dl className="exposure-litigation-stats">
            <div>
              <dt>공시 건수</dt>
              <dd>
                {data?.litigation.case_count == null
                  ? '미확보'
                  : `${data.litigation.case_count}건`}
              </dd>
            </div>
            <div>
              <dt>소송가액</dt>
              <dd>{money(data?.litigation.claim)}</dd>
            </div>
            <div>
              <dt>소송충당부채</dt>
              <dd>{money(data?.litigation.provision)}</dd>
            </div>
          </dl>
          {!!data?.litigation.top_cases.length && (
            <>
              <h3>소송가액 상위 3건</h3>
              <ol className="exposure-case-list">
                {data.litigation.top_cases.map((c) => (
                  <li key={c.case_number}>
                    <div>
                      <strong>{c.label}</strong>
                      <span>{money(c.claim)}억원</span>
                    </div>
                    <small>{c.case_number}</small>
                    <SourceLinks sources={c.sources} onOpen={setSource} />
                  </li>
                ))}
              </ol>
            </>
          )}
          <SourceLinks
            sources={data?.litigation.sources ?? []}
            onOpen={setSource}
          />
          <p className="exposure-footnote">
            {data?.litigation.top_cases.length
              ? '사건번호와 소송가액이 확인된 개별 사건만 표시합니다.'
              : '개별 사건이 미확보되면 공시된 합계만 표시합니다.'}{' '}
            원고 사건은 참고 정보이며 피고 금액에 합산하지 않습니다. 소송가액은
            손실 확정액이 아닙니다.
          </p>
        </section>
      </div>
      {!!data?.excluded_facts && (
        <p className="exposure-exclusions">
          검수 대기·근거 변경·기간/회계 범위 미확인·충돌 등으로 사실{' '}
          {data.excluded_facts}개를 집계에서 제외했습니다.
        </p>
      )}
      {source && (
        <SourceDrawer
          key={source.segment_id}
          bundle={bundle}
          source={source}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  )
}

export function MaturityLadder({ bundle }: { bundle: EvidenceBundle }) {
  const query = useExposureSummary(bundle)
  const [source, setSource] = useState<ExposureSource | null>(null)
  return (
    <section className="panel exposure-ladder" aria-label="상세 만기 사다리">
      <div className="exposure-panel-heading">
        <h2>상세 만기 사다리</h2>
        <span>{bundle.scope} · 억원</span>
      </div>
      <p className="exposure-footnote">
        공시 기준일 {query.data?.as_of ?? bundle.period} · 1년 경계{' '}
        {query.data?.cutoff ?? '확인 중'}
      </p>
      <div className="exposure-table-scroll">
        <table className="exposure-ladder-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>항목</th>
              <th>금액</th>
              <th>공시 만기</th>
              <th>원문</th>
            </tr>
          </thead>
          <tbody>
            {(['debt', 'obligation'] as const).flatMap((k) =>
              (query.data?.maturity[k].items ?? []).map((item, i) => (
                <tr key={`${k}:${i}`}>
                  <td>
                    {k === 'debt' ? '차입금·사채' : '제공 보증·조건부 의무'}
                  </td>
                  <th scope="row">{item.label}</th>
                  <td>{money(item.amount)}</td>
                  <td>{item.maturity ?? '만기 미공시'}</td>
                  <td>
                    <SourceLinks sources={[item.source]} onOpen={setSource} />
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {!query.data?.maturity.debt.items.length &&
        !query.data?.maturity.obligation.items.length && (
          <p className="exposure-footnote">
            {query.isPending
              ? '만기 자료를 불러오는 중입니다.'
              : query.isError
                ? '만기 자료를 불러오지 못했습니다.'
                : '집계 가능한 검수 완료 만기 자료가 없습니다.'}
          </p>
        )}
      {source && (
        <SourceDrawer
          key={source.segment_id}
          bundle={bundle}
          source={source}
          onClose={() => setSource(null)}
        />
      )}
    </section>
  )
}
