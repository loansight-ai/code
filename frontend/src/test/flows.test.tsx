import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { CompanyPage } from '../pages/company-page'
import { AnalysisPage } from '../pages/analysis-page'
import * as companySearch from '../features/company/company-search'
import { companies } from '../features/company/demo-data'

vi.mock('../features/financial/financial-view', () => ({
  FinancialView: () => <div>재무 차트</div>,
}))

function mount(path = '/') {
  const router = createMemoryRouter(
    [
      { path: '/', element: <CompanyPage /> },
      { path: '/analyses/:analysisId/:section', element: <AnalysisPage /> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

it('requires a company, filters search and preserves report/scope in the analysis URL', async () => {
  const user = userEvent.setup()
  const router = mount()
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '건설' }))
  expect(await screen.findByRole('button', { name: /새움건설/ })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /한빛정밀/ }),
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /새움건설/ }))
  await user.selectOptions(screen.getByLabelText('보고서'), '2024')
  await user.click(screen.getByRole('radio', { name: /별도/ }))
  await user.click(screen.getByRole('button', { name: /예시 분석 열기/ }))
  expect(router.state.location.pathname).toBe(
    '/analyses/demo-construction/summary',
  )
  expect(router.state.location.search).toBe('?report=2024&scope=OFS')
})

it('shows an empty result and allows resetting search', async () => {
  const user = userEvent.setup()
  mount('/?q=없는기업')
  expect(await screen.findByText('검색 결과가 없습니다')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '검색 조건 초기화' }))
  expect(await screen.findByRole('button', { name: /한빛정밀/ })).toBeVisible()
})

it('keeps evidence confirmation disabled until the example source is opened and acknowledged', async () => {
  const user = userEvent.setup()
  mount('/analyses/demo-manufacturing/evidence')
  expect(screen.getByRole('checkbox')).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '예시 원문 열기' }))
  expect(screen.getByRole('dialog')).toBeVisible()
  await user.click(
    screen.getByRole('button', { name: '예시 원문 확인 후 닫기' }),
  )
  await user.click(screen.getByRole('checkbox'))
  expect(screen.getByRole('checkbox')).toBeChecked()
})

it('isolates local demo memos by company, report and accounting scope', async () => {
  const user = userEvent.setup()
  const router = mount(
    '/analyses/demo-manufacturing/review?report=2025&scope=CFS',
  )
  await user.type(screen.getByLabelText('검토 메모'), '추가 확인 필요')
  await user.click(screen.getByRole('button', { name: '브라우저에 저장' }))
  expect(
    localStorage.getItem('loansight.demo.memo.demo-manufacturing.2025.CFS'),
  ).toBe('추가 확인 필요')
  await act(() =>
    router.navigate(
      '/analyses/demo-manufacturing/review?report=2025&scope=OFS',
    ),
  )
  expect(await screen.findByLabelText('검토 메모')).toHaveValue('')
})

it('withholds probabilities when the model is unavailable and rejects unknown analysis IDs', async () => {
  const router = mount('/analyses/demo-manufacturing/prediction')
  expect(screen.getByText('예측 보류')).toBeVisible()
  expect(screen.queryByText(/\d+\s*%/)).not.toBeInTheDocument()
  await act(() => router.navigate('/analyses/unknown/summary'))
  expect(
    await screen.findByRole('heading', { name: '분석 기준을 확인해 주세요' }),
  ).toBeVisible()
})

it('keeps excluded companies unselectable and unresolved industries out of analysis', async () => {
  const user = userEvent.setup()
  mount()
  expect(await screen.findByRole('button', { name: /누리렌탈/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: /다온산업/ }))
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
  expect(
    screen.getByRole('region', { name: '업종 판정 정보' }),
  ).toHaveTextContent('부문별 매출 근거')
  await user.click(screen.getByRole('button', { name: /여울개발/ }))
  expect(
    screen.getByRole('region', { name: '업종 판정 정보' }),
  ).toHaveTextContent('미분류 상태를 유지')
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
})

it('restores company/report/scope from the URL and keeps selection explicit when filtered out', async () => {
  const user = userEvent.setup()
  mount('/?company=demo-construction&report=2024&scope=OFS')
  expect(
    await screen.findByRole('button', { name: /새움건설/ }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByLabelText('보고서')).toHaveValue('2024')
  expect(screen.getByRole('radio', { name: /별도/ })).toBeChecked()
  await user.click(screen.getByRole('button', { name: '제조' }))
  expect(await screen.findByText(/현재 검색 조건에서는 숨겨져/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: '기업 선택 해제' }))
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
})

it('shows loading without a false zero count, and exposes query failure with a working retry', async () => {
  let rejectQuery!: (reason: Error) => void
  const search = vi
    .spyOn(companySearch, 'searchDemoCompanies')
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectQuery = reject
        }),
    )
    .mockResolvedValueOnce(companies)
  const user = userEvent.setup()
  mount()
  expect(screen.getByRole('status')).toHaveTextContent(
    '기업을 불러오는 중입니다.',
  )
  expect(screen.getByText('조회 중')).toBeVisible()
  expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument()
  await act(async () => rejectQuery(new Error('조회 실패 예시')))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '기업 목록을 불러오지 못했습니다.',
  )
  expect(screen.queryByText('0', { exact: true })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByRole('button', { name: /한빛정밀/ })).toBeVisible()
  expect(search).toHaveBeenCalledTimes(2)
})

it('requires resetting invalid URL criteria instead of silently applying another accounting scope', async () => {
  const user = userEvent.setup()
  const router = mount('/?company=demo-manufacturing&report=2025&scope=INVALID')
  expect(screen.getByRole('alert')).toHaveTextContent(
    '분석 기준을 확인해 주세요',
  )
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '분석 기준 초기화' }))
  expect(router.state.location.pathname).toBe('/')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: /예시 분석 열기/ })).toBeDisabled()
})

it.each(['demo-mixed', 'demo-unclassified', 'demo-excluded'])(
  'does not expose an analysis through a direct URL for %s',
  async (id) => {
    mount(`/analyses/${id}/summary`)
    expect(
      screen.getByRole('heading', { name: '분석 기준을 확인해 주세요' }),
    ).toBeVisible()
  },
)
