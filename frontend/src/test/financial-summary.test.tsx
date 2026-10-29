import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { FinancialSummaryPage } from '../pages/financial-summary-page'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))
const id = fixture.analysis_run_id
const other = '22222222-2222-4222-8222-222222222222'
const session: SessionState = {
  session: { user_id: id, user_code: '00001', workspace_id: id },
  phase: 'ready',
  message: '',
  change: vi.fn(),
  restore: vi.fn(),
  expire: vi.fn(),
}
function detail(status = 'SUCCEEDED', result: unknown = fixture, runId = id) {
  return {
    task_id: id,
    job_id: id,
    task_type: 'FINANCIAL_ANALYSIS',
    analysis_run_id: runId,
    status,
    stage: 'COMPLETED',
    state_version: 3,
    attempt: 1,
    error_code: null,
    occurred_at: fixture.collected_at,
    acknowledged: false,
    context: fixture.context,
    result,
  }
}
function mount() {
  const router = createMemoryRouter(
    [
      {
        path: '/financials/:financialId/:section?',
        element: <FinancialSummaryPage />,
      },
    ],
    { initialEntries: [`/financials/${id}/summary`] },
  )
  render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionContext.Provider>,
  )
  return router
}
function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200 })
}

it('renders official filing values, policy holds and exact note provenance in the formula dialog', async () => {
  resultSchema.parse(fixture)
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response(detail()),
  )
  mount()
  expect(
    await screen.findByRole('heading', { name: '핵심 재무 요약' }),
  ).toBeVisible()
  expect(
    screen.getByText(
      `${fixture.company_name} · ${fixture.context.report_name} · 별도 기준`,
    ),
  ).toBeVisible()
  expect(screen.getByText('기말/평균잔액 기준 미정')).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '이자보상비율' }))
  const dialog = screen.getByRole('dialog', { name: '이자보상비율 산식' })
  expect(within(dialog).getByText('영업이익 ÷ 이자비용')).toBeVisible()
  expect(within(dialog).getByText(/이자비용: 127.52억원/)).toBeVisible()
  expect(
    within(dialog).getByRole('link', { name: '해당 공시 원문 확인' }),
  ).toHaveAttribute('href', fixture.source_url)
})

it('hides previous company values while another analysis loads', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input).includes(other) ? new Promise(() => {}) : response(detail()),
  )
  const router = mount()
  await screen.findByText(
    `${fixture.company_name} · ${fixture.context.report_name} · 별도 기준`,
  )
  await router.navigate(`/financials/${other}/summary`)
  expect(await screen.findByText('재무 분석을 불러오는 중입니다')).toBeVisible()
  expect(
    screen.queryByText(
      `${fixture.company_name} · ${fixture.context.report_name} · 별도 기준`,
    ),
  ).not.toBeInTheDocument()
})

it('creates an isolated server result when the lease option changes', async () => {
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      if (init?.method === 'POST')
        return response({ ...detail(), analysis_run_id: other })
      if (String(input).includes(other))
        return response({
          ...detail('QUEUED', null, other),
          context: { ...fixture.context, lease: 'exclude' },
        })
      return response(detail())
    })
  const router = mount()
  await screen.findByRole('heading', { name: '핵심 재무 요약' })
  await userEvent
    .setup()
    .click(screen.getByRole('checkbox', { name: '리스부채 포함' }))
  expect(
    await screen.findByText('재무 데이터를 수집·계산하고 있습니다'),
  ).toBeVisible()
  expect(router.state.location.pathname).toContain(other)
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]?.body))).toEqual({
    corp_code: fixture.context.corp_code,
    receipt_no: fixture.context.receipt_no,
    scope: 'OFS',
    lease: 'exclude',
  })
  expect(
    screen.queryByRole('heading', { name: '공통 핵심 5개 비율' }),
  ).not.toBeInTheDocument()
})

it('shows correction mismatch as an error without example values', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response({
      ...detail('FAILED', null),
      error_code: 'financial_receipt_mismatch',
    }),
  )
  mount()
  expect(await screen.findByText('재무 분석에 실패했습니다')).toBeVisible()
  expect(screen.getByText(/API가 선택한 공시와 다른 정정본/)).toBeVisible()
  expect(
    screen.queryByRole('heading', { name: '공통 핵심 5개 비율' }),
  ).not.toBeInTheDocument()
})
