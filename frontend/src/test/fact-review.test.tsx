import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { FactPanel } from '../features/evidence/fact-panel'
import { bundleSchema } from '../features/evidence/bundle-api'
import { SessionContext } from '../features/session/session-context'

const id = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const fid = '33333333-3333-4333-8333-333333333333'
const oid = '44444444-4444-4444-8444-444444444444'
const bundle = bundleSchema.parse({
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
  sources: [],
  coverage: [],
  limitations: [],
  baseline: null,
})
const candidate = {
  id: fid,
  root_id: fid,
  supersedes_id: null,
  revision: 1,
  version: 0,
  state: 'PENDING',
  model_eligible: false,
  origin: { kind: 'DUMP_AUDIT_CANDIDATE' },
  validation: {
    status: 'CITATIONS_VALID',
    normalized_amount: null,
    issues: [],
  },
  data: {
    category: 'audit',
    kind: 'audit_opinion',
    statement: '감사의견 적정',
    subject: '시험기업',
    direction: 'UNKNOWN',
    period: null,
    counterparty: null,
    amount_role: 'UNKNOWN',
    amount: null,
    maturity: null,
    status: '적정',
    detection: 'DETECTED',
    citations: [
      {
        segment_id: sid,
        field: 'statement',
        quote: '시험기업의 감사의견은 적정',
      },
    ],
  },
}
function mount() {
  render(
    <MemoryRouter>
      <SessionContext.Provider
        value={{
          phase: 'ready',
          session: { user_id: id, workspace_id: id, user_code: '00001' },
          message: '',
          change: vi.fn(),
          restore: vi.fn(),
          expire: vi.fn(),
        }}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <FactPanel bundle={bundle} />
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}
function mock({
  blocked = false,
  stale = false,
  metadata = {},
}: {
  blocked?: boolean
  stale?: boolean
  metadata?: Record<string, unknown>
} = {}) {
  let fact = structuredClone(candidate)
  Object.assign(fact.data, metadata)
  const calls: Record<string, unknown>[] = []
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const url = String(input)
      let body: unknown
      let status = 200
      if (url.endsWith('/fact-extraction'))
        body = { available: false, run: null }
      else if (url.includes('/facts?'))
        body = { facts: [fact], next_offset: null }
      else if (url.endsWith('/open'))
        body = {
          opening_id: oid,
          fact,
          current_validation: {
            status: blocked ? 'BLOCKED' : 'CITATIONS_VALID',
            normalized_amount: null,
            issues: [],
          },
          contexts: [
            {
              segment_id: sid,
              origin: 'dump',
              revision: id,
              sha256: 'hash',
              scope: 'OFS',
              title: '감사 자료',
              text: '<script>unsafe()</script>',
              cells: [['적정']],
              row_offset: 0,
              next_row_offset: null,
              text_offset: 0,
              next_text_offset: null,
              truncated_cells: false,
              source_url: null,
              citations: fact.data.citations,
            },
          ],
        }
      else if (url.endsWith('/reviews')) {
        calls.push(JSON.parse(String(init?.body)))
        if (stale) {
          status = 409
          body = { detail: 'fact_version_conflict' }
        } else {
          fact = { ...fact, state: 'APPROVED', version: 1 }
          body = { fact, reused: false }
        }
      } else if (url.includes('/fact-sources'))
        body = {
          segment_id: sid,
          origin: 'dump',
          revision: id,
          sha256: 'hash',
          scope: 'OFS',
          title: '감사 자료',
          text: '시험기업의 감사의견은 적정',
          cells: null,
          row_offset: 0,
          next_row_offset: null,
          text_offset: 0,
          next_text_offset: null,
          truncated_cells: false,
          source_url: null,
        }
      else
        body = {
          fact,
          reviews: fact.version
            ? [
                {
                  id: oid,
                  decision: 'APPROVE',
                  reason: '원문 확인',
                  reviewer_id: id,
                  version: 1,
                  created_at: '2026-11-01T00:00:00Z',
                },
              ]
            : [],
        }
      return new Response(JSON.stringify(body), { status })
    })
  return { calls, fetch }
}

it('shows the selected litigation metadata before a reviewer can approve', async () => {
  mock({
    metadata: {
      category: 'litigation',
      kind: 'litigation',
      statement: '손해배상 청구',
      direction: 'DEFENDANT',
      counterparty: '가나다시',
      filing_date: '2024-03-11',
      case_number: '2024가합100',
      case_note: '소송 결과를 예측할 수 없습니다.',
    },
  })
  mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: '소송 · 손해배상 청구 · 검수 대기',
    }),
  )
  const panel = await screen.findByRole('region', { name: '선택 사실 검수' })
  expect(within(panel).getByText('2024-03-11')).toBeInTheDocument()
  expect(within(panel).getByText('2024가합100')).toBeInTheDocument()
  expect(
    within(panel).getByText('소송 결과를 예측할 수 없습니다.'),
  ).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: '승인' })).toBeDisabled()
})

it('requires opening evidence and a reason, records approval and keeps model input withheld', async () => {
  const { calls } = mock()
  mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: '감사의견 · 감사의견 적정 · 검수 대기',
    }),
  )
  const panel = await screen.findByRole('region', { name: '선택 사실 검수' })
  expect(within(panel).getByRole('button', { name: '승인' })).toBeDisabled()
  await user.type(within(panel).getByLabelText('검수 사유'), '원문 확인')
  expect(within(panel).getByRole('button', { name: '승인' })).toBeDisabled()
  await user.click(
    within(panel).getByRole('button', { name: '인용 원문을 열고 검토' }),
  )
  expect(
    await within(panel).findByText('<script>unsafe()</script>'),
  ).toBeInTheDocument()
  expect(panel.querySelector('script')).toBeNull()
  await user.click(within(panel).getByRole('button', { name: '승인' }))
  await within(panel).findByText('검수 결정을 저장했습니다.')
  expect(calls).toEqual([
    expect.objectContaining({
      expected_version: 0,
      decision: 'APPROVE',
      opening_id: oid,
      reason: '원문 확인',
    }),
  ])
  expect(within(panel).getByText(/예측 모델 투입 보류/)).toBeInTheDocument()
  expect(within(panel).getByRole('button', { name: '승인' })).toBeDisabled()
})

it('blocks invalid evidence and exposes correction without carrying approval forward', async () => {
  mock({ blocked: true })
  mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: '감사의견 · 감사의견 적정 · 검수 대기',
    }),
  )
  await user.click(
    await screen.findByRole('button', { name: '인용 원문을 열고 검토' }),
  )
  await user.type(screen.getByLabelText('검수 사유'), '확인')
  expect(screen.getByRole('button', { name: '승인' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '수정본 작성' }))
  const form = await screen.findByRole('region', { name: '사실 후보 편집' })
  expect(
    within(form).getByRole('button', { name: '검수 대기로 저장' }),
  ).toBeInTheDocument()
  expect(within(form).getByLabelText('수정 사유')).toBeRequired()
})

it('shows stale review conflicts and offers an explicit refresh', async () => {
  mock({ stale: true })
  mount()
  const user = userEvent.setup()
  await user.click(
    await screen.findByRole('button', {
      name: '감사의견 · 감사의견 적정 · 검수 대기',
    }),
  )
  await user.click(
    await screen.findByRole('button', { name: '인용 원문을 열고 검토' }),
  )
  await user.type(screen.getByLabelText('검수 사유'), '확인')
  await user.click(screen.getByRole('button', { name: '승인' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '검수 상태가 바뀌었습니다.',
  )
  expect(
    screen.getByRole('button', { name: '검수 상태 새로고침' }),
  ).toBeInTheDocument()
})
