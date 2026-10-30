import { useState } from 'react'
import type { EChartsCoreOption } from 'echarts/core'
import { Chart } from '../../shared/components/chart'
import { StatePanel } from '../../shared/components/state-panel'
import { money, metricValue, type FinancialResult } from './api'
import { FinancialValue } from './data-status'
import { displayedMetricValue } from './data-state'
import { cashCompositionData, profitBridgeOption } from './cashflow-charts'
import {
  matchingCashflowPeers,
  type CashflowPeerData,
} from './cashflow-peer-data'

const comparisons = [
  ['operating_margin', '영업이익률', '%'],
  ['debt_ratio', '부채비율', '%'],
  ['cash_profit', '영업CF ÷ 영업이익', '배'],
] as const
export function CashflowOverview({
  result,
  peers,
  demo = false,
}: {
  result: FinancialResult
  peers?: CashflowPeerData
  demo?: boolean
}) {
  const [selected, setSelected] = useState<string>('operating_margin')
  const definition = comparisons.find(([key]) => key === selected)!
  const metric = result.metrics.find((item) => item.key === selected)
  const own = metric ? displayedMetricValue(metric, result) : undefined
  const ownNumber =
    own?.value != null &&
    ['CONFIRMED', 'APPROXIMATE'].includes(own.state) &&
    Number.isFinite(Number(own.value))
      ? Number(own.value)
      : null
  const matching = matchingCashflowPeers(result, peers, demo)
  const samples =
    matching?.metrics[selected]
      ?.filter(Number.isFinite)
      .sort((a, b) => a - b) ?? []
  const enough = samples.length > 0
  const median = enough
    ? (samples[Math.floor((samples.length - 1) / 2)] +
        samples[Math.floor(samples.length / 2)]) /
      2
    : null
  const peerOption: EChartsCoreOption = {
    animation: false,
    grid: { left: 30, right: 30, top: 45, bottom: 30 },
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      formatter: (item: { seriesName: string; value: number[] }) =>
        `${item.seriesName}: ${metricValue(String(item.value[0]), definition[2])}`,
    },
    xAxis: {
      type: 'value',
      axisLabel: {
        fontSize: 10,
        color: '#92978f',
        formatter: (value: number) => `${value}${definition[2]}`,
      },
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: '#e5e5df' } },
      axisTick: { show: false },
    },
    yAxis: { type: 'value', min: -1, max: 1, show: false },
    series: [
      {
        type: 'scatter',
        name: '비교 기업',
        symbolSize: 8,
        itemStyle: { color: '#c9c4ba' },
        data: enough ? samples.map((value) => [value, 0]) : [],
      },
      {
        type: 'scatter',
        name: '자사',
        symbolSize: 12,
        itemStyle: { color: '#60584c' },
        label: {
          show: true,
          position: 'top',
          fontSize: 11,
          fontWeight: 600,
          formatter: `자사 ${metricValue(own?.value, definition[2])}${own?.state === 'APPROXIMATE' ? ' · 근사' : ''}`,
        },
        data: ownNumber == null ? [] : [[ownNumber, 0]],
        markLine:
          median == null
            ? undefined
            : {
                symbol: 'none',
                lineStyle: { color: '#9a968d', type: 'solid' },
                label: {
                  formatter: `업종 중앙값 ${metricValue(String(median), definition[2])}`,
                  fontSize: 10,
                },
                data: [{ xAxis: median }],
              },
      },
    ],
  }
  const composition = cashCompositionData(result)
  const period =
    result.periods.find((item) => item.key === 'current')?.label ?? '당기'
  return (
    <div className="fc-chart-grid fc-check-grid">
      <section className="fc-panel" aria-labelledby="fc-peer-title">
        <div className="fc-heading">
          <div>
            <h2 id="fc-peer-title">업종 비교</h2>
            <p>
              {period} · {result.context.scope} ·{' '}
              {result.industry ?? '업종 미분류'}
              {enough
                ? ` · 비교 기업 ${samples.length}곳${matching?.example ? ' · 가상 예시' : ''}`
                : ' · 비교 분포 미확보'}
            </p>
          </div>
        </div>
        <div
          className="fc-peer-tabs"
          role="tablist"
          aria-label="업종 비교 지표"
        >
          {comparisons.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`fc-peer-tab-${key}`}
              aria-selected={selected === key}
              aria-controls="fc-peer-chart"
              onClick={() => setSelected(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id="fc-peer-chart"
          aria-labelledby={`fc-peer-tab-${selected}`}
          className="fc-peer-chart"
        >
          {ownNumber != null || enough ? (
            <Chart
              option={peerOption}
              label={`${definition[1]} 업종 비교. 자사 ${metricValue(own?.value, definition[2])}. ${median == null ? '업종 분포·중앙값 비교 보류' : `비교 기업 ${samples.length}곳, 중앙값 ${metricValue(String(median), definition[2])}`}`}
            />
          ) : (
            <StatePanel
              state="pending"
              title="업종 비교 보류"
              description="자사 값과 동일 기준 비교 표본을 확인해야 합니다."
            />
          )}
        </div>
        <p className="fc-peer-source">
          {enough
            ? matching?.source
            : '동일 업종·기간·회계 범위의 비교 표본이 확보되지 않아 자사 값만 표시합니다.'}
        </p>
        <p className="fc-note">
          외부 평균은 모집단과 회계 기준 확인 후 별도로 표시합니다. 현재 외부
          평균 자료는 미확보입니다. 자사 값이 미확보이면 임의의 위치를 표시하지
          않습니다.
        </p>
      </section>
      <section className="fc-panel" aria-labelledby="fc-composition-title">
        <div className="fc-heading">
          <div>
            <h2 id="fc-composition-title">현금흐름 구성</h2>
            <p>
              기초현금 → 활동별 현금흐름 → 기말현금 · {period} ·{' '}
              {result.context.scope} · 억원
            </p>
          </div>
        </div>
        {composition.points.length ? (
          <div className="fc-composition-chart">
            <Chart
              option={profitBridgeOption(composition.points, true)}
              label={`현금흐름 구성 워터폴. ${composition.points.map((point) => `${point.label.replace('\n', ' ')} ${money(point.value)}억원`).join(', ')}`}
            />
          </div>
        ) : (
          <StatePanel
            state="pending"
            title="현금흐름 구성 차트 보류"
            description={composition.reason ?? '현금 계정을 확인해 주세요.'}
          />
        )}
        <p className="fc-note">
          {composition.adjustment != null &&
          Number(composition.adjustment) !== 0
            ? `세 활동 합계와 잔액 사이에 ${money(composition.adjustment)}억원의 차이가 있어 별도 조정으로 표시합니다. 원문에서 환율·현금 범위 등을 확인하세요.`
            : '영업·투자·재무활동이 현금 잔액을 어떻게 바꾸었는지 함께 확인합니다. 재무활동 전체를 차입 유입으로 단정하지 않습니다.'}
        </p>
        <details className="fc-data">
          <summary>현금 구성 금액·자료 상태 보기</summary>
          <table aria-label="현금흐름 구성 금액">
            <thead>
              <tr>
                <th>항목</th>
                <th>금액 · 억원</th>
              </tr>
            </thead>
            <tbody>
              {composition.rows.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <FinancialValue value={row.fact} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            기초·기말은 같은 현금흐름표의 당기 잔액입니다. 이전 분석에서 이
            계정이 수집되지 않았다면 재수집·분석이 필요합니다.
          </p>
        </details>
      </section>
    </div>
  )
}
