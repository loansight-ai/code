import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { SessionContext } from '../features/session/session-context'
import { TaskContext } from '../features/tasks/task-context'
import { ApiError } from '../features/session/api'
import {
  getFinancialRun,
  startFinancialRun,
  financialError,
  reasonLabels,
  money,
  metricValue,
  type FinancialResult,
  type FinancialMetric,
} from '../features/financial/api'
import { StatePanel } from '../shared/components/state-panel'
import { Button } from '../shared/components/button'
import { LiveFormulaDialog } from '../features/financial/live-formula-dialog'
import { Chart } from '../shared/components/chart'
import { StatusBadge } from '../shared/components/status-badge'
import {
  DataBadge,
  DataStateBadge,
  DataStatus,
  FinancialValue,
  MetricStatus,
  MetricValue,
} from '../features/financial/data-status'
import '../financial-summary.css'
import {
  FinancialFactEvidence,
  FinancialNoteProgress,
} from '../features/financial/note-progress'

export function FinancialSummaryPage() {
  const { financialId = '', section = 'summary' } = useParams()
  return (
    <FinancialPage
      key={financialId}
      id={financialId.toLowerCase()}
      section={section}
    />
  )
}

function FinancialPage({ id, section }: { id: string; section: string }) {
  const session = useContext(SessionContext)
  const tasks = useContext(TaskContext)
  const navigate = useNavigate()
  const workspace = session?.session?.workspace_id
  const activeWorkspace = useRef<string | null>(null)
  const activeOwner = session?.phase === 'ready' ? workspace : undefined
  useEffect(() => {
    activeWorkspace.current = activeOwner ?? null
    return () => {
      activeWorkspace.current = null
    }
  }, [activeOwner])
  const valid =
    z.string().uuid().safeParse(id).success &&
    ['summary', 'cashflow'].includes(section)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const run = useQuery({
    queryKey: ['server', workspace, 'financial-run', id],
    queryFn: ({ signal }) => getFinancialRun(id, signal),
    enabled: valid && !!workspace && session?.phase === 'ready',
    retry: false,
    refetchInterval: (q) =>
      q.state.data &&
      (['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(q.state.data.status) ||
        ['BASE_ANALYSIS', 'WAITING_STRUCTURE', 'ENRICHING'].includes(
          q.state.data.note_workflow?.stage ?? '',
        ))
        ? 1000
        : false,
  })
  useEffect(() => {
    if (run.error instanceof ApiError && run.error.status === 401)
      session?.expire()
  }, [run.error, session])
  if (!valid)
    return (
      <main id="main" className="page">
        <StatePanel state="error" title="재무 분석 주소를 확인해 주세요" />
      </main>
    )
  if (session?.phase === 'loading' || session?.phase === 'changing')
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="접속 상태를 확인하고 있습니다" />
      </main>
    )
  if (!workspace)
    return (
      <main id="main" className="page">
        <StatePanel state="pending" title="사용자 코드로 접속해 주세요" />
      </main>
    )
  if (run.isPending)
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="재무 분석을 불러오는 중입니다" />
      </main>
    )
  if (run.isError || !run.data)
    return (
      <main id="main" className="page">
        <StatePanel
          state="error"
          title="재무 분석을 확인하지 못했습니다"
          description={financialError(run.error)}
          action={{
            label: '다시 조회',
            onClick: () => {
              void run.refetch()
            },
          }}
        />
      </main>
    )
  const { context, result, status, error_code } = run.data
  const search = new URLSearchParams({
    q: context.corp_code,
    corp: context.corp_code,
    report: context.receipt_no,
    scope: context.scope,
  })
  const running = ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(status)
  const supplementing = [
    'BASE_ANALYSIS',
    'WAITING_STRUCTURE',
    'ENRICHING',
  ].includes(run.data.note_workflow?.stage ?? '')
  async function start(lease: 'include' | 'exclude', refresh = false) {
    if (!run.data) return
    const owner = activeWorkspace.current
    setPending(true)
    setError('')
    try {
      const next = await startFinancialRun({
        corp_code: context.corp_code,
        receipt_no: context.receipt_no,
        scope: context.scope,
        lease,
        ...(context.enrich_notes ? { enrich_notes: true } : {}),
        ...(refresh
          ? { refresh_key: crypto.randomUUID() }
          : context.refresh_key
            ? { refresh_key: context.refresh_key }
            : {}),
      })
      if (owner !== activeWorkspace.current) return
      tasks?.refresh()
      await navigate(
        `/financials/${next.analysis_run_id}/${section}?corp=${context.corp_code}`,
      )
    } catch (failure) {
      setError(financialError(failure))
      setPending(false)
    }
  }
  return (
    <main id="main" className="page">
      <Link to={`/?${search}`} className="back-link">
        ← 기업·보고서 다시 선택
      </Link>
      <div className="page-title-row">
        <div>
          <h1>
            {section === 'summary' ? '핵심 재무 요약' : '실적 변동·현금흐름'}
          </h1>
          <p className="page-description">
            {result?.company_name ?? context.corp_code} · {context.report_name}{' '}
            · {context.scope === 'OFS' ? '별도' : '연결'} 기준
          </p>
        </div>
        <Button
          variant="outline"
          disabled={running || supplementing || pending}
          onClick={() => {
            void start(context.lease, true)
          }}
        >
          다시 수집·분석
        </Button>
      </div>
      <div className="source-strip">
        <strong>공시 기준</strong>
        <span>{context.period} 결산</span>
        <span>접수번호 {context.receipt_no}</span>
        <span>제출일 {context.receipt_date}</span>
        <span>리스 {context.lease === 'include' ? '포함' : '제외'}</span>
        <a
          href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${context.receipt_no}`}
          target="_blank"
          rel="noreferrer"
        >
          DART 원문
        </a>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {pending ? (
        <StatePanel
          state="loading"
          title="변경한 조건의 분석을 요청하고 있습니다"
        />
      ) : running ? (
        <StatePanel
          state="loading"
          title={
            status === 'RETRY_WAIT'
              ? '재무 수집을 다시 시도할 예정입니다'
              : '재무 데이터를 수집·계산하고 있습니다'
          }
          description="작업은 화면을 닫아도 계속됩니다. 내 분석 작업에서 다시 열 수 있습니다."
        />
      ) : status === 'FAILED' ? (
        <StatePanel
          state="error"
          title="재무 분석에 실패했습니다"
          description={
            reasonLabels[error_code ?? ''] ??
            '내 분석 작업에서 상태를 확인한 뒤 다시 수집해 주세요.'
          }
        />
      ) : result ? (
        <>
          <div className="financial-source-meta">
            <a href={`/api/v1/me/financial-analyses/${id}/source`}>
              수집 원본 JSON
            </a>
            <span>
              수집{' '}
              {new Date(result.collected_at).toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
              })}
            </span>
            <span>원본 {result.source_sha256.slice(0, 12)}</span>
            <span>
              {result.mapping_version} · {result.formula_version}
            </span>
          </div>
          <p className="notice">
            {result.comparison_basis} 금액은 억원으로 표시합니다. 미확보와 실제
            0은 구분하며, 미정 산식은 보류합니다.
          </p>
          {result.availability === 'NO_DATA' && (
            <StatePanel
              state="empty"
              title="선택한 회계 범위의 정형 재무 데이터가 없습니다"
              description="다른 회계 범위의 값으로 대체하지 않았습니다. 보고서와 회계 범위를 확인해 주세요."
            />
          )}
          <FinancialNoteProgress
            workflow={run.data.note_workflow}
            result={result}
          />
          {section === 'summary' ? (
            <Summary
              result={result}
              onLease={(lease) => {
                void start(lease)
              }}
            />
          ) : (
            <Cashflow result={result} />
          )}
          <SourceFacts result={result} />
          <div className="workspace-next">
            <Link
              to={`/financials/${id}/${section === 'summary' ? 'cashflow' : 'summary'}?corp=${context.corp_code}`}
            >
              {section === 'summary'
                ? '실적 변동·현금흐름 →'
                : '핵심 재무 요약 →'}
            </Link>
          </div>
        </>
      ) : (
        <StatePanel state="empty" title="저장된 재무 결과가 없습니다" />
      )}
    </main>
  )
}

function getFact(result: FinancialResult, key: string, period = 'current') {
  return result.facts.find((f) => f.key === key && f.period === period)
}
function getMetric(result: FinancialResult, key: string) {
  return result.metrics.find((m) => m.key === key)
}
function metricPeriod(metric: FinancialMetric | undefined, period = 'current') {
  return metric?.values.find((v) => v.period === period)
}
function Summary({
  result,
  onLease,
}: {
  result: FinancialResult
  onLease: (lease: 'include' | 'exclude') => void
}) {
  const [params, setParams] = useSearchParams()
  const groups = ['유동성', '레버리지', '활동성', '수익성', '성장성']
  const group = groups.includes(params.get('ratio') ?? '')
    ? params.get('ratio')!
    : '유동성'
  const [formula, setFormula] = useState<FinancialMetric | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const profit = getFact(result, 'operating_profit')
  const previous = getFact(result, 'operating_profit', 'previous')
  const noteBorrowing = result.note_borrowing_summaries.current
  const difference = result.changes.operating_profit?.amount
  const core = [
    'current_ratio',
    'debt_ratio',
    'operating_margin',
    'operating_roa',
    'interest_coverage',
  ]
  const terms = [...result.periods].reverse()
  const chartData = (key: string) =>
    terms.map((p) => {
      const value = getFact(result, key, p.key)?.value
      return value == null ? null : Number(value) / 100_000_000
    })
  function show(metric: FinancialMetric, button: HTMLButtonElement) {
    opener.current = button
    setFormula(metric)
  }
  return (
    <>
      <div className="profit-overview">
        <section className="panel profit-primary">
          <span>영업이익 · {result.context.scope} · 억원</span>
          <strong>
            <FinancialValue value={profit} />
            {profit?.value != null && <small>억원</small>}
          </strong>
          <p>
            전기 <FinancialValue value={previous} />
            {previous?.value != null && '억원'} · 증감{' '}
            {difference == null
              ? '비교 보류'
              : `${Number(difference) > 0 ? '+' : ''}${money(difference)}억원`}
          </p>
          <p>
            증가율{' '}
            {result.changes.operating_profit?.transition ? (
              '계산 불가 · 증감 금액으로 비교'
            ) : result.changes.operating_profit?.growth == null ? (
              <span className="financial-data-empty">
                {result.changes.operating_profit?.reason === 'missing_input'
                  ? '자료 없음'
                  : '계산 불가'}
              </span>
            ) : (
              metricValue(result.changes.operating_profit.growth, '%')
            )}{' '}
            {result.changes.operating_profit?.transition === 'NEGATIVE_TURN'
              ? '· 적자 전환'
              : result.changes.operating_profit?.transition === 'POSITIVE_TURN'
                ? '· 흑자 전환'
                : ''}
          </p>
          <p>
            <DataStatus value={profit} />
          </p>
          <p>
            영업이익률{' '}
            <FinancialValue
              value={metricPeriod(getMetric(result, 'operating_margin'))}
              unit="%"
            />
          </p>
        </section>
        <div className="profit-support">
          {[
            ['revenue', '매출액'],
            ['operating_cashflow', '영업활동현금흐름'],
            ['depreciation', '감가상각비'],
          ].map(([key, label]) => {
            const fact = getFact(result, key)
            return (
              <section className="panel" key={key}>
                <span>{label}</span>
                <strong>
                  <FinancialValue value={fact} />
                  {fact?.value != null && <small>억원</small>}
                </strong>
                <p>
                  <DataStatus value={fact} />
                </p>
              </section>
            )
          })}
        </div>
      </div>
      <section className="panel analysis-section">
        <div className="panel-heading">
          <h2>공통 핵심 5개 비율</h2>
          <span>산식·입력값 확인 가능</span>
        </div>
        <div className="financial-core-grid">
          {core.map((key) => {
            const metric = getMetric(result, key)!
            const v = metricPeriod(metric)
            return (
              <div className="financial-core-item" key={key}>
                <Button
                  variant="ghost"
                  onClick={(e) => show(metric, e.currentTarget)}
                >
                  {metric.label}
                </Button>
                <strong>
                  <FinancialValue value={v} unit={metric.unit} />
                </strong>
                <span>
                  전기{' '}
                  <FinancialValue
                    value={metricPeriod(metric, 'previous')}
                    unit={metric.unit}
                  />
                </span>
                <MetricStatus metric={metric} result={result} />
              </div>
            )
          })}
        </div>
      </section>
      <section className="panel analysis-section">
        <div className="panel-heading">
          <h2>매출액·영업이익 비교기간 추세</h2>
          <span>선택한 공시의 비교금액 · 억원</span>
        </div>
        <Chart
          label="매출액·영업이익 추세. 정확한 수치와 결측 상태는 아래 원천 계정 표에서 확인할 수 있습니다."
          option={{
            color: ['#FFBC00', '#60584C'],
            tooltip: { trigger: 'axis' },
            legend: { bottom: 0 },
            grid: { left: 70, right: 70, bottom: 60 },
            xAxis: { type: 'category', data: terms.map((p) => p.label) },
            yAxis: [
              { type: 'value', name: '매출액 (억원)' },
              {
                type: 'value',
                name: '영업이익 (억원)',
                splitLine: { show: false },
              },
            ],
            series: [
              { name: '매출액', type: 'bar', data: chartData('revenue') },
              {
                name: '영업이익',
                type: 'line',
                yAxisIndex: 1,
                connectNulls: false,
                data: chartData('operating_profit'),
              },
            ],
          }}
        />
      </section>
      <section className="panel analysis-section">
        <div className="panel-heading">
          <h2>핵심 재무 비율</h2>
          <label>
            <input
              type="checkbox"
              checked={result.context.lease === 'include'}
              onChange={(e) =>
                onLease(e.target.checked ? 'include' : 'exclude')
              }
            />{' '}
            리스부채 포함
          </label>
        </div>
        <div className="filter-buttons" aria-label="재무 비율 묶음">
          {groups.map((g) => (
            <button
              key={g}
              aria-pressed={g === group}
              onClick={() =>
                setParams(
                  (p) => {
                    const next = new URLSearchParams(p)
                    next.set('ratio', g)
                    return next
                  },
                  { replace: true },
                )
              }
            >
              {g}
            </button>
          ))}
        </div>
        <MetricTable
          result={result}
          metrics={result.metrics.filter((m) => m.group === group)}
          onFormula={show}
        />
        <p className="panel-footnote">
          리스 제외는 부채비율과 정의된 총차입금에 적용합니다. 구성 금액이
          없으면 계산을 보류합니다. 임대보증금은 차입금 합계에 자동 포함하지
          않습니다.
        </p>
      </section>
      <div className="financial-layout analysis-section">
        <section className="panel">
          <div className="panel-heading">
            <h2>차입 구성·상환능력</h2>
            <span>
              억원 · 리스 {result.context.lease === 'include' ? '포함' : '제외'}
            </span>
          </div>
          <div className="table-scroll">
            <table aria-label="차입 구성">
              <thead>
                <tr>
                  <th>계정</th>
                  <th>당기</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {[
                  'short_borrowings',
                  'current_long_borrowings',
                  'long_borrowings',
                  'bonds',
                  'current_bonds',
                  'current_lease',
                  'noncurrent_lease',
                  'rental_deposits',
                ].map((key) => {
                  const f = getFact(result, key)!
                  return (
                    <tr key={key}>
                      <td>{f.label}</td>
                      <td>
                        <FinancialValue value={f} />
                      </td>
                      <td>
                        <DataStatus value={f} />
                      </td>
                    </tr>
                  )
                })}
                {noteBorrowing?.base_subtotal != null && (
                  <>
                    <tr>
                      <th scope="row">주석 차입금 소계 · 리스 제외</th>
                      <td>{money(noteBorrowing.base_subtotal)}</td>
                      <td>
                        <DataBadge
                          value={getFact(result, 'note_borrowing_subtotal')}
                        />{' '}
                        <details>
                          <summary>주석 표 검산 일치 · 근거 보기</summary>
                          {noteBorrowing.components.map((item) => (
                            <p key={item.label}>
                              {item.label}: {money(item.value)}억원
                            </p>
                          ))}
                          {noteBorrowing.reconciliation && (
                            <p>
                              검산 대상 {noteBorrowing.reconciliation.label}:{' '}
                              {money(noteBorrowing.reconciliation.value)}억원
                            </p>
                          )}
                          <p>표 위치: {noteBorrowing.source_xpath}</p>
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
                      <td>
                        {noteBorrowing.adjusted_subtotal == null ? (
                          <span className="financial-data-empty">
                            자료 없음
                          </span>
                        ) : (
                          money(noteBorrowing.adjusted_subtotal)
                        )}
                      </td>
                      <td>
                        <DataStateBadge
                          state={
                            noteBorrowing.adjusted_subtotal == null
                              ? 'MISSING'
                              : 'CONFIRMED'
                          }
                        />{' '}
                        {noteBorrowing.reason
                          ? (reasonLabels[noteBorrowing.reason] ??
                            noteBorrowing.reason)
                          : result.context.lease === 'include'
                            ? '확보한 리스부채 가산'
                            : '주석의 차입금 구성 범위'}
                      </td>
                    </tr>
                  </>
                )}
                <tr>
                  <th scope="row">정의된 총차입금</th>
                  <td>
                    {result.borrowing_totals.current == null ? (
                      <span className="financial-data-empty">자료 없음</span>
                    ) : (
                      money(result.borrowing_totals.current)
                    )}
                  </td>
                  <td>
                    <DataStateBadge
                      state={
                        result.borrowing_totals.current == null
                          ? 'MISSING'
                          : 'CONFIRMED'
                      }
                    />{' '}
                    {result.borrowing_totals.current == null
                      ? '구성 계정 미확보 · 합산 보류'
                      : '구성 계정 합산'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {noteBorrowing?.base_subtotal != null && (
            <p className="panel-footnote">
              주석 소계는 회사의 자본관리 표에 기재된 차입금 범위입니다. 같은
              표의 현금·금융자산 차감과 순부채를 공시 단위로 검산했습니다.
              미확보 사채를 0으로 처리하거나 전체 차입금으로 대체하지 않습니다.
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>상환 지표</h2>
          </div>
          <MetricTable
            result={result}
            metrics={result.metrics.filter((m) =>
              [
                'borrowing_ratio',
                'short_borrowing_ratio',
                'interest_coverage',
                'ebitda_coverage',
                'cash_coverage',
                'finance_cost_burden',
                'note_borrowing_ratio',
              ].includes(m.key),
            )}
            onFormula={show}
          />
        </section>
      </div>
      <Industry result={result} />
      <p className="notice">
        주석 보완:{' '}
        {result.note_state === 'PROCESSED'
          ? '동일 공시·회계 범위의 주석 표를 검사했습니다. 계정·기간·단위·합계가 명확한 항목만 보완에 사용합니다.'
          : result.note_state === 'FAILED'
            ? '저장된 주석을 처리하지 못했습니다. 정형 재무 결과는 유지했습니다.'
            : '아직 저장된 주석이 없습니다. 기업 검색에서 원문·주석을 수집한 뒤 다시 수집·분석하면 보완합니다.'}
      </p>
      {formula && (
        <LiveFormulaDialog
          metric={formula}
          result={result}
          onClose={() => setFormula(null)}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            opener.current?.focus()
          }}
        />
      )}
    </>
  )
}

function MetricTable({
  metrics,
  result,
  onFormula,
}: {
  metrics: FinancialMetric[]
  result: FinancialResult
  onFormula: (m: FinancialMetric, b: HTMLButtonElement) => void
}) {
  return (
    <div className="table-scroll">
      <table aria-label="핵심 재무 비율">
        <thead>
          <tr>
            <th>지표</th>
            <th>당기</th>
            <th>전기</th>
            <th>변화</th>
            <th>자료 상태</th>
            <th>근거</th>
          </tr>
        </thead>
        <tbody>
          {metrics.map((m) => (
            <tr key={m.key}>
              <td>{m.label}</td>
              <td>
                <MetricValue metric={m} result={result} />
              </td>
              <td>
                <MetricValue metric={m} result={result} period="previous" />
              </td>
              <td>
                {m.change == null ||
                (m.key.endsWith('_growth') &&
                  result.changes[m.inputs[0]]?.transition) ? (
                  <span className="financial-data-empty">비교 불가</span>
                ) : (
                  metricValue(m.change, m.change_unit)
                )}
              </td>
              <td>
                <MetricStatus metric={m} result={result} />
              </td>
              <td>
                <Button
                  variant="ghost"
                  aria-label={`${m.label} 산식 보기`}
                  onClick={(e) => onFormula(m, e.currentTarget)}
                >
                  산식 보기
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const industryKeys: Record<string, string[]> = {
  제조: [
    'ccc',
    'inventory_sales_gap',
    'receivables_sales_gap',
    'cash_profit',
    'capex_cashflow',
    'interest_coverage',
  ],
  도소매: [
    'gross_margin',
    'inventory_days',
    'payable_days',
    'ccc',
    'debt_ratio',
  ],
  건설: [
    'contract_assets_sales_gap',
    'construction_receivable_days',
    'cost_ratio',
    'pf_equity',
    'pf_within_year',
    'cash_current_liabilities',
    'borrowing_ratio',
  ],
  '부동산 임대': [
    'ebitda_coverage',
    'borrowing_investment_property',
    'debt_within_year',
    'cash_coverage',
    'average_funding_rate',
  ],
}
function Industry({ result }: { result: FinancialResult }) {
  const keys = industryKeys[result.industry ?? ''] ?? []
  return (
    <section className="panel analysis-section">
      <div className="panel-heading">
        <h2>{result.industry ?? '업종 미확정'} 강조 지표</h2>
        <StatusBadge>위험 임계값 미설정</StatusBadge>
      </div>
      {keys.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>지표</th>
                <th>당기</th>
                <th>업종 중앙값</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const m = getMetric(result, key)!
                return (
                  <tr key={key}>
                    <td>{m.label}</td>
                    <td>
                      <FinancialValue value={metricPeriod(m)} unit={m.unit} />
                    </td>
                    <td>비교 보류</td>
                    <td>
                      <MetricStatus metric={m} result={result} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="panel-footnote">
          확인된 업종 분류가 없어 강조 지표를 임의 선택하지 않았습니다.
        </p>
      )}
      <p className="panel-footnote">
        동종 중앙값은 동일 기간·회계 기준의 비교군과 최소 표본 정책이
        필요합니다. 한국은행 참고 통계는 별도 원천으로 연결할 예정이며 현재
        미확보입니다. PF 부담·차입 만기·평균 조달금리는 상세 주석 검증 후
        제공합니다.
      </p>
    </section>
  )
}

function Cashflow({ result }: { result: FinancialResult }) {
  return (
    <>
      <section className="panel analysis-section">
        <div className="panel-heading">
          <h2>영업이익 변동 분해</h2>
          <span>억원</span>
        </div>
        {result.profit_bridge ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>요인</th>
                  <th>영업이익 증감 기여</th>
                </tr>
              </thead>
              <tbody>
                {result.profit_bridge.map((item) => (
                  <tr key={item.label}>
                    <td>{item.label}</td>
                    <td>{money(item.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StatePanel
            state="pending"
            title="영업이익 분해에 필요한 계정이 부족합니다"
            description="매출·매출원가·판관비·영업이익의 당기와 전기 금액이 모두 필요합니다."
          />
        )}
        <p className="panel-footnote">
          회계상 증감 분해이며 사업상 원인을 확정하지 않습니다. 선택한 공시의
          비교기간 기준입니다.
        </p>
      </section>
      <section className="panel analysis-section">
        <div className="panel-heading">
          <h2>현금흐름·운전자본</h2>
        </div>
        <p className="panel-footnote">
          아래 공통 원천 계정 표에서 영업·투자·재무 현금흐름, 재고·채권·채무와
          계약자산·계약부채를 비교할 수 있습니다. 회전일수·현금전환주기는 산식
          정책 확정 전까지 보류합니다.
        </p>
      </section>
    </>
  )
}

function SourceFacts({ result }: { result: FinancialResult }) {
  const periods = [...result.periods].reverse()
  const current = result.facts.filter((f) => f.period === 'current')
  return (
    <section className="panel analysis-section">
      <div className="panel-heading">
        <h2>공통 원천 재무 계정</h2>
        <span>억원 · 다른 분석 화면과 공유</span>
      </div>
      <div className="table-scroll">
        <table aria-label="공통 원천 재무 계정">
          <thead>
            <tr>
              <th>계정</th>
              {periods.map((p) => (
                <th key={p.key}>{p.label}</th>
              ))}
              <th>당기 상태·추출 근거</th>
            </tr>
          </thead>
          <tbody>
            {current.map((fact) => (
              <tr key={fact.key}>
                <td>{fact.label}</td>
                {periods.map((p) => (
                  <td key={p.key}>
                    <FinancialValue value={getFact(result, fact.key, p.key)} />
                  </td>
                ))}
                <td>
                  <details>
                    <summary>
                      <DataStatus value={fact} />
                    </summary>
                    <FinancialFactEvidence sources={fact.sources} />
                    <p>매핑: {fact.mapping_method ?? '미확정'}</p>
                    {fact.sources.map((s, i) => (
                      <p key={i}>
                        {String(s.account_name ?? '')} ·{' '}
                        {String(s.statement ?? '주석')} ·{' '}
                        {String(s.account_id ?? s.source_xpath ?? '')} · 원본값{' '}
                        {String(s.raw_amount ?? '미기재')}
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
