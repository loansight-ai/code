import { render, screen, within, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { Shell } from '../app/shell'
import { TaskContext } from '../features/tasks/task-context'
import { LiveAnalysisPage } from '../pages/live-analysis-page'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'

vi.mock('../features/evidence/note-source-drawer', () => ({
  NoteSourceDrawer: ({
    segmentId,
    onViewed,
    onClose,
  }: {
    segmentId: string | null
    onViewed?: (id: string) => void
    onClose: () => void
  }) =>
    segmentId ? (
      <div role="dialog" aria-label="원문 표시 테스트">
        <button onClick={() => onViewed?.(segmentId)}>원문 표시 완료</button>
        <button onClick={onClose}>닫기</button>
      </div>
    ) : null,
}))

const id = '11111111-1111-4111-8111-111111111111'
const segment = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const metadata = {
  structure_id: id,
  status: 'SUCCEEDED',
  stage: 'COMPLETED',
  corp_code: '01214248',
  company_name: '검증기업',
  receipt_no: '20260320001416',
  scope: 'OFS',
  period: '2025.12',
  source_sha256: 'hash',
  source_bytes: 1000,
  parser_version: '0.8.4',
  input_origin: 'dart_viewer_note_html',
  segment_count: 1,
  evidence_verified: false,
  hierarchy: { nodes: [{ id: 'root', title: '주석', parent_id: null }] },
}
function fixtures() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    let data: unknown = metadata
    if (url.includes('/companies?'))
      data = { items: [], total: 0, offset: 0, limit: 10 }
    else if (url.includes('/search/agent'))
      data = {
        available: true,
        provider: 'codex',
        run: {
          run_id: segment,
          structure_id: id,
          status: 'SUCCEEDED',
          error_code: null,
          result: {
            structure_id: id,
            source_sha256: 'hash',
            execution_status: 'COMPLETED',
            evidence_verified: false,
            items: [
              'audit',
              'borrowing',
              'credit',
              'collateral',
              'litigation',
              'off_balance',
            ].map((key) => ({
              key,
              search_status: 'COMPLETED',
              limitations: '주석 범위만 검색. 검수 전.',
              findings:
                key === 'borrowing'
                  ? [
                      {
                        statement: '약정 위반이 없다는 문구가 있습니다.',
                        citations: [
                          { segment_id: segment, quote: '위반은 없습니다.' },
                        ],
                      },
                    ]
                  : [],
            })),
          },
        },
      }
    else if (url.includes('/search/baseline')) data = { run: null }
    else if (url.includes('/source-view'))
      data = {
        structure_id: id,
        source_sha256: 'hash',
        html: `<p id="source-${segment}">위반은 없습니다.</p>`,
        anchors: { [segment]: `source-${segment}` },
        view_kind: 'derived',
      }
    else if (url.includes('/segments?'))
      data = { segments: [], total: 0, next_after: null }
    return new Response(JSON.stringify(data))
  })
}
function mount(section = 'review', workspace = owner) {
  const session: SessionState = {
    session: { user_id: owner, workspace_id: workspace, user_code: '12345' },
    phase: 'ready',
    message: '',
    change: vi.fn(),
    expire: vi.fn(),
    restore: vi.fn(),
  }
  const router = createMemoryRouter(
    [
      {
        element: <Shell />,
        children: [
          {
            path: '/notes/:structureId/:section?',
            element: <LiveAnalysisPage />,
          },
        ],
      },
    ],
    { initialEntries: [`/notes/${id}/${section}`] },
  )
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SessionContext.Provider value={session}>
        <TaskContext.Provider
          value={{
            tasks: [],
            connection: 'idle',
            message: '',
            refresh: vi.fn(),
            diagnostic: vi.fn(),
            acknowledge: vi.fn(),
            detail: vi.fn(),
          }}
        >
          <RouterProvider router={router} />
        </TaskContext.Provider>
      </SessionContext.Provider>
    </QueryClientProvider>,
  )
  return router
}
it('keeps the real filing context across menus and never fills unavailable financial values with demo numbers', async () => {
  fixtures()
  const router = mount('summary')
  expect(
    await screen.findByRole('heading', { name: '핵심 재무 요약' }),
  ).toBeVisible()
  await screen.findByText(/검증기업 · 2025.12 결산/)
  expect(screen.getByLabelText('기업 분석 기준')).toHaveTextContent(
    '20260320001416',
  )
  expect(screen.queryByText('1,250')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('link', { name: '체크·검토 메모' }))
  expect(router.state.location.pathname).toBe(`/notes/${id}/review`)
  expect(
    await screen.findByText('약정 위반이 없다는 문구가 있습니다.'),
  ).toBeVisible()
  expect(screen.getByLabelText('기업 분석 기준')).toHaveTextContent('별도(OFS)')
})
it('requires source-render acknowledgment for confirmation, saves a local draft and isolates it by workspace', async () => {
  fixtures()
  mount()
  const user = userEvent.setup()
  const check = await screen.findByRole('checkbox', {
    name: /약정 위반이 없다는 문구/,
  })
  expect(check).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '근거 원문 1' }))
  const drawer = await screen.findByRole('dialog')
  await user.click(
    within(drawer).getByRole('button', { name: '원문 표시 완료' }),
  )
  await user.click(within(drawer).getByRole('button', { name: '닫기' }))
  expect(check).toBeEnabled()
  await user.click(check)
  await user.type(
    screen.getByLabelText('담당자 의견'),
    '원문 대조 후 내부 약정 확인 필요',
  )
  await user.click(screen.getByRole('button', { name: '브라우저에 저장' }))
  expect(
    screen.getByText(/이 브라우저에 검토 기록을 저장했습니다/),
  ).toBeVisible()
  cleanup()
  mount()
  expect(await screen.findByLabelText('담당자 의견')).toHaveValue(
    '원문 대조 후 내부 약정 확인 필요',
  )
  expect(
    screen.getByRole('checkbox', { name: /약정 위반이 없다는 문구/ }),
  ).toBeChecked()
  cleanup()
  mount('review', id)
  expect(await screen.findByLabelText('담당자 의견')).toHaveValue('')
  expect(
    screen.getByRole('checkbox', { name: /약정 위반이 없다는 문구/ }),
  ).toBeDisabled()
})
