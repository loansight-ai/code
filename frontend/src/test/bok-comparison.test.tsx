import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { VisualFinancialSummary } from '../features/financial/visual-summary'
import { CashflowOverview } from '../features/financial/cashflow-overview'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'
import benchmark from './fixtures/bok-benchmark.json'
import assessments from './fixtures/core-card-assessments.json'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))

function result() {
  return resultSchema.parse({
    ...fixture,
    ...assessments,
    bok_benchmark: benchmark,
  })
}

it('keeps BOK averages in core cards and restores all five metric domains', async () => {
  render(<VisualFinancialSummary result={result()} />)
  expect(
    screen.queryByRole('heading', { name: '업종 평균 비교' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('table', { name: '한국은행 업종 평균 상세 비교' }),
  ).not.toBeInTheDocument()
  const core = screen.getByRole('region', { name: '공통 핵심 5개 비율' })
  expect(within(core).getAllByText(/^업종 평균 · 2025 /)).toHaveLength(4)
  expect(
    within(core).getByRole('link', { name: '한국은행 기업경영분석' }),
  ).toHaveAttribute('href', expect.stringContaining('nttId=11065774'))
  const current = within(core)
    .getByRole('button', { name: '유동비율' })
    .closest('article')!
  expect(within(current).getByText('주의', { exact: true })).toBeVisible()
  expect(within(current).getByText('평균 대비 +0.05%p')).toBeVisible()
  const line = within(core).getByRole('img', { name: /유동비율:.*업종 평균/ })
  expect(line.querySelector('.vs-core-risk-range')).toBeNull()
  const domains = screen.getByRole('region', { name: '5개 영역 지표' })
  expect(within(domains).getAllByRole('tab')).toHaveLength(5)
  for (const name of ['수익성', '안정성', '활동성', '성장성', '현금흐름']) {
    const tab = within(domains).getByRole('tab', { name: new RegExp(name) })
    await userEvent.setup().click(tab)
    expect(tab).toHaveAttribute('aria-selected', 'true')
    expect(within(domains).getByRole('tabpanel')).toHaveTextContent(
      `업종 위치 · ${name}`,
    )
  }
})

it('does not add BOK averages or source blocks to the cashflow panel', () => {
  render(<CashflowOverview result={result()} />)
  expect(
    screen.queryByRole('link', { name: '한국은행 기업경영분석' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('img', { name: /한국은행 업종 평균/ }),
  ).not.toBeInTheDocument()
})

it('keeps five domains available when BOK industry mapping is unavailable', () => {
  const data = result()
  data.bok_benchmark = {
    status: 'UNAVAILABLE',
    reason: '기업 KSIC 업종 미확보',
    metrics: [],
  }
  render(<VisualFinancialSummary result={data} />)
  const domains = screen.getByRole('region', { name: '5개 영역 지표' })
  expect(within(domains).getAllByRole('tab')).toHaveLength(5)
  expect(
    screen.queryByRole('heading', { name: '업종 평균 비교' }),
  ).not.toBeInTheDocument()
})
