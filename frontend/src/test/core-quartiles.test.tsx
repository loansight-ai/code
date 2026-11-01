import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { CoreRatioCards } from '../features/financial/core-ratio-cards'
import { LiveFormulaDialog } from '../features/financial/live-formula-dialog'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'
import quartiles from './fixtures/core-ratio-benchmark.json'
import bok from './fixtures/bok-benchmark.json'

const result = () =>
  resultSchema.parse({ ...fixture, ...quartiles, bok_benchmark: bok })

it('uses supplied medians instead of BOK averages and draws directional quartile ranges', () => {
  render(<CoreRatioCards result={result()} demo={false} onFormula={() => {}} />)
  const liquidity = screen
    .getByRole('button', { name: '유동비율' })
    .closest('article')!
  expect(within(liquidity).getByText('관찰', { exact: true })).toBeVisible()
  expect(within(liquidity).getByText('업종 중앙값 · 2025 166.6%')).toBeVisible()
  expect(within(liquidity).queryByText(/업종 평균/)).toBeNull()
  const lowerRange = within(liquidity).getByRole('img')
  expect(lowerRange).toHaveAccessibleName(/Q1 미만 94.4%/)
  expect(lowerRange.querySelector('.vs-core-quartile-risk')).toHaveStyle({
    left: '0%',
  })
  const debt = screen
    .getByRole('button', { name: '부채비율' })
    .closest('article')!
  expect(within(debt).getByRole('img')).toHaveAccessibleName(/Q3 초과 102.0%/)
  expect(within(debt).getByText('중앙값 이하')).toBeVisible()
  const debtRange = within(debt)
    .getByRole('img')
    .querySelector<HTMLElement>('.vs-core-quartile-risk')!
  expect(parseFloat(debtRange.style.left)).toBeGreaterThan(0)
})

it('keeps fixed references as dotted guides and converts interest coverage to times', () => {
  render(<CoreRatioCards result={result()} demo={false} onFormula={() => {}} />)
  expect(screen.getByText('참고 150.0%')).toBeVisible()
  const coverage = screen
    .getByRole('button', { name: '이자보상비율' })
    .closest('article')!
  expect(within(coverage).getByText('업종 중앙값 · 2025 2.0배')).toBeVisible()
  expect(within(coverage).getByRole('img')).toHaveAccessibleName(
    /Q1 미만 -2.5배/,
  )
  expect(
    within(coverage).getByRole('img').querySelector('.vs-core-fixed-marker'),
  ).not.toBeNull()
  expect(within(coverage).getByText('참고 3.0배')).toBeVisible()
})

it('shows ROA basis mismatch without a quartile risk band or invented rating', () => {
  render(<CoreRatioCards result={result()} demo={false} onFormula={() => {}} />)
  const roa = screen
    .getByRole('button', { name: '총자산영업이익률' })
    .closest('article')!
  expect(within(roa).getByText('평가 보류')).toBeVisible()
  expect(within(roa).getByText(/자사는 기말 총자산/)).toBeVisible()
  expect(
    within(roa).getByRole('img').querySelector('.vs-core-risk-range'),
  ).toBeNull()
  expect(within(roa).getByText('참고 중앙값 · 2025 1.7%')).toBeVisible()
})

it('does not replace missing medians with BOK averages or zero', () => {
  const data = result()
  data.core_ratio_benchmark!.metrics[0].median = null
  data.core_card_assessments![0] = {
    ...data.core_card_assessments![0],
    status: 'NOT_EVALUATED',
    comparison_allowed: false,
    reference: null,
    reason: '해당 연도 중앙값 미확보 · 비교 보류',
  }
  render(<CoreRatioCards result={data} demo={false} onFormula={() => {}} />)
  const liquidity = screen
    .getByRole('button', { name: '유동비율' })
    .closest('article')!
  expect(within(liquidity).getByText('기준선 비교 보류')).toBeVisible()
  expect(within(liquidity).queryByText(/업종 평균/)).toBeNull()
  expect(
    within(liquidity).getByRole('img').querySelector('.vs-core-risk-range'),
  ).toBeNull()
})

it('shows five-year quartile history, source limitations, aggregate distinction and unit conversion', () => {
  const data = result()
  render(
    <LiveFormulaDialog
      result={data}
      metric={data.metrics.find((m) => m.key === 'interest_coverage')!}
      onClose={() => {}}
      onCloseAutoFocus={() => {}}
    />,
  )
  const dialog = screen.getByRole('dialog')
  const history = within(dialog).getByRole('region', {
    name: '이자보상비율 업종 기준 5년 이력',
  })
  expect(within(history).getAllByRole('row')).toHaveLength(6)
  expect(history).toHaveTextContent('2021')
  expect(history).toHaveTextContent('2025')
  expect(history).toHaveTextContent('업종합산비율')
  expect(dialog).toHaveTextContent('셀별 출처·표본 수·보충 여부')
  expect(dialog).toHaveTextContent('100으로 나누어 배 단위')
  expect(dialog).toHaveTextContent(quartiles.core_ratio_benchmark.version)
})

it('opens details through the existing card callback', async () => {
  const data = result()
  let opened = ''
  render(
    <CoreRatioCards
      result={data}
      demo={false}
      onFormula={(metric) => {
        opened = metric.key
      }}
    />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '부채비율 상세 보기' }))
  expect(opened).toBe('debt_ratio')
})
