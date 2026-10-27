import { z } from 'zod'
import {
  contextKey,
  demoVersions,
  type DemoContext,
} from '../analysis/demo-context'
import { evidenceRevision, findSource } from '../evidence/demo-evidence'
import { signals } from '../risk/demo-signals'

export const paragraphIds = [
  'core',
  'change',
  'evidence',
  'risk',
  'followup',
] as const
export const paragraphLabels: Record<(typeof paragraphIds)[number], string> = {
  core: '핵심 수치',
  change: '실적 변동',
  evidence: '주석 근거',
  risk: '위험징후·예측',
  followup: '추가 확인',
}
const paragraphSchema = z.object({
  id: z.enum(paragraphIds),
  text: z.string(),
  generatedText: z.string(),
  edited: z.boolean(),
})
export const draftSchema = z.object({
  generation: z.number().int().positive(),
  paragraphs: z
    .array(paragraphSchema)
    .refine(
      (paragraphs) =>
        paragraphs.length === paragraphIds.length &&
        new Set(paragraphs.map((paragraph) => paragraph.id)).size ===
          paragraphIds.length,
    ),
  opinion: z.string(),
})
export type ReviewDraft = z.infer<typeof draftSchema>
const checksSchema = z
  .object({
    viewed: z
      .array(z.string())
      .refine(
        (ids) =>
          new Set(ids).size === ids.length &&
          ids.every((id) => !!findSource(id)),
      ),
    confirmed: z
      .array(z.string())
      .refine(
        (ids) =>
          new Set(ids).size === ids.length &&
          ids.every((id) => signals.some((signal) => signal.id === id)),
      ),
  })
  .refine((checks) =>
    checks.confirmed.every((id) => {
      const signal = signals.find((item) => item.id === id)
      return (
        !!signal &&
        (signal.severity !== '경고' || checks.viewed.includes(signal.sourceId))
      )
    }),
  )
export type ReviewChecks = z.infer<typeof checksSchema>
const metadata = {
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  context: z.string(),
  savedAt: z.string().datetime(),
  evidenceRevision: z.literal(evidenceRevision),
}
const draftEntrySchema = z.object({
  ...metadata,
  value: draftSchema,
  action: z.enum(['save', 'regenerate-keep', 'regenerate-all', 'merge']),
})
const checkEntrySchema = z.object({ ...metadata, value: checksSchema })
export type DraftEntry = z.infer<typeof draftEntrySchema>
export type CheckEntry = z.infer<typeof checkEntrySchema>
export class ReviewConflictError extends Error {}

export function reviewKey(context: DemoContext, kind: 'draft' | 'checks') {
  return `loansight.demo.review.v1.${contextKey(context)}.${evidenceRevision}.${kind}`
}
function parseJournal<T>(key: string, schema: z.ZodType<T>) {
  const raw = localStorage.getItem(key)
  return raw ? z.array(schema).parse(JSON.parse(raw)) : []
}
export function readDrafts(context: DemoContext) {
  const key = reviewKey(context, 'draft')
  const entries = parseJournal(key, draftEntrySchema)
  if (entries.some((entry) => entry.context !== key))
    throw new Error('검토 기준 불일치')
  return entries
}
export function readChecks(context: DemoContext) {
  const key = reviewKey(context, 'checks')
  const entries = parseJournal(key, checkEntrySchema)
  if (entries.some((entry) => entry.context !== key))
    throw new Error('근거 기준 불일치')
  return entries
}
function append<T extends { id: string }>(
  key: string,
  current: T[],
  expectedId: string | null,
  entry: T,
) {
  if ((current.at(-1)?.id ?? null) !== expectedId)
    throw new ReviewConflictError('최신 저장본과 기반 revision이 다릅니다.')
  localStorage.setItem(key, JSON.stringify([...current, entry]))
  return entry
}
function meta(key: string, parentId: string | null) {
  return {
    id: crypto.randomUUID(),
    parentId,
    context: key,
    savedAt: new Date().toISOString(),
    evidenceRevision,
  }
}
export function saveDraft(
  context: DemoContext,
  expectedId: string | null,
  value: ReviewDraft,
  action: DraftEntry['action'] = 'save',
) {
  const key = reviewKey(context, 'draft')
  return append(
    key,
    readDrafts(context),
    expectedId,
    draftEntrySchema.parse({ ...meta(key, expectedId), value, action }),
  )
}
export function saveChecks(
  context: DemoContext,
  expectedId: string | null,
  value: ReviewChecks,
) {
  const key = reviewKey(context, 'checks')
  return append(
    key,
    readChecks(context),
    expectedId,
    checkEntrySchema.parse({ ...meta(key, expectedId), value }),
  )
}
export function initialDraft(
  context: DemoContext,
  opinion = '',
  generation = 1,
): ReviewDraft {
  const texts = {
    core: '2025 공통 레이아웃 예시: 매출액 1,250억원, 영업이익 100억원, 영업활동현금흐름 89억원. 실제 기업·선택 기간의 수집 결과가 아닙니다.',
    change:
      '예시 영업이익은 94억원에서 100억원으로 변동합니다. 매출 증가 +60, 원가 증가 −42, 판관비 증가 −12억원의 회계상 분해이며 경영 원인을 단정하지 않습니다.',
    evidence:
      '예시 주석 21에 약정 위반 사유 발생 문구, 주석 34에 제공 보증한도 60억원·잔액 40억원이 있습니다. 실제 접수번호는 미연동이며 가상 원문입니다.',
    risk: '경고·주의·관찰 각 1건은 필터와 확인 흐름을 위한 고정 예시입니다. 실제 규칙 평가가 아닙니다. 외부 모델 미연동으로 12개월 위험 확률은 표시 보류합니다.',
    followup: `${context.industry} 업종의 실제 원문, 약정 유예·차환 조건, 보증의 이행 청구 여부와 내부 자료를 추가 확인해야 합니다. 최종 여신 판단은 담당자가 수행합니다.`,
  }
  return {
    generation,
    opinion,
    paragraphs: paragraphIds.map((id) => ({
      id,
      text: texts[id],
      generatedText: texts[id],
      edited: false,
    })),
  }
}
export async function regenerateDemoDraft(
  context: DemoContext,
  current: ReviewDraft,
  mode: 'keep' | 'all',
) {
  const next = initialDraft(context, current.opinion, current.generation + 1)
  if (mode === 'keep')
    next.paragraphs = next.paragraphs.map(
      (paragraph) =>
        current.paragraphs.find(
          (item) => item.id === paragraph.id && item.edited,
        ) ?? paragraph,
    )
  return next
}
export function copyReview(
  context: DemoContext,
  draft: ReviewDraft,
  checks: ReviewChecks | null,
) {
  return [
    '[가상 예시 검토 기록 · 실제 분석/AI 생성 아님]',
    `${context.companyName} / ${context.report} 사업보고서 / ${context.scope} / 리스부채 ${context.lease === 'include' ? '포함' : '제외'}`,
    `출처 ${demoVersions.source} / 산식 ${demoVersions.financial} / 규칙 ${demoVersions.rule} / 근거 ${evidenceRevision} / 모델 미연동`,
    '접수번호: 미연동. 아래 위치는 가상 원문의 위치입니다.',
    ...draft.paragraphs.map(
      (paragraph) => `${paragraphLabels[paragraph.id]}\n${paragraph.text}`,
    ),
    '담당자 확인 (로컬 예시)',
    ...signals.map(
      (signal) =>
        `${signal.severity} · ${signal.title} · ${checks === null ? '확인 기록 조회 실패' : checks.confirmed.includes(signal.id) ? '확인 완료' : '미확인'} · ${findSource(signal.sourceId)!.location}`,
    ),
    `담당자 의견\n${draft.opinion}`,
  ].join('\n\n')
}
