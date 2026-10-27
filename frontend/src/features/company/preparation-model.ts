import { z } from 'zod'
import { industries } from './demo-data'

// Demo form rules, not the production manual-input/API contract.
const amountPattern = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/
const amountSchema = z
  .string()
  .trim()
  .refine(
    (value) => value === '' || amountPattern.test(value),
    '숫자를 입력해 주세요. 음수·소수와 세 자리 쉼표를 사용할 수 있습니다.',
  )

function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export const manualSchema = z
  .object({
    disclosureUnavailable: z
      .boolean()
      .refine((value) => value, '예시의 공시 조회 불가 상황을 확인해 주세요.'),
    source: z.string().trim().min(1, '출처를 입력해 주세요.'),
    asOf: z
      .string()
      .refine(isCalendarDate, '유효한 재무 기준일을 입력해 주세요.'),
    revenue: amountSchema,
    operatingProfit: amountSchema,
    operatingCashflow: amountSchema,
  })
  .refine(
    (value) =>
      [value.revenue, value.operatingProfit, value.operatingCashflow].some(
        (amount) => amount !== '',
      ),
    {
      path: ['revenue'],
      message:
        '예시 금액을 하나 이상 입력해 주세요. 빈칸은 0으로 저장하지 않습니다.',
    },
  )

export const overrideSchema = z
  .object({
    previousIndustry: z.enum(industries).nullable(),
    industry: z.enum(industries, { error: '변경할 업종을 선택해 주세요.' }),
    reason: z.string().trim().min(1, '변경 사유를 입력해 주세요.'),
    evidence: z.string().trim().min(1, '변경 근거를 입력해 주세요.'),
  })
  .refine((value) => value.industry !== value.previousIndustry, {
    path: ['industry'],
    message: '현재 초안과 다른 업종을 선택해 주세요.',
  })

export type ManualDraft = z.infer<typeof manualSchema>
export type OverrideDraft = z.infer<typeof overrideSchema>

const metadata = {
  id: z.string().uuid(),
  context: z.string(),
  savedAt: z.string().datetime(),
  actor: z.literal('브라우저 데모 사용자'),
}
const entrySchema = z.discriminatedUnion('kind', [
  z.object({ ...metadata, kind: z.literal('manual'), value: manualSchema }),
  z.object({ ...metadata, kind: z.literal('industry'), value: overrideSchema }),
])
export type PreparationEntry = z.infer<typeof entrySchema>
export type NewPreparationEntry =
  | { kind: 'manual'; value: ManualDraft }
  | { kind: 'industry'; value: OverrideDraft }

export function preparationKey(
  companyId: string,
  report: string,
  scope: string,
) {
  return `loansight.demo.preparation.v1.${companyId}.${report}.${scope}`
}

export function readPreparation(key: string): PreparationEntry[] {
  const raw = localStorage.getItem(key)
  if (!raw) return []
  const entries = z.array(entrySchema).parse(JSON.parse(raw))
  if (entries.some((entry) => entry.context !== key))
    throw new Error('초안 기준 불일치')
  return entries
}

export class DraftConflictError extends Error {}

export function appendPreparation(
  key: string,
  expectedLastId: string | null,
  draft: NewPreparationEntry,
): PreparationEntry[] {
  const current = readPreparation(key)
  if ((current.at(-1)?.id ?? null) !== expectedLastId) {
    throw new DraftConflictError('다른 화면에서 초안이 변경되었습니다.')
  }
  const entry = entrySchema.parse({
    ...draft,
    id: crypto.randomUUID(),
    context: key,
    savedAt: new Date().toISOString(),
    actor: '브라우저 데모 사용자',
  })
  const next = [...current, entry]
  localStorage.setItem(key, JSON.stringify(next))
  return next
}

// String normalization avoids rounding large monetary values or treating missing as zero.
export function canonicalAmount(value: string) {
  if (value.trim() === '') return null
  if (!amountPattern.test(value.trim())) return null
  const [integer, fraction = ''] = value.trim().replaceAll(',', '').split('.')
  const normalizedInteger = BigInt(integer).toString()
  const normalizedFraction = fraction.replace(/0+$/, '')
  const sign =
    integer.startsWith('-') &&
    normalizedInteger === '0' &&
    normalizedFraction !== ''
      ? '-'
      : ''
  return `${sign}${normalizedInteger}${normalizedFraction ? `.${normalizedFraction}` : ''}`
}

export const manualAccounts = [
  { key: 'revenue', label: '매출액', fixture: '1250' },
  { key: 'operatingProfit', label: '영업이익', fixture: '100' },
  { key: 'operatingCashflow', label: '영업활동현금흐름', fixture: '89' },
] as const
