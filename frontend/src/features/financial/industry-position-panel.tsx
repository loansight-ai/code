import { useState } from 'react'
import { Chart } from '../../shared/components/chart'
import { metricValue, type FinancialMetric, type FinancialResult } from './api'
import { MetricValue } from './data-status'

export type IndustryBenchmark = {
  industry: string
  scope: 'OFS' | 'CFS'
  period: string
  sampleCount: number
  example: boolean
  domains: {
    label: string
    percentile: number | null
    metrics: {
      key: string
      label: string
      value: string | null
      unit: string
      percentile: number | null
      reason?: string
    }[]
  }[]
}
const domainKeys = [
  {
    label: '수익성',
    keys: [
      'operating_margin',
      'operating_roa',
      'gross_margin',
      'cost_ratio',
      'interest_coverage',
    ],
  },
  {
    label: '안정성',
    keys: [
      'debt_ratio',
      'debt_excluding_advances',
      'borrowing_ratio',
      'long_term_asset_fit',
      'equity_ratio',
    ],
  },
  {
    label: '활동성',
    keys: ['inventory_days', 'receivable_days', 'payable_days', 'ccc'],
  },
  {
    label: '성장성',
    keys: [
      'revenue_growth',
      'inventory_sales_gap',
      'contract_assets_sales_gap',
    ],
  },
  {
    label: '현금흐름',
    keys: [
      'cash_profit',
      'cash_current_liabilities',
      'capex_cashflow',
      'cash_coverage',
      'ebitda_coverage',
    ],
  },
]
const percentile = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null
const missingLabels: Record<string, string> = {
  debt_excluding_advances: '선수금 제외 부채비율',
  long_term_asset_fit: '비유동장기적합률',
}
function positionLabel(value: number) {
  return value === 50
    ? '중앙값'
    : value < 50
      ? `하위 ${value}%`
      : `상위 ${Number((100 - value).toFixed(1))}%`
}

export function IndustryPositionPanel({
  result,
  benchmark,
  onFormula,
}: {
  result: FinancialResult
  benchmark?: IndustryBenchmark
  onFormula: (metric: FinancialMetric, button: HTMLButtonElement) => void
}) {
  const [active, setActive] = useState(1)
  // Never mix benchmarks from another industry, period or accounting scope.
  const comparison =
    benchmark?.industry === result.industry &&
    benchmark.scope === result.context.scope &&
    benchmark.period === result.context.period &&
    benchmark.sampleCount > 0 &&
    Number.isInteger(benchmark.sampleCount)
      ? benchmark
      : undefined
  const domains = domainKeys.map((definition) => ({
    ...definition,
    comparison: comparison?.domains.find((d) => d.label === definition.label),
  }))
  const current = domains[active]
  const rows =
    current.comparison?.metrics ??
    current.keys.map((key) => {
      const metric = result.metrics.find((m) => m.key === key)
      return {
        key,
        label: metric?.label ?? missingLabels[key] ?? key,
        value: null,
        unit: metric?.unit ?? '%',
        percentile: null,
        reason: metric ? '동종 비교 데이터 미확보' : '산식·원천 자료 연결 필요',
      }
    })
  // ECharts places radar indicators counterclockwise; reverse to match the tab order clockwise.
  const radarOrder = [0, 4, 3, 2, 1]
  const scores = radarOrder.map((index) =>
    percentile(domains[index].comparison?.percentile),
  )
  const radarReady = !!comparison && scores.every((score) => score != null)
  const selectTab = (index: number) => {
    setActive(index)
    document.getElementById(`vs-tab-${index}`)?.focus()
  }
  return (
    <section
      className="vs-panel vs-position-panel"
      aria-labelledby="vs-domains-title"
    >
      <div className="vs-heading">
        <div>
          <h2 id="vs-domains-title">5개 영역 지표</h2>
          <p className="vs-muted">
            탭을 누르기 전에 어느 축이 약했는지 먼저 보고, 탭 안에서 지표별 업종
            백분위를 봅니다.
          </p>
        </div>
        <span className="vs-pill">
          {comparison?.example
            ? '업종 분포 예시'
            : comparison
              ? '업종 내 백분위'
              : '업종 비교 보류'}
        </span>
      </div>
      <div role="tablist" aria-label="재무 지표 영역" className="vs-tabs">
        {domains.map((domain, index) => (
          <button
            key={domain.label}
            id={`vs-tab-${index}`}
            role="tab"
            aria-selected={active === index}
            aria-controls="vs-domain-panel"
            tabIndex={active === index ? 0 : -1}
            onClick={() => setActive(index)}
            onKeyDown={(event) => {
              let next: number | undefined
              if (event.key === 'ArrowRight')
                next = (index + 1) % domains.length
              if (event.key === 'ArrowLeft')
                next = (index + domains.length - 1) % domains.length
              if (event.key === 'Home') next = 0
              if (event.key === 'End') next = domains.length - 1
              if (next != null) {
                event.preventDefault()
                selectTab(next)
              }
            }}
          >
            {domain.label}
            <small>
              {domain.comparison?.metrics.length ?? domain.keys.length}
            </small>
          </button>
        ))}
      </div>
      <div className="vs-position-layout">
        <div className="vs-radar-column">
          <h3>5축 균형</h3>
          <p className="vs-muted">
            탭 5개와 1:1 · 클릭 시 해당 축 강조 · 업종 내 백분위
          </p>
          <div className="vs-radar-chart">
            <Chart
              label={
                radarReady
                  ? `5축 업종 백분위. ${domains.map((d) => `${d.label} ${d.comparison?.percentile}%`).join(', ')}. 영역 이름을 누르면 해당 탭으로 이동합니다.`
                  : '5축 업종 백분위 비교 보류. 비교군과 영역별 집계 기준이 필요합니다.'
              }
              onClick={(event) => {
                const index = domains.findIndex((d) =>
                  event.name?.includes(d.label),
                )
                if (index >= 0) selectTab(index)
              }}
              option={{
                animation: false,
                tooltip: { trigger: 'item' },
                radar: {
                  center: ['50%', '49%'],
                  radius: '60%',
                  startAngle: 90,
                  splitNumber: 2,
                  triggerEvent: true,
                  indicator: radarOrder.map((index) => ({
                    name: domains[index].label,
                    max: 100,
                    min: 0,
                  })),
                  axisName: {
                    color: '#51585c',
                    fontSize: 11,
                    formatter: (name: string) =>
                      name === current.label ? `{active|${name}}` : name,
                    rich: {
                      active: {
                        backgroundColor: '#ffbc00',
                        color: '#292b28',
                        padding: [4, 9],
                        borderRadius: 10,
                        fontWeight: 700,
                        fontSize: 11,
                      },
                    },
                  },
                  splitArea: { areaStyle: { color: ['#fafaf8', '#f6f6f2'] } },
                  splitLine: { lineStyle: { color: '#e7e7e1' } },
                  axisLine: { lineStyle: { color: '#dedfd8' } },
                },
                series: [
                  {
                    type: 'radar',
                    silent: false,
                    symbolSize: 6,
                    data: radarReady
                      ? [
                          {
                            name: '우리 회사',
                            value: scores,
                            symbol: 'circle',
                            lineStyle: { color: '#365e80', width: 2 },
                            itemStyle: { color: '#365e80' },
                            areaStyle: { color: '#365e80', opacity: 0.2 },
                          },
                          {
                            name: '동종 업종 중앙값',
                            value: [50, 50, 50, 50, 50],
                            symbol: 'none',
                            lineStyle: {
                              color: '#a99f8a',
                              type: 'dashed',
                              width: 1.5,
                            },
                            areaStyle: { opacity: 0 },
                          },
                        ]
                      : [],
                  },
                ],
              }}
            />
            {!radarReady && <span className="vs-radar-hold">비교 보류</span>}
          </div>
          <div className="vs-position-legend">
            <span>
              <i />
              우리 회사
            </span>
            <span>
              <i className="vs-median-key" />
              동종 업종 중앙값
            </span>
          </div>
        </div>
        <div
          role="tabpanel"
          id="vs-domain-panel"
          aria-labelledby={`vs-tab-${active}`}
          className="vs-position-column"
        >
          <h3>업종 위치 · {current.label}</h3>
          <p className="vs-muted">
            낮을수록 취약 · 점선 = 업종 중앙값
            {comparison
              ? ` · ${comparison.industry} 동종 ${comparison.sampleCount}곳${comparison.example ? ' · 예시' : ''}`
              : ' · 동일 기간·회계 범위 비교군 미확보'}
          </p>
          <div className="vs-position-rows">
            {rows.map((row) => {
              const position = percentile(row.percentile)
              const metric = result.metrics.find((m) => m.key === row.key)
              return (
                <div className="vs-position-row" key={row.key}>
                  <div className="vs-position-label">
                    {metric ? (
                      <button
                        className="vs-text-button"
                        onClick={(e) => onFormula(metric, e.currentTarget)}
                        aria-label={`${row.label} 산식 보기`}
                      >
                        {row.label}
                        {
                          <>
                            {' '}
                            <MetricValue metric={metric} result={result} />
                          </>
                        }
                      </button>
                    ) : (
                      <span>
                        {row.label}
                        {row.value != null &&
                          ` ${metricValue(row.value, row.unit)}`}
                      </span>
                    )}
                  </div>
                  <div
                    className={`vs-position-track ${position == null ? 'vs-position-missing' : ''}`}
                    role="img"
                    aria-label={`${row.label}: ${position == null ? `비교 보류 · ${row.reason ?? '비교 데이터 미확보'}` : `${position}% 위치, ${positionLabel(position)}`}`}
                  >
                    <span className="vs-position-median" />
                    {position != null && (
                      <>
                        <span
                          className={`vs-position-fill ${position < 50 ? 'vs-position-low' : 'vs-position-high'}`}
                          style={{ width: `${position}%` }}
                        />
                        <span
                          className={`vs-position-dot ${position < 50 ? 'vs-position-low' : 'vs-position-high'}`}
                          style={{ left: `${position}%` }}
                        />
                      </>
                    )}
                  </div>
                  <strong
                    className={
                      position == null
                        ? 'vs-position-unavailable'
                        : position < 50
                          ? 'vs-change-down'
                          : 'vs-change-up'
                    }
                  >
                    {position == null ? '비교 보류' : positionLabel(position)}
                  </strong>
                  {position == null && (
                    <span className="vs-position-reason">
                      {row.reason ?? '비교 데이터 미확보'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div className="vs-position-axis" aria-hidden="true">
            <div>
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
          <p className="vs-footnote">
            {comparison?.example
              ? '가상 분포 예시입니다. 각 지표의 유불리 방향을 맞춰 낮을수록 취약하게 표현했습니다. 영역별 집계값도 화면 예시이며 실제 평가 점수가 아닙니다.'
              : '동일 업종·기간·회계 범위의 분포와 지표별 유불리 방향, 표본 정책이 검증되면 백분위를 표시합니다. 영역별 집계 기준이 없는 값은 임의 평균하지 않습니다.'}
          </p>
        </div>
      </div>
      <p className="vs-position-caption">
        축 순서는 탭 순서와 같습니다(수익성 → 안정성 → 활동성 → 성장성 →
        현금흐름). 탭을 누르면 해당 축이 강조되고 오른쪽 목록이 해당 영역 지표로
        바뀝니다.
      </p>
    </section>
  )
}
