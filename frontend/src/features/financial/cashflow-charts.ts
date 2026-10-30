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
export function cashCompositionData(result: FinancialResult) {
  const keys = [
    'cash_beginning',
    'operating_cashflow',
    'investing_cashflow',
    'financing_cashflow',
    'cash_ending',
  ]
  const labels = ['기초현금', '영업활동', '투자활동', '재무활동', '기말현금']
  const rows = keys.map((key, i) => ({
    key,
    label: labels[i],
    fact: financialFact(result, key),
  }))
  const amounts = rows.map((row) =>
    financialNumber(row.fact) == null ? null : scaledAmount(row.fact?.value),
  )
  if (amounts.some((value) => value == null))
    return {
      points: [],
      rows,
      adjustment: null,
      reason:
        '기초·기말 현금과 세 활동별 금액이 모두 필요합니다. 미확보 금액은 0으로 대체하지 않습니다.',
    }
  const [start, operating, investing, financing, end] = amounts as bigint[]
  const adjustment = end - start - operating - investing - financing
  const fixed = (value: bigint) =>
    `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / SCALE}.${String((value < 0n ? -value : value) % SCALE).padStart(6, '0')}`
  const points: BridgePoint[] = []
  let cursor = 0n
  const add = (
    label: string,
    value: bigint,
    total = false,
    residual = false,
  ) => {
    const next = total ? value : cursor + value
    points.push({
      label,
      value: fixed(value),
      from: total ? 0 : Number(cursor) / WON_PER_EOK_SCALED,
      to: Number(next) / WON_PER_EOK_SCALED,
      total,
      residual,
    })
    cursor = next
  }
  add('기초현금', start, true)
  add('영업활동', operating)
  add('투자활동', investing)
  add('재무활동', financing)
  if (adjustment !== 0n) add('잔액 차이\n조정', adjustment, false, true)
  add('기말현금', end, true)
  return { points, rows, adjustment: fixed(adjustment), reason: null }
}
export function profitBridgeOption(
  points: BridgePoint[],
  negativeFinal = false,
): EChartsCoreOption {
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
    const negativeEnd =
      negativeFinal &&
      point.total &&
      params.dataIndex === points.length - 1 &&
      Number(point.value) < 0
    const color = negativeEnd
      ? '#b42318'
      : point.total
        ? '#60584c'
        : increasing
          ? '#d2cdc4'
          : '#e9a59e'
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
              !negativeEnd && (point.total || increasing)
                ? Math.min(from[1], to[1]) - 10
                : Math.max(from[1], to[1]) + 14,
            text: `${!point.total && amount > 0 ? '+' : ''}${chartNumber(amount)}`,
            align: 'center',
            verticalAlign: 'middle',
            fontSize: scaledFontSize(11),
            fontWeight: 600,
            fill:
              negativeEnd || (!point.total && !increasing)
                ? '#bf3026'
                : '#262b2c',
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

export function cashBridgeData(result: FinancialResult) {
  const read = (key: string, period = 'current') => {
    const fact = financialFact(result, key, period)
    return financialNumber(fact) == null ? null : scaledAmount(fact?.value)
  }
  const start = read('operating_profit')
  const end = read('operating_cashflow')
  const fromScaled = (amount: bigint) => {
    const absolute = amount < 0n ? -amount : amount
    return `${amount < 0n ? '-' : ''}${absolute / SCALE}.${String(absolute % SCALE).padStart(6, '0')}`
  }
  const points: BridgePoint[] = []
  const rows: { label: string; value: string | null; basis: string }[] = []
  let cursor = start ?? 0n
  const add = (
    label: string,
    amount: bigint,
    total = false,
    residual = false,
  ) => {
    const next = total ? amount : cursor + amount
    points.push({
      label,
      value: fromScaled(amount),
      from: total ? 0 : Number(cursor) / WON_PER_EOK_SCALED,
      to: Number(next) / WON_PER_EOK_SCALED,
      total,
      residual,
    })
    cursor = next
  }
  if (start != null) add('영업이익', start, true)
  const depreciation = read('depreciation')
  rows.push({
    label: '감가상각비',
    value: depreciation == null ? null : fromScaled(depreciation),
    basis: '당기 감가상각비 가산',
  })
  if (depreciation != null) add('감가상각비', depreciation)
  const accounts = [
    ['receivables', '매출채권 증감', -1n],
    ['contract_assets', '계약자산 증감', -1n],
    ['inventory', '재고자산 증감', -1n],
    ['payables', '매입채무 증감', 1n],
    ['contract_liabilities', '계약부채(선수금) 증감', 1n],
  ] as const
  let workingCapital = 0n
  let completeWorkingCapital = true
  for (const [key, label, sign] of accounts) {
    // A missing balance is never zero; its effect remains in the unexplained residual.
    const current = read(key)
    const previous = read(key, 'previous')
    const effect =
      current == null || previous == null ? null : (current - previous) * sign
    rows.push({
      label,
      value: effect == null ? null : fromScaled(effect),
      basis:
        effect == null
          ? '비교 잔액 미확보 · 잔여 조정에 포함'
          : `근사 · ${sign < 0 ? '전기 − 당기' : '당기 − 전기'} 재무상태표 잔액`,
    })
    if (effect == null) completeWorkingCapital = false
    else {
      workingCapital += effect
      add(label, effect)
    }
  }
  if (start == null || end == null)
    return {
      points: [],
      rows,
      reason: '당기 영업이익과 영업활동현금흐름이 필요합니다.',
      workingCapital: null,
    }
  const residual = end - cursor
  add('기타·미분해\n조정', residual, false, true)
  rows.push({
    label: '기타·미분해 조정',
    value: fromScaled(residual),
    basis:
      '영업CF − 영업이익 − 표시 조정 합계 · 미확보 항목 포함. 이자·법인세로 확정하지 않음',
  })
  add('영업활동\n현금흐름', end, true)
  return {
    points,
    rows,
    reason: null,
    workingCapital: completeWorkingCapital ? fromScaled(workingCapital) : null,
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
