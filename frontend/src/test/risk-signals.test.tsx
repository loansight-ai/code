import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { expect, it, vi } from 'vitest'
import { bundleSchema } from '../features/evidence/bundle-api'
import { LiveSignals } from '../features/risk/live-signals'
import { SessionContext } from '../features/session/session-context'

const id = '11111111-1111-4111-8111-111111111111'
const fid = '22222222-2222-4222-8222-222222222222'
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
const result = {
  bundle_id: id,
  input_revision: 'input-v1',
  registry_revision: 'registry-v1',
  version: 'signals-v1',
  evaluation_status: 'DEFINITION_PENDING',
  ready_inputs: 1,
  total_facts: 1,
  next_offset: null,
  categories: [
    {
      key: 'collateral',
      title: '담보',
      status: 'DEFINITION_PENDING',
      ready_inputs: 1,
      configured_rules: 0,
      states: { READY: 1 },
    },
  ],
  facts: [
    {
      fact_id: fid,
      revision: 1,
      version: 1,
      category: 'collateral',
      kind: 'collateral',
      statement: '담보 제공 기재',
      period: '2025.12',
      gate: 'READY',
      detection: 'DETECTED',
      model_eligible: false,
    },
  ],
  evaluations: [],
  severity_counts: {},
  limitations: ['상세 규칙은 미확정입니다.'],
  model_eligible: false,
}
function mount(data: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(data), { status: 200 }),
  )
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
          <LiveSignals bundle={bundle} />
        </QueryClientProvider>
      </SessionContext.Provider>
    </MemoryRouter>,
  )
}

it('keeps approved evidence waiting for definitions without displaying zero-risk grades', async () => {
  mount(result)
  expect(
    await screen.findByText(/규칙 정의 대기 · 입력 준비 1\/1/),
  ).toBeInTheDocument()
  expect(screen.queryByText(/경고 0건/)).not.toBeInTheDocument()
  expect(screen.queryByText('정상')).not.toBeInTheDocument()
  expect(screen.getByText('예측 모델 입력 보류')).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: '사실·검수 근거 보기' }),
  ).toBeInTheDocument()
})

it('shows source changes as withheld inputs and does not infer an event from a mention', async () => {
  mount({
    ...result,
    ready_inputs: 0,
    facts: [{ ...result.facts[0], gate: 'SOURCE_CHANGED' }],
  })
  expect(await screen.findByText(/원문 변경 · 재검수 필요/)).toBeInTheDocument()
  expect(
    screen.getByText('기재된 사실 · 사건 발생 여부는 규칙 정의에 따라 구분'),
  ).toBeInTheDocument()
})

it('rejects a response for a different bundle', async () => {
  mount({ ...result, bundle_id: fid })
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '규칙 입력을 확인하지 못했습니다.',
  )
  expect(screen.queryByText('담보 제공 기재')).not.toBeInTheDocument()
})
