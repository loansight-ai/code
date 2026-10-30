import { useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { Chart } from '../../shared/components/chart'
import { LiveFormulaDialog } from './live-formula-dialog'
import {
  DataBadge,
  DataStatus,
  FinancialValue,
  MetricValue,
  MetricStatus,
} from './data-status'
import { dataState, displayedMetricValue } from './data-state'
import {
  money,
  metricValue,
  type FinancialMetric,
  type FinancialResult,
} from './api'
import { IndustryHighlights, RepaymentHighlights } from './financial-highlights'
import './visual-summary.css'
import {
  IndustryPositionPanel,
  type IndustryBenchmark,
} from './industry-position-panel'

const core = [
  'current_ratio',
  'debt_ratio',
  'operating_margin',
  'operating_roa',
  'interest_coverage',
]
type IndustrySpec = {
  description: string
  caution: string
  items: [string, string][]
}
const industrySpecs: Record<string, IndustrySpec> = {
  제조: {
    description:
      '재고 → 제품 → 매출채권. 운전자본의 회수와 설비투자 부담을 함께 봅니다.',
    caution:
      '감가상각이 큰 기업은 영업이익만으로 상환능력을 해석하지 않습니다.',
    items: [
      ['inventory_days', '재고자산 회전일수'],
      ['receivable_days', '매출채권 회수일수'],
      ['cost_ratio', '매출원가율'],
      ['operating_margin', '매출액영업이익률'],
      ['long_term_asset_fit', '비유동장기적합률'],
      ['interest_coverage', '이자보상비율'],
      ['ccc', '현금전환주기'],
      ['cash_profit', '영업CF/영업이익'],
      ['capex_cashflow', 'CAPEX/영업CF'],
      ['development_capitalisation', '개발비 자산화 비중'],
    ],
  },
  도소매: {
    description:
      '상품 재고와 매입·매출채무의 순환, 매출총이익과 점포 리스 부담을 봅니다.',
    caution:
      '소매는 현금전환주기가 음수일 수 있습니다. 낮은 유동비율을 위험으로 단정하지 않습니다.',
    items: [
      ['inventory_days', '재고자산 회전일수'],
      ['receivable_days', '매출채권 회수일수'],
      ['gross_margin', '매출총이익률'],
      ['operating_margin', '매출액영업이익률'],
      ['asset_turnover', '총자산회전율'],
      ['ccc', '현금전환주기'],
      ['payable_days', '매입채무 지급일수'],
      ['debt_ratio', '부채비율 · 리스 옵션 적용'],
    ],
  },
  건설: {
    description:
      '계약자산·공사미수금에 묶인 현금과 PF·만기 부담을 함께 확인합니다.',
    caution:
      '분양 선수금은 부채비율을 높일 수 있습니다. PF 약정·수주잔고는 주석 확인이 필요합니다.',
    items: [
      ['construction_receivable_days', '공사미수금 회수기간'],
      ['cost_ratio', '공사원가율'],
      ['interest_coverage', '이자보상비율'],
      ['cash_current_liabilities', '영업CF/유동부채'],
      ['contract_assets_sales_gap', '계약자산 증가율 − 매출 증가율'],
      ['debt_excluding_advances', '선수금 제외 부채비율'],
      ['borrowing_ratio', '차입금의존도'],
      ['short_borrowing_ratio', '단기차입금 비중'],
      ['order_backlog', '수주잔고'],
      ['pf_equity', 'PF·조건부 의무/자본'],
    ],
  },
  '부동산 임대': {
    description:
      '투자부동산과 차입 구조, 이자 지급 여력과 차환 부담을 우선 확인합니다.',
    caution:
      '임대수익의 계상 위치와 평가모형을 확인합니다. 영업이익·유동비율·부채비율은 해석에 주의합니다.',
    items: [
      ['ebitda_coverage', 'EBITDA 이자보상비율'],
      ['cash_coverage', '현금보상비율'],
      ['short_borrowing_ratio', '단기차입금 비중'],
      ['borrowing_investment_property', '총차입금/투자부동산'],
      ['debt_within_year', '1년 내 만기 차입 비중'],
      ['average_funding_rate', '평균 조달금리'],
    ],
  },
}
function fact(result: FinancialResult, key: string, period = 'current') {
  return result.facts.find((f) => f.key === key && f.period === period)
}
function numberValue(
  value: { value: string | null; state: string } | undefined,
) {
  if (
    !value ||
    !['CONFIRMED', 'APPROXIMATE'].includes(value.state) ||
    value.value == null
  )
    return null
  const n = Number(value.value)
  return Number.isFinite(n) ? n : null
}
function signed(value: string | null | undefined, unit: string) {
  return value == null
    ? '비교 보류'
    : `${Number(value) > 0 ? '+' : ''}${metricValue(value, unit)}`
}

// Each metric uses its own zero-based scale; these are period comparisons, not risk thresholds.
function PeriodBars({
  metric,
  result,
}: {
  metric: FinancialMetric
  result: FinancialResult
}) {
  const current = numberValue(displayedMetricValue(metric, result))
  const previous = numberValue(displayedMetricValue(metric, result, 'previous'))
  const scale = Math.max(Math.abs(current ?? 0), Math.abs(previous ?? 0), 1)
  return (
    <div
      className="vs-period-bars"
      aria-label={`${metric.label} 전기·당기 비교`}
    >
      {(
        [
          ['전기', previous],
          ['당기', current],
        ] as const
      ).map(([label, value]) => (
        <div className="vs-period-row" key={label}>
          <span>{label}</span>
          <div className="vs-bar-track">
            <i className="vs-zero" />
            {value != null && (
              <i
                className={`vs-period-bar ${label === '당기' ? 'vs-current' : ''}`}
                style={{
                  left: `${value < 0 ? 50 - (Math.abs(value) / scale) * 50 : 50}%`,
                  width: `${(Math.abs(value) / scale) * 50}%`,
                }}
              />
            )}
          </div>
          <span>
            {value == null ? '—' : metricValue(String(value), metric.unit)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function VisualFinancialSummary({
  result,
  onLease,
  demo = false,
  benchmark,
}: {
  result: FinancialResult
  onLease?: (lease: 'include' | 'exclude') => void
  demo?: boolean
  benchmark?: IndustryBenchmark
}) {
  const [formula, setFormula] = useState<FinancialMetric | null>(null)
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null)
  const periods = [...result.periods].reverse()
  const profit = fact(result, 'operating_profit')
  const cash = fact(result, 'operating_cashflow')
  const profitChange = result.changes.operating_profit
  const margin = result.metrics.find((m) => m.key === 'operating_margin')
  const currentMargin = margin
    ? displayedMetricValue(margin, result)
    : undefined
  const previousMargin = margin
    ? displayedMetricValue(margin, result, 'previous')
    : undefined
  const changeClass = (value: string | null | undefined) =>
    value == null || Number(value) === 0
      ? ''
      : Number(value) > 0
        ? 'vs-change-up'
        : 'vs-change-down'
  const changeArrow = (value: string | null | undefined) =>
    value == null || Number(value) === 0 ? '' : Number(value) > 0 ? '▲ ' : '▼ '
  const industry = industrySpecs[result.industry ?? '']
  function show(metric: FinancialMetric, button: HTMLButtonElement) {
    setOpener(button)
    setFormula(metric)
  }
  const heroChart: EChartsCoreOption = {
    animation: false,
    tooltip: { trigger: 'axis' },
    title: [
      {
        text: '영업이익률',
        subtext: '(%)',
        left: 0,
        top: 6,
        textStyle: { fontSize: 11, color: '#60584c', fontWeight: 500 },
        subtextStyle: { fontSize: 10, color: '#888278' },
        itemGap: 0,
      },
      {
        text: '영업이익',
        left: 0,
        top: 112,
        textStyle: { fontSize: 11, color: '#60584c', fontWeight: 500 },
      },
    ],
    grid: [
      { left: 70, right: 45, top: 30, height: 64 },
      { left: 70, right: 22, top: 145, bottom: 34 },
    ],
    xAxis: [
      {
        type: 'category',
        data: periods.map((p) => p.label),
        gridIndex: 0,
        show: false,
        boundaryGap: true,
      },
      {
        type: 'category',
        gridIndex: 1,
        data: periods.map((p) => p.label.replace(/ 예시$/, '')),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#bdb7ad' } },
        axisLabel: {
          color: '#847d71',
          interval: 0,
          fontSize: 10,
          formatter: (value: string, index: number) =>
            index === periods.length - 1 ? `{current|${value}}` : value,
          rich: {
            current: { fontWeight: 700, color: '#15181d', fontSize: 10 },
          },
        },
      },
    ],
    yAxis: [
      {
        type: 'value',
        gridIndex: 0,
        show: false,
        scale: true,
        min: (range: { min: number; max: number }) =>
          range.min - Math.max((range.max - range.min) * 0.35, 0.1),
        max: (range: { min: number; max: number }) =>
          range.max + Math.max((range.max - range.min) * 0.35, 0.1),
      },
      {
        type: 'value',
        gridIndex: 1,
        splitNumber: 2,
        axisLabel: {
          color: '#8a8378',
          fontSize: 10,
          formatter: (value: number) => value.toLocaleString('ko-KR'),
        },
        splitLine: { lineStyle: { color: '#f0efec' } },
      },
    ],
    series: [
      {
        name: '영업이익',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        barMaxWidth: 42,
        label: {
          show: true,
          position: 'top',
          fontSize: 11,
          fontWeight: 700,
          color: '#15181d',
          formatter: (p: { value: unknown }) =>
            Number(p.value).toLocaleString('ko-KR', {
              maximumFractionDigits: 1,
            }),
        },
        data: periods.map((p) => {
          const v = numberValue(fact(result, 'operating_profit', p.key))
          return {
            value: v == null ? null : v / 1e8,
            itemStyle: {
              color:
                v != null && v < 0
                  ? '#b42318'
                  : p.key === 'current'
                    ? '#60584c'
                    : '#d0cbc2',
              borderRadius: [2, 2, 0, 0],
            },
          }
        }),
      },
      {
        name: '영업이익률',
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 7,
        showSymbol: true,
        showAllSymbol: true,
        lineStyle: { color: '#202326', width: 2 },
        itemStyle: { color: '#fff', borderColor: '#202326', borderWidth: 2 },
        label: {
          show: true,
          position: 'top',
          distance: 9,
          color: '#253b4b',
          fontSize: 11,
          fontWeight: 600,
          formatter: (p: { value: unknown }) =>
            `${Number(p.value).toFixed(1)}%`,
        },
        data: periods.map((p) => {
          const value = margin
            ? numberValue(displayedMetricValue(margin, result, p.key))
            : null
          return {
            value,
            itemStyle: { color: p.key === 'current' ? '#202326' : '#fff' },
          }
        }),
      },
    ],
  }
  return (
    <div className="vs-summary">
      <div className="vs-hero-grid">
        <section
          className="vs-panel vs-profit"
          aria-labelledby="vs-profit-title"
        >
          <div className="vs-profit-heading">
            <h2 id="vs-profit-title">영업이익</h2>
            <span className="vs-profit-basis">
              {result.context.scope === 'OFS' ? '별도(OFS)' : '연결(CFS)'} ·
              억원
            </span>
            {(demo || dataState(profit) === 'APPROXIMATE') && (
              <span className="vs-profit-estimate">
                추정 포함{!demo && profit?.reason ? ` · ${profit.reason}` : ''}
              </span>
            )}
          </div>
          <div className="vs-profit-copy">
            <div className="vs-hero-number">
              <FinancialValue value={profit} />
              {numberValue(profit) != null && <small>억원</small>}
            </div>
            <div className="vs-profit-deltas">
              <span>전기 대비 영업이익</span>
              <b className={changeClass(profitChange?.amount)}>
                {changeArrow(profitChange?.amount)}
                {profitChange?.amount == null
                  ? '비교 보류'
                  : `${Number(profitChange.amount) > 0 ? '+' : ''}${money(profitChange.amount)}억원`}
                {profitChange?.growth != null &&
                  !profitChange.transition &&
                  ` (${signed(profitChange.growth, '%')})`}
                {profitChange?.transition &&
                  ` · ${profitChange.transition === 'NEGATIVE_TURN' ? '적자 전환' : '흑자 전환'}`}
              </b>
              <span>영업이익률</span>
              <b className={changeClass(margin?.change)}>
                {changeArrow(margin?.change)}
                {signed(margin?.change, '%p')}
                {numberValue(previousMargin) != null &&
                  numberValue(currentMargin) != null &&
                  ` (${metricValue(previousMargin?.value, '%')} → ${metricValue(currentMargin?.value, '%')})`}
              </b>
            </div>
            <p className="vs-change-legend">
              증가 <b className="vs-change-up">▲ 초록</b> · 감소{' '}
              <b className="vs-change-down">▼ 빨강</b>
            </p>
            {dataState(profit) !== 'CONFIRMED' && <DataStatus value={profit} />}
          </div>
          <div className="vs-hero-chart">
            <Chart
              option={heroChart}
              label="위쪽은 비교기간별 영업이익률 선, 아래쪽은 영업이익 막대입니다. 정확한 값은 비교금액 표에서 확인할 수 있습니다."
            />
          </div>
          <div className="vs-profit-note">
            {demo
              ? '진행률 기준 이익이라 추정 원가에 의존합니다. '
              : result.industry === '건설'
                ? '진행률 기준 수익 여부와 추정 원가를 주석에서 확인하세요. '
                : ''}
            {numberValue(profit) != null && numberValue(cash) != null ? (
              <>
                같은 기간 영업활동현금흐름({money(cash?.value)}억원)과 함께
                봅니다.
              </>
            ) : (
              '영업이익과 영업현금을 함께 해석하려면 누락된 원천 계정을 확인해야 합니다.'
            )}
          </div>
          <details className="vs-chart-data">
            <summary>비교금액 표 보기</summary>
            <DataStatus value={profit} />
            <div className="vs-table-scroll">
              <table className="vs-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    {periods.map((p) => (
                      <th key={p.key}>{p.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {['operating_profit', 'revenue', 'operating_cashflow'].map(
                    (key) => (
                      <tr key={key}>
                        <th>{fact(result, key)?.label ?? key}</th>
                        {periods.map((p) => (
                          <td key={p.key}>
                            <FinancialValue value={fact(result, key, p.key)} />
                          </td>
                        ))}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </section>
        <div className="vs-support">
          {[
            ['revenue', '매출액'],
            ['operating_cashflow', '영업활동현금흐름'],
            ['depreciation', '감가상각비'],
          ].map(([key, label]) => (
            <section className="vs-panel" key={key}>
              <h3>{label}</h3>
              <strong
                className={
                  numberValue(fact(result, key)) != null &&
                  Number(fact(result, key)?.value) < 0
                    ? 'vs-negative'
                    : ''
                }
              >
                <FinancialValue value={fact(result, key)} />
                {numberValue(fact(result, key)) != null && <small>억원</small>}
              </strong>
              <span className="vs-muted">
                전기 <FinancialValue value={fact(result, key, 'previous')} />
                {numberValue(fact(result, key, 'previous')) != null && '억원'}
              </span>
              <DataBadge value={fact(result, key)} />
            </section>
          ))}
        </div>
      </div>
      <section className="vs-panel" aria-labelledby="vs-core-title">
        <div className="vs-heading">
          <div>
            <span className="vs-eyebrow">02 / 한눈에 보는 비율</span>
            <h2 id="vs-core-title">공통 핵심 5개 비율</h2>
          </div>
          <span className="vs-muted">
            회색 전기 · 파랑 당기 · 막대 중앙은 0
          </span>
        </div>
        <div className="vs-core-grid">
          {core.map((key) => {
            const metric = result.metrics.find((m) => m.key === key)
            if (!metric)
              return (
                <div className="vs-core-card" key={key}>
                  지표 미확보
                </div>
              )
            const value = displayedMetricValue(metric, result)
            return (
              <article className="vs-core-card" key={key}>
                <button
                  className="vs-text-button"
                  aria-label={metric.label}
                  onClick={(e) => show(metric, e.currentTarget)}
                >
                  {metric.label} ↗
                </button>
                <strong>
                  <MetricValue metric={metric} result={result} />
                </strong>
                <span className="vs-delta">
                  {signed(
                    numberValue(value) != null ? metric.change : null,
                    metric.change_unit,
                  )}
                </span>
                <PeriodBars metric={metric} result={result} />
                {dataState(value) === 'MISSING' ? (
                  <MetricStatus metric={metric} result={result} />
                ) : (
                  <DataBadge value={value} />
                )}
              </article>
            )
          })}
        </div>
        <p className="vs-footnote">
          막대는 지표별 전기·당기의 크기를 비교합니다. 위험 등급과 업종 기준선은
          검증된 기준 확보 후 표시합니다.
          {result.industry === '부동산 임대' &&
            ' 임대업은 아래 EBITDA·현금보상 지표를 우선 확인하세요.'}
        </p>
      </section>
      <IndustryPositionPanel
        result={result}
        benchmark={benchmark}
        onFormula={show}
      />
      <IndustryHighlights
        result={result}
        industry={industry}
        demo={demo}
        onFormula={show}
      />
      <RepaymentHighlights
        result={result}
        demo={demo}
        onLease={onLease}
        onFormula={show}
      />
      {formula && (
        <LiveFormulaDialog
          metric={formula}
          result={result}
          onClose={() => setFormula(null)}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            opener?.focus()
          }}
        />
      )}
    </div>
  )
}
