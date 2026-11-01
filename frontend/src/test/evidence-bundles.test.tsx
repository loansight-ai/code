import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { EvidenceBundlePage } from '../pages/evidence-bundle-page'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'
import { bundleSchema, getBundle } from '../features/evidence/bundle-api'

vi.mock('../shared/components/chart', () => ({ Chart: () => <div /> }))
const id = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const base = {
  bundle_id: id,
  bundle_revision: 'revision',
  corp_code: '01214248',
  receipt_no: '20260320001416',
  scope: 'OFS',
  period: '2025.12',
  company_name: '시험기업',
  review_status: 'PENDING',
  evidence_verified: false,
  model_input_status: 'WITHHELD_UNVERIFIED',
  collection_import_id: null,
  sources: [{ origin: 'dump', archive: 'test.dump' }],
  coverage: [{ region: 'notes', scope: 'OFS', segments: 2, nonempty: 2 }],
  limitations: ['검수 전'],
  baseline: null,
}
const candidate = {
  segment_id: sid,
  kind: 'table',
  origin: 'dump',
  region: 'notes',
  scope: 'OFS',
  source_revision: id,
  sha256: 'hash',
  section_path: [{ id: sid, title: '담보 내역' }],
  excerpt: { text: '담보 100', start: 0, end: 6, truncated: false },
  location: {},
  source_url: null,
}
const session: SessionState = {
  session: { user_id: id, user_code: '00001', workspace_id: id },
  phase: 'ready',
  message: '',
  change: vi.fn(),
  restore: vi.fn(),
  expire: vi.fn(),
}

function mock() {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input)
    let body: unknown = base
    if (url.includes('/sections'))
      body = {
        bundle_id: id,
        bundle_revision: 'revision',
        sections: [],
        next_offset: null,
      }
    else if (url.endsWith('/agent')) body = { available: false, run: null }
    else if (url.endsWith('/fact-extraction'))
      body = { available: false, run: null }
    else if (url.includes('/facts?')) body = { facts: [], next_offset: null }
    else if (url.includes('/signals?'))
      body = {
        bundle_id: id,
        input_revision: 'inputs',
        registry_revision: 'registry',
        version: 'signals-v1',
        evaluation_status: 'DEFINITION_PENDING',
        ready_inputs: 0,
        total_facts: 0,
        next_offset: null,
        categories: [],
        facts: [],
        evaluations: [],
        severity_counts: {},
        limitations: [],
        model_eligible: false,
      }
    else if (url.endsWith('/baseline'))
      body = {
        bundle_id: id,
        bundle_revision: 'revision',
        items: [
          'audit',
          'borrowing',
          'credit',
          'collateral',
          'litigation',
          'off_balance',
        ].map((key, i) => ({
          bundle_id: id,
          bundle_revision: 'revision',
          key,
          title: `항목 ${i}`,
          terms: ['담보'],
          candidate_status: 'MATCHED',
          total: 1,
          candidates: [candidate],
          next_offset: null,
          unavailable_regions: ['audit'],
        })),
      }
    else if (url.includes('/context'))
      body = {
        bundle_id: id,
        bundle_revision: 'revision',
        segments: [candidate],
        next_text_offset: null,
        table: {
          cells: [['담보', '<script>unsafe()</script>', '-']],
          unit: '단위: 원',
          row_offset: 0,
          next_row_offset: null,
        },
      }
    else if (url.includes('collected-data'))
      body = {
        corp_code: base.corp_code,
        receipt_no: base.receipt_no,
        scope: 'OFS',
        import_id: null,
        source_as_of: null,
        exported_on: null,
        financial: [],
        history: [],
        available_scopes: [],
        event_candidates: [],
        coverage: null,
      }
    return new Response(JSON.stringify(body), { status: 200 })
  })
}
function mount(section = 'evidence', state = session) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const router = createMemoryRouter(
    [{ path: '/evidence/:bundleId/:section', element: <EvidenceBundlePage /> }],
    { initialEntries: [`/evidence/${id}/${section}`] },
  )
  const tree = (s: SessionState) => (
    <SessionContext.Provider value={s}>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionContext.Provider>
  )
  const view = render(tree(state))
  return { ...view, change: (s: SessionState) => view.rerender(tree(s)) }
}

it('opens dump-only evidence without a structure or financial analysis and renders stored cells safely', async () => {
  mock()
  mount()
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '주석·위험징후' })
  await user.click(screen.getByRole('button', { name: '공통 6항목 검색' }))
  await screen.findByText('항목 0 · 1개 후보 · 검수 전')
  await user.click(screen.getByText('항목 0 · 1개 후보 · 검수 전'))
  const first = screen
    .getByText('항목 0 · 1개 후보 · 검수 전')
    .closest('details')!
  await user.click(
    within(first).getByRole('button', { name: '담보 내역 · 표' }),
  )
  const table = await screen.findByRole('table', { name: '저장된 근거 표' })
  expect(
    within(table).getByText('<script>unsafe()</script>'),
  ).toBeInTheDocument()
  expect(table.querySelector('script')).toBeNull()
  expect(
    screen.queryByRole('button', { name: '다음 본문' }),
  ).not.toBeInTheDocument()
})

it('hides the previous owner data immediately during a session change', async () => {
  mock()
  const view = mount()
  await screen.findByText(/시험기업/)
  view.change({ ...session, phase: 'changing' })
  expect(screen.queryByText(/시험기업/)).not.toBeInTheDocument()
  expect(screen.getByText('사용자 코드로 접속해 주세요')).toBeInTheDocument()
})

it('keeps prediction withheld while displaying note evidence', async () => {
  mock()
  mount('prediction')
  await screen.findByRole('heading', { name: '위험 사건 예측과 근거' })
  expect(screen.getByText('예측 보류')).toBeInTheDocument()
  expect(
    screen.getByRole('region', { name: '보고서 통합 근거' }),
  ).toBeInTheDocument()
})

it('rejects an evidence response from a different bundle', async () => {
  bundleSchema.parse(base)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ...base, bundle_id: sid })),
  )
  await expect(getBundle(id, new AbortController().signal)).rejects.toThrow(
    'Evidence bundle response mismatch',
  )
})
