import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { DisclosureCollectControl } from '../features/company/disclosure-collect-control'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'

const parentId = '11111111-1111-4111-8111-111111111111'
const noteId = '22222222-2222-4222-8222-222222222222'
function task(id = parentId) {
  return {
    task_id: id,
    job_id: id,
    task_type: 'DART_COLLECT',
    analysis_run_id: null,
    status: 'QUEUED',
    stage: 'QUEUED',
    state_version: 1,
    attempt: 0,
    error_code: null,
    occurred_at: '2026-10-28T12:00:00Z',
    acknowledged: false,
  }
}
function mount() {
  const session: SessionState = {
    session: { user_id: parentId, workspace_id: noteId, user_code: '12345' },
    phase: 'ready',
    message: '',
    change: vi.fn(),
    expire: vi.fn(),
    restore: vi.fn(),
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['dart', 'annual-reports', '01214248'], {
    corp_code: '01214248',
    items: [
      {
        receipt_no: '20260320001416',
        fiscal_year: '2025',
        period: '2025.12',
        report_name: '사업보고서 (2025.12)',
        withdrawn: false,
        receipt_date: '2026-03-20',
      },
    ],
    checked_at: '2026-10-28T12:00:00Z',
    search_start: '19990101',
    search_end: '20261028',
  })
  const router = createMemoryRouter([
    { path: '/', element: <DisclosureCollectControl corpCode="01214248" /> },
  ])
  render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionContext.Provider>,
  )
  return session
}

it('submits verified receipt and scope and follows collection into note completion', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      if (init?.method === 'POST')
        return new Response(JSON.stringify(task()), { status: 202 })
      const result = String(url).endsWith(noteId)
        ? {
            ...task(noteId),
            status: 'SUCCEEDED',
            stage: 'COMPLETED',
            result: { segment_count: 12 },
          }
        : {
            ...task(),
            status: 'SUCCEEDED',
            stage: 'COMPLETED',
            result: {
              kind: 'DART_COLLECT',
              note_task_id: noteId,
              structure_id: noteId,
              archive_bytes: 2048,
              note_bytes: 1024,
            },
          }
      return new Response(JSON.stringify(result), { status: 200 })
    })
  mount()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '원문 수집·주석 구조화' }))
  expect(
    await screen.findByText('원문 저장·주석 구조화 완료 · 12개 구간'),
  ).toBeVisible()
  const post = fetcher.mock.calls.find(([, init]) => init?.method === 'POST')!
  expect(JSON.parse(String(post[1]?.body))).toEqual({
    corp_code: '01214248',
    receipt_no: '20260320001416',
    scope: 'OFS',
  })
})

it('expires a rejected session instead of reporting successful collection', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'session_required' }), {
      status: 401,
    }),
  )
  const session = mount()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '원문 수집·주석 구조화' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '세션이 만료되었습니다',
  )
  expect(session.expire).toHaveBeenCalledOnce()
  expect(screen.queryByText(/구조화 완료/)).not.toBeInTheDocument()
})
