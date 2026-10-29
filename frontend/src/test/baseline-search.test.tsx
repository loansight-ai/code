import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { BaselineSearchPanel } from '../features/evidence/baseline-search-panel'

const id = '11111111-1111-4111-8111-111111111111'
const segment = '22222222-2222-4222-8222-222222222222'
const categories = [
  '감사의견·계속기업',
  '차입 만기·재무약정',
  '신용등급',
  '담보',
  '소송·제재',
  '부외·후속사건',
]
const candidate = {
  segment_id: segment,
  ordinal: 5,
  kind: 'table',
  owner_node_id: 'n1',
  section_path: [{ id: 'n1', title: '차입금' }],
  excerpt: {
    text: '약정 위반은 없습니다.',
    start: 0,
    end: 12,
    truncated: false,
  },
  matches: [{ term: '약정', fields: ['text'] }],
  source_url: '/notes/' + id + '?segment=' + segment,
  table_title: '약정 내역',
}
const baseline = {
  run_id: segment,
  structure_id: id,
  source_sha256: 'hash',
  created_at: '2026-10-28T15:00:00Z',
  dictionary_version: 'common-six-draft-v1',
  dictionary_status: 'DRAFT',
  execution_kind: 'BASELINE_KEYWORD',
  execution_status: 'COMPLETED',
  report_coverage: 'PARTIAL',
  agent_status: 'NOT_RUN',
  evidence_verified: false,
  items: categories.map((title, index) => ({
    key: index === 0 ? 'audit' : 'item' + index,
    title,
    terms: ['약정'],
    mode: 'ANY',
    search_status: 'COMPLETED',
    candidate_status: index === 0 ? 'MATCHED' : 'NO_MATCH',
    total: index === 0 ? 1 : 0,
    candidates: index === 0 ? [candidate] : [],
    truncated: false,
    next_offset: null,
    unavailable_regions: index === 0 ? ['감사보고서'] : [],
    review_status: 'PENDING',
  })),
}
function mount() {
  const onSelect = vi.fn()
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <BaselineSearchPanel
        id={id}
        workspaceId={id}
        hash="hash"
        onSelect={onSelect}
      />
    </QueryClientProvider>,
  )
  return onSelect
}

it('runs and restores a baseline, displays all six items and opens cited source without claiming a risk', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (url, init) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/agent')
              ? { available: false, run: null }
              : init?.method === 'POST'
                ? baseline
                : { run: null },
          ),
        ),
    )
  const selected = mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', { name: '6항목 기본 검색' }),
  )
  const group = await screen.findByRole('group', { name: '검색 항목' })
  expect(within(group).getAllByRole('button')).toHaveLength(6)
  expect(screen.getByText(/AI 보완 탐색 상태는 아래에서 확인/)).toBeVisible()
  expect(screen.getByText(/추가 확인이 필요한 영역: 감사보고서/)).toBeVisible()
  expect(screen.getByText('약정 위반은 없습니다.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '원문에서 확인' }))
  expect(selected).toHaveBeenCalledWith(segment)
  await user.click(within(group).getByRole('button', { name: /신용등급/ }))
  expect(screen.getByText(/해당 사항이 없다는 뜻은 아닙니다/)).toBeVisible()
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1)
})

it('shows a stored baseline without rerunning it', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(
      async (url) =>
        new Response(
          JSON.stringify(
            String(url).endsWith('/agent')
              ? { available: false, run: null }
              : { run: baseline },
          ),
        ),
    )
  mount()
  await screen.findByRole('group', { name: '검색 항목' })
  expect(
    screen.queryByRole('button', { name: '6항목 기본 검색' }),
  ).not.toBeInTheDocument()
  expect(
    fetcher.mock.calls.filter(([url]) => String(url).endsWith('/baseline')),
  ).toHaveLength(1)
})

it('rejects a cached response from another source revision', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ run: { ...baseline, source_sha256: 'wrong' } }),
    ),
  )
  mount()
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText('약정 위반은 없습니다.')).not.toBeInTheDocument()
})

it('paginates candidates and retries a failed next page without losing the first page', async () => {
  let calls = 0
  const paginated = {
    ...baseline,
    items: baseline.items.map((item, index) =>
      index === 0
        ? {
            ...item,
            total: 2,
            next_offset: 1,
            truncated: true,
          }
        : item,
    ),
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/agent'))
      return new Response(JSON.stringify({ available: false, run: null }))
    if (init?.method !== 'POST')
      return new Response(JSON.stringify({ run: paginated }))
    calls += 1
    if (calls === 1)
      return new Response(JSON.stringify({ detail: 'database_unavailable' }), {
        status: 503,
      })
    expect(JSON.parse(String(init.body)).offset).toBe(1)
    return new Response(
      JSON.stringify({
        structure_id: id,
        source_sha256: 'hash',
        total: 2,
        candidates: [{ ...candidate, segment_id: id }],
        next_offset: null,
        truncated: false,
      }),
    )
  })
  mount()
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '후보 더 보기' }))
  await screen.findByRole('alert')
  expect(screen.getAllByRole('button', { name: '원문에서 확인' })).toHaveLength(
    1,
  )
  await user.click(screen.getByRole('button', { name: '다시 조회' }))
  await vi.waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: '원문에서 확인' }),
    ).toHaveLength(2),
  )
  expect(
    screen.queryByRole('button', { name: '후보 더 보기' }),
  ).not.toBeInTheDocument()
})
