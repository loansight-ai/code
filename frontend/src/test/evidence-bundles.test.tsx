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

function mock(facts: unknown[] = []) {
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
    else if (url.includes('/facts?')) body = { facts, next_offset: null }
    else if (url.endsWith(`/segments/${sid}`)) body = candidate
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
  await screen.findByRole('heading', { name: '주석 확인과 위험징후' })
  const overview = screen.getByRole('region', { name: '추출 현황' })
  expect(within(overview).getAllByRole('row')).toHaveLength(7)
  await user.click(screen.getByRole('button', { name: '담보 제공' }))
  const detail = screen.getByRole('complementary', { name: '선택 항목 근거' })
  expect(within(detail).getByText('검색 후보')).toBeInTheDocument()
  expect(within(detail).getAllByText('미확보')).toHaveLength(3)
  await user.click(
    await within(detail).findByRole('button', { name: '원문 열기' }),
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

it('shows structured amounts without treating raw matches as detected facts', async () => {
  mock([
    {
      id: sid,
      root_id: sid,
      supersedes_id: null,
      revision: 1,
      version: 0,
      state: 'PENDING',
      model_eligible: false,
      origin: { kind: 'MANUAL' },
      validation: {
        status: 'CITATIONS_VALID',
        issues: [],
        normalized_amount: '342000000000',
      },
      data: {
        category: 'off_balance',
        kind: 'guarantee',
        statement: 'PF 대출 지급보증',
        subject: '시험기업',
        direction: 'PROVIDED',
        period: null,
        counterparty: '검증 상대방',
        amount_role: 'LIMIT',
        amount: {
          raw_value: '3,420',
          currency: 'KRW',
          unit: '억원',
          cell: { segment_id: sid, row: 0, column: 1 },
        },
        maturity: '2027.06.30',
        status: null,
        detection: 'DETECTED',
        citations: [
          {
            segment_id: sid,
            field: 'statement',
            quote: 'PF 대출 지급보증을 제공하고 있습니다.',
          },
        ],
      },
    },
  ])
  mount()
  const user = userEvent.setup()
  await screen.findByRole('heading', { name: '주석 확인과 위험징후' })
  await user.click(screen.getByRole('button', { name: '부외거래·후속사건' }))
  const detail = screen.getByRole('complementary', { name: '선택 항목 근거' })
  await within(detail).findByText('3,420 억원')
  expect(within(detail).getByText('검출')).toBeInTheDocument()
  expect(within(detail).getByText('검수 전 후보 · 보증')).toBeInTheDocument()
  expect(within(detail).getByText('미확보')).toBeInTheDocument()
  expect(within(detail).getByText('2027.06.30')).toBeInTheDocument()
  await user.selectOptions(
    within(detail).getByRole('combobox', { name: '관련 근거' }),
    `source:${sid}`,
  )
  expect(within(detail).getByText('검색 후보')).toBeInTheDocument()
  expect(within(detail).queryByText('3,420 억원')).not.toBeInTheDocument()
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
