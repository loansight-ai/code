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
import { FinancialStart } from '../features/financial/financial-start'

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

it('shows reconciled note borrowing amounts and provenance while full borrowing scope remains withheld', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response(detail()),
  )
  mount()
  const table = await screen.findByRole('table', { name: '차입 구성' })
  const subtotal = within(table)
    .getByRole('rowheader', { name: '주석 차입금 소계 · 리스 제외' })
    .closest('tr')!
  expect(subtotal).toHaveTextContent('4,196.37')
  const leaseIncluded = within(table)
    .getByRole('rowheader', { name: '주석 소계 · 리스 포함' })
    .closest('tr')!
  expect(leaseIncluded).toHaveTextContent('4,276.79')
  const full = within(table)
    .getByRole('rowheader', { name: '정의된 총차입금' })
    .closest('tr')!
  expect(full).toHaveTextContent('구성 계정 미확보 · 합산 보류')
  await userEvent
    .setup()
    .click(within(table).getByText('주석 표 검산 일치 · 근거 보기'))
  expect(
    within(table).getByText(/검산 대상 순부채\(순자산\): -373.83억원/),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(
      screen.getByRole('button', { name: '주석 차입금 소계/총자산 산식 보기' }),
    )
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '주석 차입금 소계: 4,276.79억원',
  )
})

it.each([
  {
    state: 'NOT_COMPUTABLE',
    value: null,
    reason: 'missing_input',
    badge: '미확보',
    display: '자료 없음',
  },
  {
    state: 'NOT_COMPUTABLE',
    value: null,
    reason: 'nonpositive_denominator',
    badge: '계산 불가',
    display: '계산 불가',
  },
  {
    state: 'APPROXIMATE',
    value: '12.5',
    reason: '테스트용 승인된 대체 계정',
    badge: '근사',
    display: '12.5%',
  },
])(
  'keeps $badge consistent between the metric card and formula dialog',
  async ({ state, value, reason, badge, display }) => {
    const result = resultSchema.parse(structuredClone(fixture))
    const metric = result.metrics.find((m) => m.key === 'current_ratio')!
    Object.assign(
      metric.values.find((v) => v.period === 'current')!,
      { state, value, reason },
    )
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      response(detail('SUCCEEDED', result)),
    )
    mount()
    const opener = await screen.findByRole('button', {
      name: '유동비율',
    })
    const card = opener.closest('.financial-core-item')!
    expect(card).toHaveTextContent(badge)
    expect(card).toHaveTextContent(display)
    if (reason === 'missing_input') expect(card).toHaveTextContent('참고')
    if (state === 'APPROXIMATE') expect(card).toHaveTextContent(reason)
    await userEvent.setup().click(opener)
    const dialog = screen.getByRole('dialog', { name: '유동비율 산식' })
    expect(within(dialog).getAllByText(badge).length).toBeGreaterThan(0)
    expect(dialog).toHaveTextContent(display)
    expect(dialog).toHaveTextContent(
      reason === 'missing_input'
        ? '필수 계정 미확보'
        : reason === 'nonpositive_denominator'
          ? '분모 0 또는 음수'
          : reason,
    )
  },
)

it('preserves actual zero and shows missing source amounts as data unavailable with reference guidance', async () => {
  const result = resultSchema.parse(structuredClone(fixture))
  result.facts.find(
    (f) => f.key === 'revenue' && f.period === 'current',
  )!.value = '0'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response(detail('SUCCEEDED', result)),
  )
  mount()
  const sources = await screen.findByRole('table', {
    name: '공통 원천 재무 계정',
  })
  const revenue = within(sources)
    .getByText('매출액', { exact: true })
    .closest('tr')!
  expect(within(revenue).getAllByRole('cell')[3]).toHaveTextContent(/^0$/)
  const borrowings = screen.getByRole('table', { name: '차입 구성' })
  const bonds = within(borrowings).getByText('비유동 사채').closest('tr')!
  expect(bonds).toHaveTextContent('자료 없음')
  expect(bonds).toHaveTextContent('미확보')
  expect(screen.getAllByText(/주석 보강 필요/).length).toBeGreaterThan(0)
})

it('rejects approximation without an explicit reason', () => {
  const result = structuredClone(fixture)
  Object.assign(result.metrics[0].values[0], {
    state: 'APPROXIMATE',
    value: '1',
    reason: null,
  })
  expect(resultSchema.safeParse(result).success).toBe(false)
})

it('shows monetary changes and transition status instead of growth percentages when profit turns negative', async () => {
  const result = resultSchema.parse(structuredClone(fixture))
  result.facts.find(
    (f) => f.key === 'operating_profit' && f.period === 'current',
  )!.value = '-100000000'
  result.facts.find(
    (f) => f.key === 'operating_profit' && f.period === 'previous',
  )!.value = '100000000'
  result.changes.operating_profit = {
    amount: '-200000000',
    growth: '-200',
    reason: null,
    transition: 'NEGATIVE_TURN',
  }
  result.facts.find(
    (f) => f.key === 'revenue' && f.period === 'current',
  )!.value = '-100000000'
  result.facts.find(
    (f) => f.key === 'revenue' && f.period === 'previous',
  )!.value = '100000000'
  result.changes.revenue = { ...result.changes.operating_profit }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response(detail('SUCCEEDED', result)),
  )
  mount()
  await screen.findByRole('heading', { name: '핵심 재무 요약' })
  await userEvent.setup().click(screen.getByRole('button', { name: '성장성' }))
  const row = screen
    .getByRole('button', { name: '매출액 증가율 산식 보기' })
    .closest('tr')!
  expect(row).toHaveTextContent('적자 전환')
  expect(row).toHaveTextContent('증감 -2억원')
  expect(row).toHaveTextContent('계산 불가')
  expect(row).not.toHaveTextContent('-200%')
})

it.each([false, true])(
  'submits structure and Codex enrichment only when selected: %s',
  async (selected) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => response(detail()))
    const router = createMemoryRouter([
      {
        path: '/',
        element: (
          <FinancialStart
            corpCode={fixture.context.corp_code}
            receiptNo={fixture.context.receipt_no}
            scope="OFS"
          />
        ),
      },
      { path: '/financials/:id/summary', element: <p>분석 시작됨</p> },
    ])
    render(
      <SessionContext.Provider value={session}>
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </SessionContext.Provider>,
    )
    const checkbox = screen.getByRole('checkbox', {
      name: '주석 구조화·Codex 데이터 보완',
    })
    expect(checkbox).not.toBeChecked()
    if (selected) await userEvent.setup().click(checkbox)
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '핵심 재무 분석' }))
    await screen.findByText('분석 시작됨')
    const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')!
    expect(JSON.parse(String(post[1]?.body))).toMatchObject({
      enrich_notes: selected,
      scope: 'OFS',
      lease: 'include',
    })
  },
)

it('keeps basic results visible while structured note enrichment is pending', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    response({
      ...detail(),
      note_workflow: {
        stage: 'WAITING_STRUCTURE',
        structure_id: other,
        job_status: null,
        error_code: null,
        candidates: [],
        completed_at: null,
      },
    }),
  )
  mount()
  expect(await screen.findByText('주석 구조화 중')).toBeVisible()
  expect(
    screen.getByRole('heading', { name: '공통 핵심 5개 비율' }),
  ).toBeVisible()
  expect(
    screen.getByRole('link', { name: '구조화된 주석 열기 →' }),
  ).toHaveAttribute('href', `/notes/${other}`)
  expect(screen.getByRole('button', { name: '다시 수집·분석' })).toBeDisabled()
})

it('opens a validated candidate in the existing structured source drawer', async () => {
  const segment = '33333333-3333-4333-8333-333333333333'
  const candidate = {
    id: segment,
    key: 'assets',
    period: 'current',
    account_name: '자산총계',
    value: '40000000000',
    status: 'APPLIED',
    reason: null,
    rationale: '자본관리 주석의 직접 금액',
    structure_id: other,
    source_sha256: fixture.source_sha256,
    row_index: 1,
    amount_column: 1,
    citations_valid: true,
    citation: { segment_id: segment, quote: '자산총계 40,000,000' },
    period_citation: { segment_id: segment, quote: '당기' },
    unit_citation: { segment_id: segment, quote: '단위: 천원' },
  }
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) =>
      String(input).includes('/source-view')
        ? response({
            structure_id: other,
            source_sha256: fixture.source_sha256,
            html: '<table id="source-table"><tr><td>구분</td><td>당기</td></tr><tr><td>자산총계</td><td>40,000,000</td></tr></table>',
            anchors: { [segment]: 'source-table' },
            view_kind: 'derived',
          })
        : response({
            ...detail(),
            note_workflow: {
              stage: 'COMPLETED',
              structure_id: other,
              job_status: 'SUCCEEDED',
              error_code: null,
              candidates: [candidate],
              completed_at: fixture.collected_at,
            },
          }),
    )
  mount()
  const table = await screen.findByRole('table', {
    name: '주석 재무 보완 후보',
  })
  expect(table).toHaveTextContent('담당자 검수 전')
  await userEvent
    .setup()
    .click(within(table).getByRole('button', { name: '주석 보완 · 근거 보기' }))
  expect(await screen.findByTitle('저장된 주석 원문')).toBeVisible()
  expect(
    fetch.mock.calls.some(([input]) =>
      String(input).includes(`/note-imports/${other}/source-view`),
    ),
  ).toBe(true)
})
