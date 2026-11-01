import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { CoreRatioCards } from '../features/financial/core-ratio-cards'
import { LiveFormulaDialog } from '../features/financial/live-formula-dialog'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'
import relative from './fixtures/relative-ratio-benchmark.json'

const result = () => resultSchema.parse({ ...fixture, ...relative })
const card = (name: string) =>
  screen.getByRole('button', { name }).closest('article')!

it('shows neutral relative bands with exact year, actual industry and OFS population', () => {
  render(<CoreRatioCards result={result()} demo={false} onFormula={() => {}} />)
  const liquidity = card('유동비율')
  expect(liquidity).toHaveTextContent('25~50% 구간')
  expect(liquidity).toHaveTextContent('2025년 · 제조업')
  expect(liquidity).toHaveTextContent('OFS 수집 표본 1,676개 기업')
  expect(liquidity).toHaveClass('vs-core-unassessed')
  expect(liquidity.querySelector('.vs-core-quartile-risk')).toBeNull()
  expect(within(liquidity).getByRole('img')).toHaveAccessibleName(
    /Q1 94.4%.*중앙값 166.6%.*Q3 349.5%/,
  )
  expect(card('이자보상비율')).toHaveTextContent('ECOS')
  expect(card('이자보상비율')).not.toHaveTextContent(/개 기업/)
  expect(screen.queryByText('주의', { exact: true })).toBeNull()
  expect(screen.queryByText('관찰', { exact: true })).toBeNull()
})

it('shows a single boundary note on the relevant OFS card and withholds mismatched formulas', () => {
  render(<CoreRatioCards result={result()} demo={false} onFormula={() => {}} />)
  const note = '경계 부근: 표본 구성에 따라 상대 구간이 달라질 수 있습니다.'
  expect(within(card('부채비율')).getByText(note)).toBeVisible()
  expect(within(card('이자보상비율')).queryByText(note)).toBeNull()
  expect(card('총자산영업이익률')).toHaveTextContent('비교 기준 확인 중')
  expect(card('총자산영업이익률')).toHaveTextContent('기말 총자산')
})

it('preserves pending and capital review labels without filling missing boundaries', () => {
  const data = result()
  data.core_ratio_benchmark!.metrics[0].q3 = null
  Object.assign(data.core_card_assessments![0], {
    status: 'BENCHMARK_PENDING',
    label: '비교 기준 확인 중',
    comparison_allowed: false,
    band: null,
    reason: 'Q3 미확보',
  })
  Object.assign(data.core_card_assessments![1], {
    status: 'CAPITAL_REVIEW',
    label: '자본잠식 여부 확인 필요',
    comparison_allowed: false,
    band: null,
    boundary_note: null,
  })
  render(<CoreRatioCards result={data} demo={false} onFormula={() => {}} />)
  expect(card('유동비율')).toHaveTextContent('비교 기준 확인 중')
  expect(within(card('유동비율')).getByRole('img')).toHaveAccessibleName(
    /Q3 미확보/,
  )
  expect(card('부채비율')).toHaveTextContent('자본잠식 여부 확인 필요')
  expect(card('부채비율').querySelector('.vs-core-boundary-marker')).toBeNull()
})

it('shows per-boundary CI, sample size and resampling explanation in the existing dialog', () => {
  const data = result()
  render(
    <LiveFormulaDialog
      result={data}
      metric={data.metrics.find((m) => m.key === 'current_ratio')!}
      onClose={() => {}}
      onCloseAutoFocus={() => {}}
    />,
  )
  const dialog = screen.getByRole('dialog')
  const current = within(dialog).getByRole('region', {
    name: '유동비율 현재 비교 기준',
  })
  expect(current).toHaveTextContent('95% 신뢰구간')
  expect(current).toHaveTextContent('90.3% ~ 100.2%')
  expect(dialog).toHaveTextContent('1,676개 기업')
  expect(dialog).toHaveTextContent('평균 2.7% 변경')
  expect(dialog).toHaveTextContent('내 기업의 구간이 바뀔 확률은 아닙니다.')
  const history = within(dialog).getByRole('region', {
    name: '유동비율 업종 기준 5년 이력',
  })
  expect(within(history).getAllByRole('row')).toHaveLength(6)
  expect(history).toHaveTextContent('업종합산비율 (참고)')
})

it('does not attach sample counts or OFS confidence intervals to ECOS boundaries', () => {
  const data = result()
  const row = data.core_ratio_benchmark!.metrics.find(
    (m) => m.key === 'interest_coverage',
  )!
  row.q1_ci_low = '1'
  row.q1_ci_high = '10'
  render(
    <LiveFormulaDialog
      result={data}
      metric={data.metrics.find((m) => m.key === 'interest_coverage')!}
      onClose={() => {}}
      onCloseAutoFocus={() => {}}
    />,
  )
  const current = screen.getByRole('region', {
    name: '이자보상비율 현재 비교 기준',
  })
  expect(within(current).getAllByText('해당 없음')).toHaveLength(3)
  expect(current).toHaveTextContent('2배')
  expect(screen.getByRole('dialog')).not.toHaveTextContent('개 기업')
})

it('keeps detail navigation on the established callback', async () => {
  const onFormula = vi.fn()
  render(
    <CoreRatioCards result={result()} demo={false} onFormula={onFormula} />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '부채비율 상세 보기' }))
  expect(onFormula).toHaveBeenCalledOnce()
})
