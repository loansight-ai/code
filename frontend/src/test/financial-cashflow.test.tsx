import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FinancialCashflow } from '../features/financial/financial-cashflow'
import {
  cashBridgeData,
  cashCompositionData,
  profitBridgeData,
} from '../features/financial/cashflow-charts'
import { visualSummaryExample } from '../features/financial/visual-summary-example'
import { CashflowChecks } from '../features/financial/cashflow-checks'
import {
  cashflowCheckRows,
  workingCapitalDays,
} from '../features/financial/cashflow-check-data'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'
import {
  exampleCashflowPeers,
  matchingCashflowPeers,
} from '../features/financial/cashflow-peer-data'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))
function data(before: string, after: string, changes: string[]) {
  const result = resultSchema.parse(structuredClone(fixture))
  result.facts.find(
    (fact) => fact.key === 'operating_profit' && fact.period === 'previous',
  )!.value = before
  result.facts.find(
    (fact) => fact.key === 'operating_profit' && fact.period === 'current',
  )!.value = after
  result.profit_bridge = changes.map((value, index) => ({
    label: `변동 ${index}`,
    value,
  }))
  return result
}

it('builds a reconciled waterfall that crosses zero and ends in a loss', () => {
  const bridge = profitBridgeData(
    data('10000000000', '-4000000000', ['2000000000', '-16000000000']),
  )
  expect(bridge.reason).toBeNull()
  expect(bridge.points[2]).toMatchObject({ from: 120, to: -40, total: false })
  expect(bridge.points.at(-1)).toMatchObject({ from: 0, to: -40, total: true })
})

it('reconciles opening cash and signed activities and isolates unexplained ending differences', () => {
  const result = structuredClone(visualSummaryExample)
  const composition = cashCompositionData(result)
  expect(composition.points.map((point) => Number(point.value) / 1e8)).toEqual([
    4050, -310, -480, 860, 4120,
  ])
  expect(Number(composition.adjustment)).toBe(0)
  result.facts.find(
    (fact) => fact.key === 'cash_ending' && fact.period === 'current',
  )!.value = '413000000000'
  const adjusted = cashCompositionData(result)
  expect(Number(adjusted.adjustment) / 1e8).toBe(10)
  expect(adjusted.points.at(-2)?.residual).toBe(true)
  result.facts.find(
    (fact) => fact.key === 'cash_beginning' && fact.period === 'current',
  )!.value = null
  expect(cashCompositionData(result).points).toEqual([])
})

it('rejects fictional or mismatched comparison distributions on actual results', () => {
  expect(
    matchingCashflowPeers(visualSummaryExample, exampleCashflowPeers, false),
  ).toBeNull()
  expect(
    matchingCashflowPeers(visualSummaryExample, exampleCashflowPeers, true),
  ).not.toBeNull()
  const changed = structuredClone(visualSummaryExample)
  changed.context.scope = 'CFS'
  expect(matchingCashflowPeers(changed, exampleCashflowPeers, true)).toBeNull()
  changed.context.scope = 'OFS'
  changed.context.period = '2024.12'
  expect(matchingCashflowPeers(changed, exampleCashflowPeers, true)).toBeNull()
})

it('keeps real working capital days pending while showing available example comparisons', () => {
  const real = resultSchema.parse(structuredClone(fixture))
  expect(
    workingCapitalDays(real).every(
      (row) => row.now == null && row.before == null,
    ),
  ).toBe(true)
  const example = workingCapitalDays(visualSummaryExample)
  expect(example[0]).toMatchObject({ now: 142, before: 118 })
  expect(example[2]).toMatchObject({ now: 61, before: 66, lowerBetter: false })
})

it('shows negative cash as an amount and withholds unproven repayment and dividend judgments', () => {
  render(<CashflowChecks result={visualSummaryExample} />)
  const table = screen.getByRole('table', { name: '현금흐름 확인 항목' })
  expect(table).toHaveTextContent('-310억')
  expect(table).not.toHaveTextContent('-3.1%')
  expect(table).toHaveTextContent('자금 용도 미확보')
  expect(table).toHaveTextContent('배당 지급 자료 미확보')
  expect(table).toHaveTextContent('1개 비교기간')
})

it('counts only available profitable negative-cash periods and does not count missing values', () => {
  const result = structuredClone(visualSummaryExample)
  result.facts.find(
    (fact) => fact.key === 'operating_cashflow' && fact.period === 'current',
  )!.state = 'MISSING'
  expect(cashflowCheckRows(result)).toMatchObject({
    cash: null,
    negativePeriods: 0,
  })
})

it('bridges example profit to cash with signed balance changes and an unexplained residual', () => {
  const bridge = cashBridgeData(structuredClone(visualSummaryExample))
  expect(bridge.reason).toBeNull()
  expect(bridge.points.map((point) => Number(point.value) / 1e8)).toEqual([
    1284, 180, -410, -620, -230, 160, -140, -534, -310,
  ])
  expect(bridge.points.at(-2)).toMatchObject({
    from: 224,
    to: -310,
    residual: true,
  })
  expect(bridge.points.at(-1)).toMatchObject({ from: 0, to: -310, total: true })
  expect(Number(bridge.workingCapital) / 1e8).toBe(-1240)
})

it('keeps missing balance effects unexplained and withholds missing endpoint bridges', () => {
  const result = structuredClone(visualSummaryExample)
  result.facts.find(
    (fact) => fact.key === 'inventory' && fact.period === 'previous',
  )!.state = 'MISSING'
  const bridge = cashBridgeData(result)
  expect(bridge.workingCapital).toBeNull()
  expect(
    bridge.rows.find((row) => row.label === '재고자산 증감')?.value,
  ).toBeNull()
  expect(
    bridge.points.find((point) => point.label === '재고자산 증감'),
  ).toBeUndefined()
  expect(Number(bridge.points.at(-2)?.value) / 1e8).toBe(-764)
  result.facts.find(
    (fact) => fact.key === 'operating_cashflow' && fact.period === 'current',
  )!.value = null
  expect(cashBridgeData(result).points).toEqual([])
})

it('validates six-decimal amounts exactly and preserves actual zero', () => {
  expect(
    profitBridgeData(data('0.000001', '0.000003', ['0.000002'])).reason,
  ).toBeNull()
  const zero = profitBridgeData(data('0', '0', ['0']))
  expect(zero.reason).toBeNull()
  expect(zero.points.every((point) => point.from === 0 && point.to === 0)).toBe(
    true,
  )
})

it('withholds mismatched and missing decompositions instead of manufacturing a bridge', () => {
  expect(profitBridgeData(data('100', '90', ['-11'])).reason).toContain(
    '일치하지 않아',
  )
  const missing = data('100', '90', ['-10'])
  missing.facts.find(
    (fact) => fact.key === 'operating_profit' && fact.period === 'current',
  )!.value = null
  expect(profitBridgeData(missing).points).toEqual([])
})

it('uses real API decomposition values and describes a cashflow sign change without assuming years', () => {
  const result = resultSchema.parse(structuredClone(fixture))
  result.facts.find(
    (fact) => fact.key === 'operating_cashflow' && fact.period === 'current',
  )!.value = '-31000000000'
  render(<FinancialCashflow result={result} />)
  expect(
    screen.getByRole('img', { name: /^영업이익 변동 워터폴/ }),
  ).toBeVisible()
  expect(
    screen.getByRole('img', { name: /^비교기간별 영업이익과/ }),
  ).toHaveAttribute('aria-label', expect.stringContaining('-310'))
  expect(screen.getByText(/음수 전환했습니다/)).toBeVisible()
  expect(screen.queryByText(/3년 연속/)).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: /CFS 비교/ })).toBeDisabled()
})

it('does not describe a sign change if the previous cashflow is unavailable', () => {
  const result = resultSchema.parse(structuredClone(fixture))
  result.facts.find(
    (fact) => fact.key === 'operating_cashflow' && fact.period === 'current',
  )!.value = '-31000000000'
  result.facts.find(
    (fact) => fact.key === 'operating_cashflow' && fact.period === 'previous',
  )!.value = null
  render(<FinancialCashflow result={result} />)
  expect(screen.getByText(/유출을 보입니다/)).toBeVisible()
  expect(screen.queryByText(/음수 전환했습니다/)).not.toBeInTheDocument()
})
