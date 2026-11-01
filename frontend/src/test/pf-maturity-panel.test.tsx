import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { PfMaturityPanel } from '../features/risk/pf-maturity-panel'
import {
  SessionContext,
  type SessionState,
} from '../features/session/session-context'
import { bundleSchema } from '../features/evidence/bundle-api'
import { exposureFixture } from '../../e2e/exposure-fixture'

vi.mock('../shared/components/chart', () => ({
  Chart: ({
    label,
    onClick,
  }: {
    label: string
    onClick?: (event: { name: string }) => void
  }) => (
    <div role="img" aria-label={label}>
      <button onClick={() => onClick?.({ name: '3개월' })}>
        3개월 구간 선택
      </button>
    </div>
  ),
}))
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
  phase: 'ready',
  session: { user_id: id, workspace_id: id, user_code: '00001' },
  message: '',
  change: vi.fn(),
  restore: vi.fn(),
  expire: vi.fn(),
}
function mount(body: unknown, status = 200) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status }),
  )
  return render(
    <SessionContext.Provider value={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[`/evidence/${id}/evidence?tab=signals`]}>
          <PfMaturityPanel bundle={bundle} />
        </MemoryRouter>
      </QueryClientProvider>
    </SessionContext.Provider>,
  )
}

it('includes undisclosed amounts in the denominator and filters sources by the chosen band', async () => {
  mount(exposureFixture(bundle))
  const chart = await screen.findByRole('img')
  expect(chart).toHaveAttribute(
    'aria-label',
    expect.stringContaining('만기 미공시 810억원'),
  )
  const panel = screen.getByRole('region', {
    name: 'PF 보증·조건부 의무 만기 사다리',
  })
  expect(panel).toHaveTextContent('1년 내 만기 5,010억원 (46%)')
  expect(panel).toHaveTextContent('전체 10,985억원')
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '3개월 구간 선택' }))
  const table = within(panel).getByRole('table', { name: '상세 만기 사다리' })
  expect(within(table).getAllByRole('row')).toHaveLength(2)
  expect(table).toHaveTextContent('1,610')
  expect(
    within(panel).getByRole('link', { name: '소송 현황 보기 →' }),
  ).toHaveAttribute(
    'href',
    expect.stringContaining('tab=notes#evidence-litigation'),
  )
})

it('labels loan-period recalculation', async () => {
  const body = exposureFixture(bundle)
  mount({
    ...body,
    maturity_ladder: {
      ...body.maturity_ladder,
      state: 'RECALCULATED',
      basis: ['LOAN_PERIOD'],
    },
  })
  await screen.findByRole('img')
  expect(
    screen.getByRole('region', { name: 'PF 보증·조건부 의무 만기 사다리' }),
  ).toHaveTextContent('대출기간으로 계산')
})

it.each([
  ['UNDISCLOSED', '공시상 만기 미기재'],
  ['MATURITY_UNCONFIRMED', '만기 근거 미확보'],
])(
  'keeps all-unknown maturity separate from zero percent: %s',
  async (state, title) => {
    const body = exposureFixture(bundle)
    mount({
      ...body,
      maturity_ladder: {
        ...body.maturity_ladder,
        state,
        within_amount: null,
        within_percent: null,
        items: [body.maturity_ladder.items[6]],
      },
    })
    await screen.findByRole('heading', { name: title })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(
      screen.getByRole('region', { name: 'PF 보증·조건부 의무 만기 사다리' }),
    ).toHaveTextContent('1년 내 만기 비중 계산 불가')
  },
)

it('shows no-provided-guarantee only from an explicit absence state', async () => {
  const body = exposureFixture(bundle)
  mount({
    ...body,
    maturity_ladder: {
      ...body.maturity_ladder,
      state: 'EXPLICIT_NONE',
      items: [],
      total: null,
      known_total: null,
      within_amount: null,
      within_percent: null,
      absence_quotes: [
        { quote: '제공한 지급보증은 해당사항 없음', sources: [] },
      ],
    },
  })
  await screen.findByRole('heading', { name: '공시상 제공 보증 없음' })
  expect(
    screen.getByText('“제공한 지급보증은 해당사항 없음”'),
  ).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
})

it('keeps a failed query separate from a public absence', async () => {
  mount({ detail: 'unavailable' }, 500)
  await screen.findByRole('alert')
  expect(
    screen.queryByRole('heading', { name: '공시상 제공 보증 없음' }),
  ).not.toBeInTheDocument()
})
