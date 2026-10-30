import {
  DataBadge,
  DataStatus,
  FinancialValue,
  MetricValue,
} from './data-status'
import { displayedMetricValue, dataState } from './data-state'
import {
  money,
  metricValue,
  type FinancialMetric,
  type FinancialResult,
} from './api'

type IndustrySpec = {
  description: string
  caution: string
  items: [string, string][]
}
type Tone =
  'warning' | 'attention' | 'watch' | 'approximate' | 'confirmed' | 'missing'
function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`vs-highlight-tag vs-highlight-${tone}`}>{children}</span>
  )
}
const constructionItems: [string, string][] = [
  ['contract_assets_sales_gap', '계약자산 증가율 − 매출 증가율'],
  ['construction_receivable_days', '공사미수금 회수기간'],
  ['cost_ratio', '공사원가율'],
  ['pf_equity', 'PF 보증·조건부 의무 ÷ 자기자본'],
  ['cash_current_liabilities', '영업CF ÷ 유동부채'],
]
const constructionExamples: Record<
  string,
  {
    value?: string
    unit?: string
    benchmark: string
    tone: Tone
    state: string
    subtext?: string
    extra?: string
  }
> = {
  contract_assets_sales_gap: {
    benchmark: '+3.1%p',
    tone: 'warning',
    state: '경고',
  },
  construction_receivable_days: {
    value: '142',
    unit: '일',
    benchmark: '104일',
    tone: 'watch',
    state: '관찰',
  },
  cost_ratio: { benchmark: '90.4%', tone: 'watch', state: '관찰' },
  pf_equity: {
    value: '61',
    unit: '%',
    benchmark: '29%',
    tone: 'attention',
    state: '주의',
    subtext: '1년 내 만기 비중 46%',
    extra: '근사',
  },
  cash_current_liabilities: {
    benchmark: '4.6%',
    tone: 'missing',
    state: '계산 불가',
  },
}
function metric(result: FinancialResult, key: string) {
  return result.metrics.find((m) => m.key === key)
}
function fact(result: FinancialResult, key: string) {
  return result.facts.find((f) => f.key === key && f.period === 'current')
}

export function IndustryHighlights({
  result,
  industry,
  demo,
  onFormula,
}: {
  result: FinancialResult
  industry?: IndustrySpec
  demo: boolean
  onFormula: (m: FinancialMetric, button: HTMLButtonElement) => void
}) {
  const items =
    result.industry === '건설' ? constructionItems : (industry?.items ?? [])
  const cash = fact(result, 'operating_cashflow')
  return (
    <section
      className="vs-panel vs-industry-highlights"
      aria-labelledby="vs-industry-title"
    >
      <div className="vs-heading">
        <div>
          <h2 id="vs-industry-title">
            {result.industry ?? '업종 미확정'} 업종 핵심 지표
          </h2>
          <p className="vs-muted">업종 우선 지표 · 업종 중앙값 대비</p>
        </div>
        <div className="vs-highlight-meta">
          <span>업종 기준 · {demo ? '예시' : '비교 보류'}</span>
          <span>팀 가설</span>
        </div>
      </div>
      {items.length ? (
        <>
          <div className="vs-compact-table-wrap">
            <table className="vs-compact-table" aria-label="업종 핵심 지표">
              <thead>
                <tr>
                  <th>지표</th>
                  <th>당기</th>
                  <th>업종</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {items.map(([key, label]) => {
                  const m = metric(result, key)
                  const example =
                    demo && result.industry === '건설'
                      ? constructionExamples[key]
                      : undefined
                  const cashFallback =
                    key === 'cash_current_liabilities' &&
                    cash?.value != null &&
                    Number(cash.value) < 0
                  const current = m
                    ? displayedMetricValue(m, result)
                    : undefined
                  return (
                    <tr key={key}>
                      <th scope="row">
                        {m && !example?.value ? (
                          <button
                            className="vs-text-button"
                            aria-label={`${label} 산식 보기`}
                            onClick={(e) => onFormula(m, e.currentTarget)}
                          >
                            {label}
                          </button>
                        ) : (
                          label
                        )}
                        {example?.subtext && <small>{example.subtext}</small>}
                      </th>
                      <td
                        className={
                          cashFallback || example?.tone === 'warning'
                            ? 'vs-change-down'
                            : ''
                        }
                      >
                        {cashFallback ? (
                          <>{money(cash.value)}억</>
                        ) : example?.value != null ? (
                          metricValue(example.value, example.unit ?? '')
                        ) : m ? (
                          <>
                            {key === 'contract_assets_sales_gap' &&
                              current?.value != null &&
                              Number(current.value) > 0 &&
                              '+'}
                            <MetricValue metric={m} result={result} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{example?.benchmark ?? '비교 보류'}</td>
                      <td>
                        {example ? (
                          <>
                            <Tag tone={example.tone}>{example.state}</Tag>
                            {example.extra && (
                              <Tag tone="approximate">{example.extra}</Tag>
                            )}
                          </>
                        ) : cashFallback ? (
                          <Tag tone="missing">영업CF 음수 · 비율 보류</Tag>
                        ) : m ? (
                          <DataStatus value={current} />
                        ) : (
                          <Tag tone="missing">자료 미확보</Tag>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="vs-highlight-note">
            {result.industry === '건설'
              ? '표시 부채비율 대신 선수금 제외 부채비율을 씁니다. PF 만기 사다리와 우발채무는 주석·위험징후에서 봅니다.'
              : industry?.caution}
            {demo && ' 상태·업종 수치는 화면 예시입니다.'}
          </p>
        </>
      ) : (
        <p className="vs-empty">
          확인된 적용 업종이 없어 지표를 임의로 선택하지 않았습니다.
        </p>
      )}
    </section>
  )
}

export function RepaymentHighlights({
  result,
  demo,
  onLease,
  onFormula,
}: {
  result: FinancialResult
  demo: boolean
  onLease?: (lease: 'include' | 'exclude') => void
  onFormula: (m: FinancialMetric, button: HTMLButtonElement) => void
}) {
  const cash = fact(result, 'operating_cashflow')
  const rows: [string, string][] = [
    ['interest_coverage', '이자보상비율'],
    ['ebitda_coverage', 'EBITDA 이자보상배율'],
    ['cash_coverage', '현금보상비율'],
    ['finance_cost_burden', '금융비용부담률'],
  ]
  const exampleValues: Record<string, [string | null, string | null, string]> =
    {
      interest_coverage: ['1.6', '2.3', '배'],
      ebitda_coverage: ['1.8', '2.5', '배'],
      cash_coverage: [null, '1.9', '배'],
      finance_cost_burden: ['2.6', '2.1', '%'],
    }
  const deposit = fact(result, 'rental_deposits')
  return (
    <section
      className="vs-panel vs-repayment-highlights"
      aria-labelledby="vs-debt-title"
    >
      <div className="vs-heading">
        <div>
          <h2 id="vs-debt-title">상환능력</h2>
          <p className="vs-muted">총차입금 구성과 이자·현금 상환 여력</p>
        </div>
        <div className="vs-highlight-controls">
          <label className="vs-lease-switch">
            <input
              type="checkbox"
              checked={result.context.lease === 'include'}
              disabled={!onLease}
              onChange={(e) =>
                onLease?.(e.target.checked ? 'include' : 'exclude')
              }
            />
            <span aria-hidden="true" />
            리스부채 포함{demo && <small>예시</small>}
          </label>
          {demo ? (
            <Tag tone="missing">임대보증금 해당 없음 · 예시</Tag>
          ) : deposit?.value != null ? (
            <span className="vs-muted">
              임대보증금 {money(deposit.value)}억원 · 별도
            </span>
          ) : (
            <Tag tone="missing">임대보증금 미확보</Tag>
          )}
        </div>
      </div>
      <div className="vs-repayment-grid">
        <BorrowingOverview result={result} demo={demo} onFormula={onFormula} />
        <div className="vs-compact-table-wrap">
          <table
            className="vs-compact-table vs-repayment-table"
            aria-label="이자·현금 상환 지표"
          >
            <thead>
              <tr>
                <th>지표</th>
                <th>당기</th>
                <th>전기</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([key, label]) => {
                const m = metric(result, key)
                const example = demo ? exampleValues[key] : undefined
                const cashHold =
                  key === 'cash_coverage' &&
                  cash?.value != null &&
                  Number(cash.value) < 0
                return (
                  <tr key={key}>
                    <th scope="row">
                      {m && !demo ? (
                        <button
                          className="vs-text-button"
                          aria-label={`${label} 산식 보기`}
                          onClick={(e) => onFormula(m, e.currentTarget)}
                        >
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                    <td>
                      {cashHold ? (
                        '—'
                      ) : example ? (
                        metricValue(example[0], example[2])
                      ) : m ? (
                        <MetricValue metric={m} result={result} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {example ? (
                        metricValue(example[1], example[2])
                      ) : m ? (
                        <MetricValue
                          metric={m}
                          result={result}
                          period="previous"
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {cashHold ? (
                        <Tag tone="missing">계산 불가: 영업CF 음수</Tag>
                      ) : demo ? (
                        key === 'interest_coverage' ||
                        key === 'ebitda_coverage' ? (
                          <Tag tone="approximate">근사: 금융원가</Tag>
                        ) : (
                          <Tag tone="confirmed">확정</Tag>
                        )
                      ) : (
                        <DataStatus
                          value={
                            m ? displayedMetricValue(m, result) : undefined
                          }
                        />
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {demo && (
            <p className="vs-repayment-example-note">
              비율·자료 상태는 상환 지표 표시 예시입니다.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function BorrowingOverview({
  result,
  demo,
  onFormula,
}: {
  result: FinancialResult
  demo: boolean
  onFormula: (m: FinancialMetric, button: HTMLButtonElement) => void
}) {
  const groups = [
    {
      label: '단기',
      keys: [
        'short_borrowings',
        ...(result.context.lease === 'include' ? ['current_lease'] : []),
      ],
    },
    {
      label: '유동성장기·사채',
      keys: ['current_long_borrowings', 'current_bonds'],
    },
    {
      label: '장기',
      keys: [
        'long_borrowings',
        ...(result.context.lease === 'include' ? ['noncurrent_lease'] : []),
      ],
    },
    { label: '사채', keys: ['bonds'] },
  ].map((group) => {
    const values = group.keys.map((key) => fact(result, key))
    const complete = values.every(
      (value) =>
        dataState(value) === 'CONFIRMED' &&
        value?.value != null &&
        Number(value.value) >= 0,
    )
    return {
      ...group,
      value: complete
        ? values.reduce((sum, value) => sum + Number(value!.value), 0)
        : null,
    }
  })
  const total = result.borrowing_totals.current
  const note = result.note_borrowing_summaries.current
  const noteRatio = metric(result, 'note_borrowing_ratio')
  const complete =
    total != null &&
    Number(total) > 0 &&
    groups.every((group) => group.value != null) &&
    Math.abs(
      groups.reduce((sum, group) => sum + (group.value ?? 0), 0) -
        Number(total),
    ) < 0.01
  const colors = ['#60584c', '#827a6d', '#a69f93', '#d2cdc4']
  // Demo-only verified maturity metadata, never inferred from short-term borrowing alone for live runs.
  const maturity =
    demo && complete
      ? { amount: 9300e8, percent: 49, width: (9300e8 / Number(total)) * 100 }
      : null
  return (
    <div className="vs-borrowing-overview">
      <h3>
        총차입금{' '}
        <strong>{total == null ? '합산 보류' : `${money(total)}억원`}</strong>
      </h3>
      {complete ? (
        <>
          <div className="vs-maturity-space">
            {maturity ? (
              <div
                className="vs-maturity-bracket"
                style={{ width: `${maturity.width}%` }}
              >
                <span>
                  1년 내 만기 {money(String(maturity.amount))}억원 ·{' '}
                  {maturity.percent}%
                </span>
              </div>
            ) : (
              <p className="vs-muted">1년 내 만기 · 상세 자료 확인 필요</p>
            )}
          </div>
          <div
            className="vs-debt-stack vs-debt-overview-stack"
            role="img"
            aria-label={`총차입금 ${money(total)}억원의 구성. 항목별 금액은 아래에 표시합니다.`}
          >
            {groups.map((group, i) => (
              <span
                key={group.label}
                title={`${group.label}: ${money(String(group.value))}억원`}
                style={{
                  width: `${(group.value! / Number(total)) * 100}%`,
                  background: colors[i],
                }}
              />
            ))}
          </div>
          <div
            className="vs-borrowing-labels"
            style={{
              gridTemplateColumns: groups
                .map((group) => `minmax(55px, ${group.value ?? 0}fr)`)
                .join(' '),
              gap: 0,
            }}
          >
            {groups.map((group, index) => (
              <div key={group.label}>
                <span>{demo && index === 1 ? '유동성장기' : group.label}</span>
                <strong>
                  {money(group.value == null ? null : String(group.value))}
                </strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="vs-muted">전체 구성을 확인할 수 없어 비중 표시 보류</p>
          <div className="vs-borrowing-labels">
            {groups.map((group) => (
              <div key={group.label}>
                <span>{group.label}</span>
                <strong>
                  {group.value == null
                    ? '자료 없음'
                    : money(String(group.value))}
                </strong>
              </div>
            ))}
          </div>
        </>
      )}
      {!demo && (
        <details className="vs-borrowing-details">
          <summary>차입 구성 원천 계정·자료 상태</summary>
          <div className="vs-compact-table-wrap">
            <table className="vs-compact-table" aria-label="차입 구성">
              <thead>
                <tr>
                  <th>계정</th>
                  <th>당기 · 억원</th>
                  <th>자료 상태·근거</th>
                </tr>
              </thead>
              <tbody>
                {groups
                  .flatMap((group) => group.keys)
                  .map((key) => {
                    const value = fact(result, key)
                    return (
                      <tr key={key}>
                        <th scope="row">{value?.label ?? key}</th>
                        <td>
                          <FinancialValue value={value} />
                        </td>
                        <td>
                          <DataBadge value={value} />
                        </td>
                      </tr>
                    )
                  })}
                {note?.base_subtotal != null && (
                  <>
                    <tr>
                      <th scope="row">주석 차입금 소계 · 리스 제외</th>
                      <td>{money(note.base_subtotal)}</td>
                      <td>
                        <details>
                          <summary>주석 표 검산 일치 · 근거 보기</summary>
                          {note.components.map((part) => (
                            <p key={part.label}>
                              {part.label}: {money(part.value)}억원
                            </p>
                          ))}
                          {note.reconciliation && (
                            <p>
                              검산 대상 {note.reconciliation.label}:{' '}
                              {money(note.reconciliation.value)}억원
                            </p>
                          )}
                          <p>표 위치: {note.source_xpath}</p>
                          <a
                            href={result.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            주석 원문 확인
                          </a>
                        </details>
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        주석 소계 · 리스{' '}
                        {result.context.lease === 'include' ? '포함' : '제외'}
                      </th>
                      <td>{money(note.adjusted_subtotal)}</td>
                      <td>회사 주석의 검산된 구성 범위</td>
                    </tr>
                  </>
                )}
                <tr>
                  <th scope="row">정의된 총차입금</th>
                  <td>{money(total)}</td>
                  <td>
                    {total == null
                      ? '구성 계정 미확보 · 합산 보류'
                      : '구성 계정 합산'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {noteRatio && (
            <button
              className="vs-text-button"
              onClick={(e) => onFormula(noteRatio, e.currentTarget)}
            >
              주석 차입금 소계/총자산 산식 보기
            </button>
          )}
          <p>
            미확보 계정은 주석 보강 필요 항목입니다. 주석 소계는 전체 차입
            범위를 대신하지 않습니다. 유동성 사채는 유동성장기 그룹, 리스 포함
            시 유동 리스는 단기·비유동 리스는 장기 그룹에 표시합니다. 표시
            그룹은 검증된 만기표를 대신하지 않습니다.
          </p>
        </details>
      )}
    </div>
  )
}
import type { ReactNode } from 'react'
