import { z } from 'zod'
import { request } from '../session/api'

const nodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  parent_id: z.string().nullable(),
  level: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  review_flags: z.array(z.unknown()).nullable().optional(),
})
export const noteStructureSchema = z.object({
  structure_id: z.string().uuid(),
  status: z.string(),
  stage: z.string(),
  corp_code: z.string(),
  company_name: z.string().nullable().optional(),
  receipt_no: z.string(),
  scope: z.enum(['OFS', 'CFS']),
  period: z.string(),
  source_sha256: z.string(),
  source_bytes: z.number(),
  parser_version: z.string(),
  input_origin: z.string(),
  segment_count: z.number().nullable(),
  hierarchy: z
    .object({ nodes: z.array(nodeSchema) })
    .passthrough()
    .nullable(),
  evidence_verified: z.boolean(),
})
export type NoteStructure = z.infer<typeof noteStructureSchema>
export type NoteNode = z.infer<typeof nodeSchema>
const segmentSchema = z.object({
  id: z.string().uuid(),
  local_id: z.string(),
  ordinal: z.number(),
  kind: z.string(),
  source_xpath: z.string(),
  text: z.string(),
  owner_node_id: z.string(),
  table_data: z
    .object({ display_title: z.string().nullable().optional() })
    .passthrough()
    .nullable(),
})
export type NoteSegment = z.infer<typeof segmentSchema>
const segmentPageSchema = z.object({
  segments: z.array(segmentSchema),
  total: z.number(),
  next_after: z.number().nullable(),
})
const sourceViewSchema = z.object({
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  html: z.string(),
  anchors: z.record(z.string(), z.string()),
  view_kind: z.literal('derived'),
})
export type SourceView = z.infer<typeof sourceViewSchema>

export async function getNoteStructure(id: string, signal: AbortSignal) {
  const data = noteStructureSchema.parse(
    await request(`/me/note-imports/${id}`, { signal }),
  )
  if (data.structure_id !== id) throw new Error('Structure response mismatch')
  return data
}
export async function getNoteSegments(
  id: string,
  after: number,
  filters: { node: string; q: string; tables: boolean },
  signal: AbortSignal,
) {
  const params = new URLSearchParams({ after: String(after), limit: '30' })
  if (filters.node) params.set('node_id', filters.node)
  if (filters.q) params.set('q', filters.q)
  if (filters.tables) params.set('tables_only', 'true')
  return segmentPageSchema.parse(
    await request(`/me/note-imports/${id}/segments?${params}`, { signal }),
  )
}
export async function getNoteSegment(
  id: string,
  segmentId: string,
  signal: AbortSignal,
) {
  return segmentSchema.parse(
    await request(`/me/note-imports/${id}/segments/${segmentId}`, { signal }),
  )
}
export async function getNoteSource(id: string, signal: AbortSignal) {
  const data = sourceViewSchema.parse(
    await request(`/me/note-imports/${id}/source-view`, { signal }),
  )
  if (data.structure_id !== id) throw new Error('Source response mismatch')
  return data
}
