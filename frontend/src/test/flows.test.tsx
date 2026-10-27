import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { CompanyPage } from '../pages/company-page'
import { AnalysisPage } from '../pages/analysis-page'

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
