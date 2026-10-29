import { z } from 'zod'
import { request, ApiError } from '../session/api'
import { taskSchema } from '../tasks/task-state'

const contextSchema = z.object({
  corp_code: z.string().regex(/^\d{8}$/),
  receipt_no: z.string().regex(/^\d{14}$/),
  fiscal_year: z.string(),
  period: z.string(),
  report_name: z.string(),
  receipt_date: z.string(),
  scope: z.enum(['OFS', 'CFS']),
  lease: z.enum(['include', 'exclude']),
  refresh_key: z.string().nullable(),
})
export type FinancialContext = z.infer<typeof contextSchema>
const valueSchema = z.object({
  period: z.string(),
  value: z.string().nullable(),
  state: z.enum(['CONFIRMED', 'MISSING', 'NOT_COMPUTABLE']),
  reason: z.string().nullable(),
})
const factSchema = valueSchema.extend({
  key: z.string(),
  label: z.string(),
  currency: z.literal('KRW'),
  unit: z.literal('원'),
  mapping_method: z.string().nullable(),
  sources: z.array(z.record(z.string(), z.unknown())),
})
const metricSchema = z.object({
  key: z.string(),
  label: z.string(),
  group: z.string(),
  unit: z.string(),
  formula: z.string(),
  inputs: z.array(z.string()),
  basis: z.string(),
  values: z.array(valueSchema),
  change: z.string().nullable(),
  change_unit: z.string(),
})
export type FinancialMetric = z.infer<typeof metricSchema>
export const resultSchema = z.object({
  analysis_run_id: z.string().uuid(),
  context: contextSchema,
  company_name: z.string(),
  industry: z.string().nullable(),
  source_sha256: z.string(),
  source_url: z.string().url(),
  collected_at: z.string(),
  mapping_version: z.string(),
  formula_version: z.string(),
  periods: z.array(z.object({ key: z.string(), label: z.string() })),
  facts: z.array(factSchema),
  metrics: z.array(metricSchema),
  changes: z.record(
    z.string(),
    z.object({
      amount: z.string().nullable(),
      growth: z.string().nullable(),
      reason: z.string().nullable(),
      transition: z.string().nullable(),
    }),
  ),
  profit_bridge: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .nullable(),
  borrowing_totals: z.record(z.string(), z.string().nullable()),
  availability: z.enum(['AVAILABLE', 'NO_DATA']),
  comparison_basis: z.string(),
  note_state: z.enum(['NOT_COLLECTED', 'PROCESSED', 'FAILED']),
})
export type FinancialResult = z.infer<typeof resultSchema>
const runSchema = taskSchema.extend({
  analysis_run_id: z.string().uuid(),
  context: contextSchema,
  result: resultSchema.nullable(),
})
export async function getFinancialRun(id: string, signal: AbortSignal) {
  const run = runSchema.parse(
    await request(`/me/financial-analyses/${id}`, { signal }),
  )
  if (
    run.analysis_run_id !== id ||
    (run.result &&
      (run.result.analysis_run_id !== id ||
        run.result.context.corp_code !== run.context.corp_code ||
        run.result.context.receipt_no !== run.context.receipt_no ||
        run.result.context.scope !== run.context.scope ||
        run.result.context.lease !== run.context.lease))
  )
    throw new Error('financial_response_mismatch')
  return run
}
export async function startFinancialRun(
  input: Pick<
    FinancialContext,
    'corp_code' | 'receipt_no' | 'scope' | 'lease'
  > & { refresh_key?: string },
) {
  return taskSchema.extend({ analysis_run_id: z.string().uuid() }).parse(
    await request('/me/financial-analyses', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  )
}
export const reasonLabels: Record<string, string> = {
  construction_receivables_missing: '공사미수금 범위·기간 기준 미확보',
  pf_details_missing: 'PF 의무·잔액·만기 검증 자료 미확보',
  maturity_details_missing: '차입 만기 구간 검증 자료 미확보',
  funding_rate_details_missing: '차입별 금리·잔액 검증 자료 미확보',
  finance_cost_scope_unset: '금융비용 포함 범위 미정',
  account_not_found: '해당 계정 미확보',
  amount_not_disclosed: '금액 미기재',
  ambiguous_account: '계정 중복·범위 확인 필요',
  unsupported_currency: '원화 이외 통화 · 환산 보류',
  missing_input: '필수 계정 미확보',
  nonpositive_denominator: '분모 0 또는 음수 · 비율 보류',
  balance_policy_unset: '기말/평균잔액 기준 미정',
  balance_days_policy_unset: '잔액·기간 일수·첫해 정책 미정',
  ebitda_policy_unset: 'EBITDA 구성·상각 중복 검증 필요',
  cash_coverage_policy_unset: '현금보상 산식 정책 미정',
  capex_policy_unset: '투자 지출 포함 범위 미정',
  financial_receipt_mismatch:
    'API가 선택한 공시와 다른 정정본을 반환했습니다. 최신 보고서를 다시 선택해 주세요.',
  financial_latest_receipt_required:
    '해당 기간의 최신 정정 보고서를 선택해 주세요.',
  financial_download_failed: '재무제표를 내려받지 못했습니다.',
  financial_rate_limited: 'DART 요청 한도를 초과했습니다.',
  financial_api_error:
    'DART 재무정보 응답 오류입니다. 서버의 API 키와 제공 상태를 확인해 주세요.',
  financial_response_invalid:
    '재무 응답의 형식·회계 범위·기간을 확인하지 못했습니다.',
  financial_company_mismatch: '응답의 기업이 선택한 기업과 다릅니다.',
  financial_year_unsupported:
    '정형 재무 API는 2015년 이후 사업연도를 지원합니다.',
  dart_api_key_missing: '서버에 DART API 키를 설정해 주세요.',
  job_policy_not_configured: '서버 작업 재시도 정책을 설정해 주세요.',
}
export function financialError(error: unknown) {
  return error instanceof ApiError
    ? (reasonLabels[error.detail] ?? '재무 분석 요청을 처리하지 못했습니다.')
    : '재무 데이터를 확인하지 못했습니다. 다시 시도해 주세요.'
}
export function money(value: string | null | undefined) {
  return value == null
    ? '—'
    : (Number(value) / 100_000_000).toLocaleString('ko-KR', {
        maximumFractionDigits: 2,
      })
}
export function metricValue(value: string | null | undefined, unit: string) {
  return value == null
    ? '—'
    : `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${unit}`
}
