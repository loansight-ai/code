import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { resultSchema, type FinancialResult } from '../features/financial/api'
import { VisualFinancialSummary } from '../features/financial/visual-summary'
import fixture from './fixtures/financial-result.json'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))

function result(): FinancialResult {
  const data = resultSchema.parse(fixture)
  data.formula_version = 'financial-formulas-v4'
  for (const [key, label, unit, value, formula, inputs] of [
    [
      'inventory_turnover',
      '재고자산회전율',
      '회',
      '6',
      '매출액 ÷ ((기초 재고자산 + 기말 재고자산) ÷ 2)',
      ['revenue', 'inventory'],
    ],
    [
      'asset_turnover',
      '총자산회전율',
      '회',
      '0.8',
      '매출액 ÷ 평균 총자산',
      ['revenue', 'assets'],
    ],
    [
      'long_term_asset_fit',
      '비유동장기적합률',
      '%',
      '75',
      '비유동자산 ÷ (자본총계 + 비유동부채) × 100',
      ['noncurrent_assets', 'equity', 'noncurrent_liabilities'],
    ],
  ] as const) {
    data.metrics.push({
      key,
      label,
      unit,
      formula,
      inputs: [...inputs],
      group: '활동성',
      basis: '분모 기초·기말 평균',
      change: null,
      change_unit: unit,
      values: [{ period: 'current', value, state: 'CONFIRMED', reason: null }],
    })
  }
  return data
}

it('shows computed turnover in the restored activity panel and explains both balances in the formula dialog', async () => {
  render(<VisualFinancialSummary result={result()} />)
  const domains = screen.getByRole('region', { name: '5개 영역 지표' })
  await userEvent
    .setup()
    .click(within(domains).getByRole('tab', { name: /활동성/ }))
  const panel = within(domains).getByRole('tabpanel')
  expect(panel).toHaveTextContent('재고자산회전율 6회')
  expect(panel).toHaveTextContent('총자산회전율 0.8회')
  await userEvent
    .setup()
    .click(
      within(panel).getByRole('button', { name: '재고자산회전율 산식 보기' }),
    )
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('아래 두 잔액의 산술평균')
  expect(dialog).toHaveTextContent('기초')
  expect(dialog).toHaveTextContent('기말')
  expect(dialog).toHaveTextContent('financial-formulas-v4')
})

it('distinguishes an unavailable opening balance from an unset definition', () => {
  const data = result()
  const turnover = data.metrics.find((m) => m.key === 'inventory_turnover')!
  turnover.values[0] = {
    period: 'current',
    value: null,
    state: 'NOT_COMPUTABLE',
    reason: 'opening_balance_missing',
  }
  render(<VisualFinancialSummary result={data} />)
  const industry = screen.getByRole('table', { name: '업종 핵심 지표' })
  expect(industry).toHaveTextContent('기초 잔액 미확보 · 평균 잔액 계산 보류')
  expect(industry).toHaveTextContent('개발비 자산화 범위·분모 정의 미정')
})
