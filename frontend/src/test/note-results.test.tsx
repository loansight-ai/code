import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { NoteResultsPage } from '../pages/note-results-page'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'

const id = '11111111-1111-4111-8111-111111111111'
const segmentId = '22222222-2222-4222-8222-222222222222'
const segment = {
  id: segmentId,
  local_id: 'b1',
  ordinal: 0,
  kind: 'table',
  source_xpath: '/html/body/table',
  text: '현금 및 현금성자산 100',
  owner_node_id: 'n1',
  table_data: { display_title: '현금 표' },
}
function mount(authenticated = true) {
  const session: SessionState = {
    session: authenticated
      ? { user_id: id, workspace_id: segmentId, user_code: '12345' }
      : null,
    phase: 'ready',
    message: '',
    change: vi.fn(),
    expire: vi.fn(),
    restore: vi.fn(),
  }
  const router = createMemoryRouter(
    [{ path: '/notes/:structureId', element: <NoteResultsPage /> }],
    { initialEntries: ['/notes/' + id] },
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
function fixtures() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    let data: unknown = {
      structure_id: id,
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      corp_code: '01214248',
      company_name: '뉴트리',
      receipt_no: '20260320001416',
      scope: 'OFS',
      period: '2025.12',
      source_sha256: 'hash',
      source_bytes: 1000,
      parser_version: '0.8.4',
      input_origin: 'dart_viewer_note_html',
      segment_count: 1,
      evidence_verified: false,
      hierarchy: {
        nodes: [
          { id: 'root', title: '주석', parent_id: null },
          {
            id: 'n1',
            title: '현금 및 현금성자산',
            parent_id: 'root',
            status: 'unresolved',
            review_flags: ['review'],
          },
        ],
      },
    }
    if (url.includes('source-view'))
      data = {
        structure_id: id,
        source_sha256: 'hash',
        html: `<table id="source-${segmentId}"><tr><td>100</td></tr></table>`,
        anchors: { [segmentId]: `source-${segmentId}` },
        view_kind: 'derived',
      }
    else if (url.includes('/segments?'))
      data = { segments: [segment], total: 1, next_after: null }
    else if (url.includes('/segments/')) data = segment
    return new Response(JSON.stringify(data), { status: 200 })
  })
}

it('loads saved notes, flags unresolved structure and preserves node and table filters', async () => {
  const fetcher = fixtures()
  const router = mount()
  expect(
    await screen.findByRole('heading', { name: '주석 구조화 결과' }),
  ).toBeVisible()
  expect(await screen.findByText('구조 확인 필요')).toBeVisible()
  expect(await screen.findByTitle('저장된 주석 원문')).toHaveAttribute(
    'sandbox',
    'allow-same-origin',
  )
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: /현금 및 현금성자산.*구조 확인 필요/ }),
  )
  expect(new URLSearchParams(router.state.location.search).get('node')).toBe(
    'n1',
  )
  await user.click(screen.getByRole('checkbox', { name: '표만 보기' }))
  await vi.waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes('tables_only=true'),
      ),
    ).toBe(true),
  )
  expect(screen.getByText('내용 검수 전')).toBeVisible()
})

it('does not request private source data without a session', () => {
  const fetcher = fixtures()
  mount(false)
  expect(screen.getByText('코드로 접속해 주세요')).toBeVisible()
  expect(fetcher).not.toHaveBeenCalled()
  expect(screen.queryByTitle('저장된 주석 원문')).not.toBeInTheDocument()
})

it('does not show data when the current user cannot access a result', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ detail: 'note_structure_not_found' }), {
      status: 404,
    }),
  )
  mount()
  expect(
    await screen.findByText(
      '결과가 없거나 현재 사용자에게 조회 권한이 없습니다.',
    ),
  ).toBeVisible()
  expect(screen.queryByTitle('저장된 주석 원문')).not.toBeInTheDocument()
})
