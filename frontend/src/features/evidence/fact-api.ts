import { z } from 'zod'
import { request } from '../session/api'

export const kinds = {
  audit_opinion: ['audit', '감사의견'],
  going_concern: ['audit', '계속기업'],
  borrowing_maturity: ['borrowing', '차입금 만기'],
  covenant: ['borrowing', '약정'],
  credit_rating: ['credit', '신용등급'],
  collateral: ['collateral', '담보'],
  litigation: ['litigation', '소송'],
  sanction: ['litigation', '제재'],
  guarantee: ['off_balance', '보증'],
  subsequent_event: ['off_balance', '후속 사건'],
} as const
export const fields = {
  statement: '사실 설명',
  subject: '대상',
  direction: '방향',
  period: '기준 기간',
  counterparty: '상대방',
  amount: '금액',
  unit: '단위',
  currency: '통화',
  maturity: '만기',
  status: '상태',
  absence: '명시적 없음',
  amount_role: '금액 역할',
  obligation_type: '보증·의무 유형',
  aggregation_level: '상세·합계 구분',
  project_count: '사업장 수',
  case_number: '사건번호',
  case_count: '공시 소송 건수',
  filing_date: '소제기일',
  case_note: '소송 관련 원문 설명',
  maturity_bucket: '공시 만기 구간',
  loan_period: '대출기간',
} as const
const citation = z.object({
  segment_id: z.string().uuid(),
  field: z.enum(
    Object.keys(fields) as [keyof typeof fields, ...Array<keyof typeof fields>],
  ),
  quote: z.string(),
})
export const factDataSchema = z.object({
  category: z.string(),
  kind: z.enum(
    Object.keys(kinds) as [keyof typeof kinds, ...Array<keyof typeof kinds>],
  ),
  statement: z.string(),
  subject: z.string(),
  direction: z.string(),
  period: z.string().nullable(),
  counterparty: z.string().nullable(),
  amount_role: z.string(),
  amount: z
    .object({
      raw_value: z.string(),
      currency: z.string(),
      unit: z.string(),
      cell: z.object({
        segment_id: z.string().uuid(),
        row: z.number(),
        column: z.number(),
      }),
    })
    .nullable(),
  maturity: z.string().nullable(),
  status: z.string().nullable(),
  detection: z.string(),
  citations: z.array(citation),
  obligation_type: z.string().nullable().optional(),
  aggregation_level: z.string().optional(),
  project_count: z.number().nullable().optional(),
  case_number: z.string().nullable().optional(),
  case_count: z.number().nullable().optional(),
  filing_date: z.string().nullable().optional(),
  case_note: z.string().nullable().optional(),
  maturity_bucket: z.string().nullable().optional(),
  loan_period: z.string().nullable().optional(),
})
const validation = z.object({
  status: z.enum(['BLOCKED', 'CITATIONS_VALID']),
  issues: z.array(
    z.object({ field: z.string(), code: z.string(), message: z.string() }),
  ),
  normalized_amount: z.string().nullable(),
})
export const factSchema = z.object({
  id: z.string().uuid(),
  root_id: z.string().uuid(),
  supersedes_id: z.string().uuid().nullable(),
  revision: z.number(),
  version: z.number(),
  state: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']),
  data: factDataSchema,
  validation,
  origin: z.record(z.string(), z.unknown()),
  model_eligible: z.literal(false),
  related: z
    .array(
      z.object({ id: z.string(), state: z.string(), relation: z.string() }),
    )
    .optional(),
})
export const factListSchema = z.object({
  facts: z.array(factSchema),
  next_offset: z.number().nullable(),
})
export const historySchema = z.object({
  fact: factSchema,
  revisions: z
    .array(
      z.object({
        id: z.string().uuid(),
        revision: z.number(),
        state: z.string(),
      }),
    )
    .default([]),
  reviews: z.array(
    z.object({
      id: z.string(),
      decision: z.string(),
      reason: z.string(),
      reviewer_id: z.string(),
      version: z.number(),
      created_at: z.string(),
    }),
  ),
})
export const sourceSchema = z.object({
  segment_id: z.string().uuid(),
  origin: z.string(),
  revision: z.string(),
  sha256: z.string(),
  scope: z.string(),
  title: z.string(),
  text: z.string(),
  source_url: z.string().nullable(),
  cells: z.array(z.array(z.string())).nullable(),
  row_offset: z.number(),
  next_row_offset: z.number().nullable(),
  text_offset: z.number(),
  next_text_offset: z.number().nullable(),
  truncated_cells: z.boolean(),
  citations: z.array(citation).optional(),
})
export const openingSchema = z.object({
  opening_id: z.string().uuid(),
  fact: factSchema,
  current_validation: validation,
  contexts: z.array(sourceSchema),
})
export const extractionSchema = z.object({
  available: z.boolean(),
  run: z
    .object({
      status: z.string(),
      error_code: z.string().nullable(),
      result: z
        .object({
          execution_status: z.string(),
          candidate_count: z.number().optional(),
          limitations: z.string().optional(),
          stop_reason: z.string().optional(),
        })
        .nullable(),
    })
    .nullable(),
})
export type Fact = z.infer<typeof factSchema>
export type FactData = z.infer<typeof factDataSchema>
export type FactSource = z.infer<typeof sourceSchema>
export const factPath = (bundle: string) => `/me/evidence-bundles/${bundle}`
export const postFact = (bundle: string, suffix: string, body?: unknown) =>
  request(`${factPath(bundle)}${suffix}`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
