import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { FinancialStart } from '../features/financial/financial-start'
import { FinancialSummaryPage } from '../pages/financial-summary-page'
import { PredictionWorkspace } from '../features/analysis/workspace-panels'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'
import { getCollectedData } from '../features/company/collected-api'
import { FinancialInformation } from '../features/financial/financial-information'
import { resultSchema } from '../features/financial/api'
import fixture from './fixtures/financial-result.json'

vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))
const id = fixture.analysis_run_id
const context = { ...fixture.context, source_import_id: id }
const response = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 })
const session: SessionState = {
  session: { user_id: id, user_code: '00001', workspace_id: id },
  phase: 'ready',
  message: '',
  change: vi.fn(),
  restore: vi.fn(),
  expire: vi.fn(),
}
const task = {
  task_id: id,
  job_id: id,
  analysis_run_id: id,
  task_type: 'FINANCIAL_ANALYSIS',
  status: 'SUCCEEDED',
  stage: 'COMPLETED',
  state_version: 1,
  attempt: 1,
  error_code: null,
  occurred_at: fixture.collected_at,
  acknowledged: false,
}
function mount(start = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['dart', 'annual-reports', context.corp_code], {
    items: [
      {
        receipt_no: context.receipt_no,
        fiscal_year: context.fiscal_year,
        withdrawn: false,
      },
    ],
  })
  const router = createMemoryRouter(
    [
      { path: '/', element: <FinancialStart corpCode={context.corp_code} /> },
      {
        path: '/financials/:financialId/:section',
        element: <FinancialSummaryPage />,
      },
    ],
    {
      initialEntries: [
        start
          ? `/?report=${context.receipt_no}&scope=${context.scope}`
          : `/financials/${id}/summary`,
      ],
    },
  )
  render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionContext.Provider>,
  )
}

it('uses the original analysis button without a separate source selector or panel', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(task))
  mount(true)
  expect(
    screen.queryByText('저장된 수집 데이터로 분석'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: '저장된 수집 데이터' }),
  ).not.toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '핵심 재무 분석' }))
  const post = fetch.mock.calls.find(
    ([, options]) => options?.method === 'POST',
  )!
  expect(JSON.parse(String(post[1]?.body))).toEqual({
    corp_code: context.corp_code,
    receipt_no: context.receipt_no,
    scope: context.scope,
    lease: 'include',
    enrich_notes: false,
  })
})

it('renders CSV-backed values in existing financial cards and keeps source metadata in the existing dialog', async () => {
  const result = {
    ...fixture,
    context,
    collection_source: {
      import_id: id,
      source_as_of: '2026-10-26',
      exported_on: '2026-10-30',
    },
  }
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response({ ...task, context, result }),
  )
  mount()
  expect(
    await screen.findByRole('heading', { name: '핵심 재무 요약' }),
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('region', { name: '저장된 수집 데이터' }),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByText(/저장된 수집 데이터로 계산한 분석/),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: '유동비율' })).toBeInTheDocument()
  const parsed = resultSchema.parse(result)
  render(
    <FinancialInformation id={id} context={parsed.context} result={parsed} />,
  )
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '분석 추가 정보' }))
  expect(
    screen.getByRole('dialog', { name: '분석 추가 정보' }),
  ).toHaveTextContent('2026-10-26')
})

it('uses the existing risk workspace for historical candidates and coverage while keeping prediction withheld', () => {
  render(
    <PredictionWorkspace
      observations={{
        corp_code: context.corp_code,
        receipt_no: context.receipt_no,
        scope: 'CFS',
        import_id: id,
        source_as_of: '2026-10-26',
        exported_on: '2026-10-30',
        financial: [],
        history: [],
        available_scopes: [],
        coverage: {
          filings_range: '20150101~20261026',
          filings_b: '완전',
          filings_i: '완전',
          audit_doc_ok: 1,
          audit_doc_reports: 2,
        },
        event_candidates: [
          {
            id: '1',
            event_date: '2026-03-18',
            event_type: '감사의견 한정',
            verified: null,
            detail: '<script>실행되지 않는 발췌</script>',
            rcept_no: context.receipt_no,
          },
        ],
      }}
    />,
  )
  expect(screen.getByText('예측 보류')).toBeInTheDocument()
  const table = screen.getByRole('table', { name: '위험 사건 이력' })
  expect(within(table).getByText('원문 확인 전 후보')).toBeInTheDocument()
  expect(table.querySelector('script')).toBeNull()
  expect(screen.getByText(/1\/2개 확인/)).toBeInTheDocument()
})

it('rejects observations for a mismatched source scope', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    response({
      corp_code: context.corp_code,
      receipt_no: context.receipt_no,
      scope: 'OFS',
      import_id: id,
      source_as_of: '2026-10-26',
      exported_on: '2026-10-30',
      financial: [],
      history: [],
      available_scopes: [],
      event_candidates: [],
      coverage: null,
    }),
  )
  await expect(
    getCollectedData(
      {
        corpCode: context.corp_code,
        receiptNo: context.receipt_no,
        scope: 'CFS',
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow('collected_response_mismatch')
})
