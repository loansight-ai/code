import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FinancialCashflow } from '../features/financial/financial-cashflow'
import { profitBridgeData } from '../features/financial/cashflow-charts'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'

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
