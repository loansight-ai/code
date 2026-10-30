import type { CustomSeriesOption } from 'echarts/charts'
import type { EChartsCoreOption } from 'echarts/core'
import type { FinancialResult } from './api'
import { scaledFontSize } from '../../shared/typography'

const SCALE = 1_000_000n
const WON_PER_EOK_SCALED = 100_000_000_000_000
export type BridgePoint = {
  label: string
  value: string
  from: number
  to: number
  total: boolean
  residual: boolean
}
export function financialFact(
  result: FinancialResult,
  key: string,
  period = 'current',
) {
  return result.facts.find((fact) => fact.key === key && fact.period === period)
}
export function financialNumber(fact: ReturnType<typeof financialFact>) {
  if (
    !fact ||
    !['CONFIRMED', 'APPROXIMATE'].includes(fact.state) ||
    fact.value == null
  )
    return null
  const number = Number(fact.value)
  return Number.isFinite(number) ? number : null
}
function scaledAmount(value: string | null | undefined): bigint | null {
  if (value == null || !/^-?\d+(?:\.\d{1,6})?$/.test(value)) return null
  const [integer, fraction = ''] = value.replace(/^-/, '').split('.')
  const absolute = BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, '0'))
  return value.startsWith('-') ? -absolute : absolute
}

export function profitBridgeData(result: FinancialResult): {
  points: BridgePoint[]
  reason: string | null
} {
  const before = financialFact(result, 'operating_profit', 'previous')
  const after = financialFact(result, 'operating_profit')
  const start =
    financialNumber(before) == null ? null : scaledAmount(before?.value)
  const end = financialNumber(after) == null ? null : scaledAmount(after?.value)
  const changes = result.profit_bridge?.map((step) => ({
    ...step,
    scaled: scaledAmount(step.value),
  }))
  if (
    start == null ||
    end == null ||
    !changes?.length ||
    changes.some((step) => step.scaled == null)
  )
    return {
      points: [],
      reason: '영업이익과 매출·원가·판관비의 비교 금액이 부족합니다.',
    }
  if (start + changes.reduce((sum, step) => sum + step.scaled!, 0n) !== end)
    return {
      points: [],
      reason:
        '영업이익 분해 합계가 당기 금액과 일치하지 않아 차트를 보류합니다.',
    }
  const toChart = (amount: bigint) => Number(amount) / WON_PER_EOK_SCALED
  const points: BridgePoint[] = [
    {
      label: '전기\n영업이익',
      value: before!.value!,
      from: 0,
      to: toChart(start),
      total: true,
      residual: false,
    },
  ]
  let cursor = start
  for (const step of changes) {
    const next = cursor + step.scaled!
    points.push({
      label: step.label,
      value: step.value,
      from: toChart(cursor),
      to: toChart(next),
      total: false,
      residual: /잔차|조정/.test(step.label),
    })
    cursor = next
  }
  points.push({
    label: '당기\n영업이익',
    value: after!.value!,
    from: 0,
    to: toChart(end),
    total: true,
    residual: false,
  })
  return { points, reason: null }
}
function chartNumber(number: number) {
  return number.toLocaleString('ko-KR', { maximumFractionDigits: 1 })
}
export function profitBridgeOption(points: BridgePoint[]): EChartsCoreOption {
  const renderItem: NonNullable<CustomSeriesOption['renderItem']> = (
    params,
    api,
  ) => {
    const point = points[params.dataIndex]
    const from = api.coord([params.dataIndex, point.from]) as number[]
    const to = api.coord([params.dataIndex, point.to]) as number[]
    const size = api.size?.([1, 0]) as number[] | undefined
    const width = Math.min(54, (size?.[0] ?? 60) * 0.64)
    const next = api.coord([params.dataIndex + 1, point.to]) as number[]
    const increasing = Number(point.value) >= 0
    const color = point.total ? '#60584c' : increasing ? '#d2cdc4' : '#e9a59e'
    const amount = Number(point.value) / 1e8
    return {
      type: 'group',
      children: [
        ...(params.dataIndex < points.length - 1
          ? [
              {
                type: 'line' as const,
                shape: {
                  x1: to[0] + width / 2,
                  y1: to[1],
                  x2: next[0] - width / 2,
                  y2: to[1],
                },
                style: { stroke: '#b8b5ae', lineDash: [3, 3], lineWidth: 1 },
              },
            ]
          : []),
        {
          type: 'rect',
          shape: {
            x: from[0] - width / 2,
            y: Math.min(from[1], to[1]),
            width,
            height: Math.max(1, Math.abs(from[1] - to[1])),
            r: 2,
          },
          style: {
            fill: color,
            stroke: point.residual ? '#ca8b83' : color,
            lineDash: point.residual ? [3, 2] : undefined,
            lineWidth: 1,
          },
        },
        {
          type: 'text',
          style: {
            x: from[0],
            y:
              point.total || increasing
                ? Math.min(from[1], to[1]) - 10
                : Math.max(from[1], to[1]) + 14,
            text: `${!point.total && amount > 0 ? '+' : ''}${chartNumber(amount)}`,
            align: 'center',
            verticalAlign: 'middle',
            fontSize: scaledFontSize(11),
            fontWeight: 600,
            fill: !point.total && !increasing ? '#bf3026' : '#262b2c',
          },
        },
      ],
    }
  }
  return {
    animation: false,
    tooltip: {
      trigger: 'item',
      renderMode: 'richText',
      formatter: (params: { dataIndex: number }) => {
        const point = points[params.dataIndex]
        return `${point.label.replace('\n', ' ')}: ${chartNumber(Number(point.value) / 1e8)}억원`
      },
    },
    grid: { left: 64, right: 22, top: 35, bottom: 64 },
    xAxis: {
      type: 'category',
      data: points.map((point) =>
        point.label
          .replace('매출 증감', '매출\n증감')
          .replace('매출원가 증감', '매출원가\n증감')
          .replace('판관비 증감', '판관비\n증감')
          .replace('기타·조정 잔차', '기타\n조정'),
      ),
      axisLabel: {
        interval: 0,
        fontSize: 10,
        color: '#797a71',
        lineHeight: 15,
      },
      axisLine: { lineStyle: { color: '#c4beb3' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      boundaryGap: ['0%', '20%'],
      axisLabel: {
        fontSize: 10,
        color: '#98978c',
        formatter: (value: number) => value.toLocaleString('ko-KR'),
      },
      splitLine: { lineStyle: { color: '#efefeb' } },
    },
    series: [
      {
        type: 'custom',
        renderItem,
        dimensions: ['step', 'from', 'to'],
        encode: { x: 0, y: [1, 2] },
        data: points.map((point, index) => [index, point.from, point.to]),
      },
    ],
  }
}

export function profitCashflowOption(
  result: FinancialResult,
): EChartsCoreOption {
  const periods = [...result.periods].reverse()
  return {
    animation: false,
    tooltip: { trigger: 'axis', renderMode: 'richText' },
    grid: { left: 64, right: 22, top: 36, bottom: 42 },
    xAxis: {
      type: 'category',
      data: periods.map((period) => period.label.replace(/ 예시$/, '')),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#bfb9ad' }, onZero: false },
      axisLabel: { fontSize: 10, color: '#797a71', interval: 0 },
    },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      axisLabel: {
        fontSize: 10,
        color: '#98978c',
        formatter: (value: number) => value.toLocaleString('ko-KR'),
      },
      splitLine: { lineStyle: { color: '#efefeb' } },
    },
    series: [
      ['operating_profit', '영업이익', '#60584c'],
      ['operating_cashflow', '영업활동현금흐름', '#a59e90'],
    ].map(([key, label, color]) => ({
      type: 'bar',
      name: label,
      barMaxWidth: 43,
      barGap: '12%',
      barMinHeight: 1,
      label: {
        show: true,
        position: 'top',
        color: '#262b2c',
        fontWeight: 600,
        fontSize: 11,
        formatter: (params: { value: unknown }) =>
          params.value == null ? '' : chartNumber(Number(params.value)),
      },
      data: periods.map((period) => {
        const value = financialNumber(financialFact(result, key, period.key))
        return {
          value: value == null ? null : value / 1e8,
          itemStyle: {
            color: value != null && value < 0 ? '#b42318' : color,
            borderRadius:
              value != null && value < 0 ? [0, 0, 2, 2] : [2, 2, 0, 0],
          },
          label: {
            position: value != null && value < 0 ? 'bottom' : 'top',
            color: value != null && value < 0 ? '#b42318' : '#262b2c',
          },
        }
      }),
      markLine:
        key === 'operating_cashflow'
          ? {
              silent: true,
              symbol: 'none',
              label: { show: false },
              lineStyle: { color: '#bcb6a9', width: 1, type: 'solid' },
              data: [{ yAxis: 0 }],
            }
          : undefined,
    })),
  }
}
