import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { ExposurePanels } from '../features/evidence/exposure-panels'
import { bundleSchema } from '../features/evidence/bundle-api'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'
import { exposureFixture } from '../../e2e/exposure-fixture'

const id = '11111111-1111-4111-8111-111111111111'
const bundle = bundleSchema.parse({
  bundle_id: id,
  bundle_revision: 'test',
  corp_code: '00164478',
  receipt_no: '20260318001395',
  scope: 'OFS',
  period: '2025.12',
  company_name: '시험기업',
  review_status: 'PENDING',
  evidence_verified: false,
  model_input_status: 'WITHHELD_UNVERIFIED',
  collection_import_id: null,
  sources: [],
  coverage: [],
  limitations: [],
  baseline: null,
})
const session: SessionState = {
  session: { user_id: id, user_code: '00001', workspace_id: id },
  phase: 'ready',
  message: '',
  change: vi.fn(),
  restore: vi.fn(),
  expire: vi.fn(),
}
function mount(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200 }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/evidence/${id}/evidence`]}>
          <ExposurePanels bundle={bundle} />
        </MemoryRouter>
      </QueryClientProvider>
    </SessionContext.Provider>,
  )
}

it('shows the loan-balance numerator, received exclusion and unknown-maturity amount', async () => {
  mount(exposureFixture(bundle))
  const provided = await screen.findByRole('region', {
    name: '제공 보증·조건부 의무 구성',
  })
  await within(provided).findByText('10,985')
  expect(within(provided).getByText('= 61.0%')).toBeInTheDocument()
  expect(within(provided).getByText('합산 제외')).toBeInTheDocument()
  const maturity = screen.getByRole('region', { name: '1년 내 만기 요약' })
  expect(within(maturity).getByText('810')).toBeInTheDocument()
  expect(
    within(maturity).getByRole('link', { name: '만기 사다리 보기 →' }),
  ).toHaveAttribute(
    'href',
    '/evidence/' + id + '/evidence?tab=signals&detail=maturity',
  )
  expect(
    screen.getByRole('region', { name: '소송 현황 피고' }),
  ).toHaveTextContent('12건')
  const litigation = screen.getByRole('region', { name: '소송 현황 피고' })
  expect(
    within(litigation).getByRole('table', { name: '피고 소송가액 상위 사건' }),
  ).toHaveTextContent('2024.03.11')
  expect(litigation).toHaveTextContent(/원고 \(참고\):\s*5건\s*·\s*214억/)
  expect(litigation).toHaveTextContent('1심 진행 중')
})

it('shows a reported summary without inventing individual cases or quotes', async () => {
  const data = exposureFixture(bundle)
  mount({
    ...data,
    litigation: {
      ...data.litigation,
      top_cases: [],
      case_list_available: false,
      notes: [],
    },
  })
  await screen.findByText('건별 목록 미확보')
  const litigation = screen.getByRole('region', { name: '소송 현황 피고' })
  expect(within(litigation).getByText('386억')).toBeInTheDocument()
  expect(within(litigation).queryByText('2024.03.11')).not.toBeInTheDocument()
  expect(
    within(litigation).getByText('소송 결과 관련 원문 인용 미확보'),
  ).toBeInTheDocument()
})

it('keeps missing financial values and maturity information separate from numeric zero', async () => {
  const body = exposureFixture(bundle)
  body.provided.rows = []
  body.received.rows = []
  const missing = {
    limit: null,
    commitment: null,
    loan_balance: null,
    related_party: null,
  }
  const empty = {
    values: { within: null, beyond: null, undisclosed: null },
    within_percent: null,
    total: null,
    sources: [],
    items: [],
  }
  mount({
    ...body,
    provided: { rows: [], totals: missing, complete: false },
    received: { rows: [], totals: missing, complete: false },
    equity: null,
    ratio_percent: null,
    maturity: { debt: empty, obligation: empty },
    litigation: {
      case_count: null,
      claim: null,
      provision: null,
      top_cases: [],
      sources: [],
      plaintiff_facts: 0,
    },
  })
  await screen.findByText('비율 미산출')
  expect(screen.queryByText(/^0$/)).not.toBeInTheDocument()
  expect(screen.getAllByText('만기 정보 미확보')).toHaveLength(2)
  expect(screen.getAllByText('미확보').length).toBeGreaterThan(6)
})

it('rejects a summary from a different report bundle', async () => {
  mount({
    ...exposureFixture(bundle),
    bundle_id: '22222222-2222-4222-8222-222222222222',
  })
  await screen.findByRole('alert')
  expect(screen.queryByText('10,985')).not.toBeInTheDocument()
})
