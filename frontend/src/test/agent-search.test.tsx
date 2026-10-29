import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { AgentSearchPanel } from '../features/evidence/agent-search-panel'

const id = '11111111-1111-4111-8111-111111111111'
const segment = '22222222-2222-4222-8222-222222222222'
const categories = [
  'audit',
  'borrowing',
  'credit',
  'collateral',
  'litigation',
  'off_balance',
]
function mount() {
  const select = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AgentSearchPanel
        id={id}
        hash="hash"
        workspaceId={id}
        onSelect={select}
      />
    </QueryClientProvider>,
  )
  return select
}
function stored(status = 'SUCCEEDED') {
  return {
    available: true,
    run: {
      run_id: segment,
      structure_id: id,
      status,
      error_code: null,
      result: {
        structure_id: id,
        source_sha256: 'hash',
        execution_status: status === 'SUCCEEDED' ? 'COMPLETED' : 'INCOMPLETE',
        evidence_verified: false,
        items: categories.map((key) => ({
          key,
          search_status: 'COMPLETED',
          limitations: '검수 전',
          findings:
            key === 'borrowing'
              ? [
                  {
                    statement: '약정 관련 근거 후보입니다.',
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
}

it('restores unreviewed findings and opens the exact cited segment', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(stored())),
  )
  const select = mount()
  expect(await screen.findByText('보완 탐색 완료 · 검수 전')).toBeVisible()
  expect(screen.getByText('위반은 없습니다.')).toBeVisible()
  await userEvent.click(
    screen.getByRole('button', { name: '인용 원문에서 확인' }),
  )
  expect(select).toHaveBeenCalledWith(segment)
})

it('starts a background run and restores it without a second submission', async () => {
  let submitted = false
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_, init) => {
      if (init?.method === 'POST') {
        submitted = true
        return new Response('{}', { status: 202 })
      }
      return new Response(
        JSON.stringify(submitted ? stored() : { available: true, run: null }),
      )
    })
  mount()
  await userEvent.click(
    await screen.findByRole('button', { name: 'Codex로 보완 탐색' }),
  )
  expect(await screen.findByText('보완 탐색 완료 · 검수 전')).toBeVisible()
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1)
})

it('shows incomplete results with explicit retry', async () => {
  const data = stored('PARTIAL_SUCCEEDED')
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(JSON.stringify(data)))
  const select = mount()
  expect(await screen.findByText(/보완 탐색 미완료 · 기본 검색/)).toBeVisible()
  expect(
    screen.getByRole('button', { name: '보완 탐색 다시 실행' }),
  ).toBeEnabled()
  expect(select).not.toHaveBeenCalled()
  fetcher.mockClear()
})

it('does not display citations from a mismatched source', async () => {
  const data = stored()
  data.run.result.source_sha256 = 'wrong'
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(data)),
  )
  mount()
  expect(await screen.findByRole('alert')).toBeVisible()
  expect(screen.queryByText('위반은 없습니다.')).not.toBeInTheDocument()
})
