import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { VisualFinancialSummary } from '../features/financial/visual-summary'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'
import { visualSummaryExample } from '../features/financial/visual-summary-example'
import { exampleIndustryBenchmark } from '../features/financial/industry-position-example'
import coreAssessments from './fixtures/core-card-assessments.json'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))

it('shows server values and formula provenance, and restores focus after the dialog', async () => {
  const result = resultSchema.parse(fixture)
  render(<VisualFinancialSummary result={result} />)
  const user = userEvent.setup()
  const core = screen.getByRole('region', { name: '공통 핵심 5개 비율' })
  const button = within(core).getByRole('button', {
    name: '이자보상비율',
  })
  await user.click(button)
  const dialog = screen.getByRole('dialog', { name: '이자보상비율 산식' })
  expect(dialog).toHaveTextContent('영업이익 ÷ 이자비용')
  expect(dialog).toHaveTextContent('127.52억원')
  await user.keyboard('{Escape}')
  expect(button).toHaveFocus()
})

it('keeps missing totals and policies on hold and supports keyboard tabs', async () => {
  const result = resultSchema.parse(fixture)
  result.borrowing_totals.current = null
  result.facts = result.facts.filter((f) => f.key !== 'short_borrowings')
  render(<VisualFinancialSummary result={result} />)
  expect(screen.getByText('합산 보류')).toBeVisible()
  expect(
    screen.queryByRole('img', { name: /^총차입금/ }),
  ).not.toBeInTheDocument()
  const user = userEvent.setup()
  const tab = screen.getByRole('tab', { name: /활동성/ })
  await user.click(tab)
  expect(tab).toHaveAttribute('aria-selected', 'true')
  expect(
    screen.getByRole('img', { name: /5축 업종 백분위 비교 보류/ }),
  ).toBeVisible()
  expect(screen.getByRole('tabpanel')).toHaveTextContent('비교 보류')
  expect(
    screen.queryByText(/비교기간 추세를 보여줍니다/),
  ).not.toBeInTheDocument()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: /성장성/ })).toHaveFocus()
  expect(screen.getByRole('tab', { name: /성장성/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
})

it('shows example industry percentiles and changes the metric list with the selected axis', async () => {
  render(
    <VisualFinancialSummary
      result={visualSummaryExample}
      demo
      benchmark={exampleIndustryBenchmark}
    />,
  )
  const panel = screen.getByRole('tabpanel')
  expect(panel).toHaveTextContent('업종 위치 · 안정성')
  expect(within(panel).getByText('하위 25%')).toBeVisible()
  expect(
    within(panel).getByRole('img', { name: /비유동장기적합률: 비교 보류/ }),
  ).toBeVisible()
  await userEvent.setup().click(screen.getByRole('tab', { name: /현금흐름/ }))
  expect(panel).toHaveTextContent('영업CF/영업이익')
  expect(panel).toHaveTextContent('하위 15%')
  expect(screen.getByRole('img', { name: /^5축 업종 백분위\./ })).toBeVisible()
})

it('rejects benchmark context mismatches instead of showing unrelated percentiles', () => {
  render(
    <VisualFinancialSummary
      result={visualSummaryExample}
      benchmark={{ ...exampleIndustryBenchmark, scope: 'CFS' }}
    />,
  )
  expect(
    screen.getByRole('img', { name: /5축 업종 백분위 비교 보류/ }),
  ).toBeVisible()
  expect(
    within(screen.getByRole('tabpanel')).queryByText('하위 25%'),
  ).not.toBeInTheDocument()
})

it('shows example reference bullets and treats a rising debt ratio as worsening', () => {
  render(<VisualFinancialSummary result={visualSummaryExample} demo />)
  const core = screen.getByRole('region', { name: '공통 핵심 5개 비율' })
  const debt = within(core)
    .getByRole('button', { name: '부채비율' })
    .closest('article')!
  expect(debt).toHaveClass('vs-core-warning')
  expect(within(debt).getByText('경고')).toBeVisible()
  expect(within(debt).getByText('▲ +24.4%p')).toHaveClass('vs-change-down')
  expect(
    within(core).getByRole('img', { name: /유동비율:.*권고 150.0%/ }),
  ).toBeVisible()
  expect(
    within(core).getByRole('img', { name: /매출액영업이익률:.*업종 4.8%/ }),
  ).toBeVisible()
})

it('uses server assessments and authorized reference lines on real financial results', async () => {
  const result = resultSchema.parse({ ...fixture, ...coreAssessments })
  render(<VisualFinancialSummary result={result} />)
  const core = screen.getByRole('region', { name: '공통 핵심 5개 비율' })
  const liquidity = within(core)
    .getByRole('button', { name: '유동비율' })
    .closest('article')!
  expect(liquidity).toHaveClass('vs-core-attention')
  expect(within(liquidity).getByText('주의')).toBeVisible()
  expect(
    within(liquidity).getByRole('img', { name: /팀 가설 150.0%/ }),
  ).toBeVisible()
  expect(
    within(core).getByRole('img', { name: /이자보상비율:.*팀 가설 3.0배/ }),
  ).toBeVisible()
  expect(
    within(core).getByRole('img', { name: /매출액영업이익률:.*전기 4.1%/ }),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(within(core).getByRole('button', { name: '유동비율' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('사용자 지정 팀 가설')
})

it('does not guess an industry and delegates lease changes to the existing workflow', async () => {
  const result = resultSchema.parse(fixture)
  result.industry = null
  const onLease = vi.fn()
  render(<VisualFinancialSummary result={result} onLease={onLease} />)
  expect(
    screen.getByText(
      '확인된 적용 업종이 없어 지표를 임의로 선택하지 않았습니다.',
    ),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('checkbox', { name: '리스부채 포함' }))
  expect(onLease).toHaveBeenCalledWith('exclude')
})
