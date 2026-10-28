import { z } from 'zod'
import { request } from '../session/api'

const excerpt = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  truncated: z.boolean(),
})
const candidate = z.object({
  segment_id: z.string().uuid(),
  ordinal: z.number(),
  kind: z.string(),
  owner_node_id: z.string(),
  section_path: z.array(z.object({ id: z.string(), title: z.string() })),
  excerpt,
  matches: z.array(z.object({ term: z.string(), fields: z.array(z.string()) })),
  source_url: z.string(),
  table_title: z.string().nullable(),
})
const searchPage = z.object({
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  total: z.number(),
  candidates: z.array(candidate),
  next_offset: z.number().nullable(),
  truncated: z.boolean(),
})
const item = z.object({
  key: z.string(),
  title: z.string(),
  terms: z.array(z.string()),
  mode: z.literal('ANY'),
  search_status: z.literal('COMPLETED'),
  candidate_status: z.enum(['MATCHED', 'NO_MATCH']),
  total: z.number(),
  candidates: z.array(candidate),
  truncated: z.boolean(),
  next_offset: z.number().nullable(),
  unavailable_regions: z.array(z.string()),
  review_status: z.literal('PENDING'),
})
const baseline = z.object({
  run_id: z.string().uuid(),
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  created_at: z.string(),
  dictionary_version: z.string(),
  dictionary_status: z.literal('DRAFT'),
  execution_kind: z.literal('BASELINE_KEYWORD'),
  execution_status: z.literal('COMPLETED'),
  report_coverage: z.literal('PARTIAL'),
  agent_status: z.literal('NOT_RUN'),
  evidence_verified: z.literal(false),
  items: z.array(item).length(6),
})
export type SearchCandidate = z.infer<typeof candidate>
export type BaselineItem = z.infer<typeof item>
export type SearchPage = z.infer<typeof searchPage>
export type Baseline = z.infer<typeof baseline>

function check<T extends { structure_id: string; source_sha256: string }>(
  data: T,
  id: string,
  hash: string,
) {
  if (data.structure_id !== id || data.source_sha256 !== hash)
    throw new Error('Search source mismatch')
  return data
}

export async function getBaseline(
  id: string,
  hash: string,
  signal: AbortSignal,
) {
  const data = z
    .object({ run: baseline.nullable() })
    .parse(await request(`/me/note-imports/${id}/search/baseline`, { signal }))
  return data.run ? check(data.run, id, hash) : null
}
export async function startBaseline(id: string, hash: string) {
  return check(
    baseline.parse(
      await request(`/me/note-imports/${id}/search/baseline`, {
        method: 'POST',
      }),
    ),
    id,
    hash,
  )
}
export async function searchMore(
  id: string,
  hash: string,
  terms: string[],
  offset: number,
  signal: AbortSignal,
) {
  return check(
    searchPage.parse(
      await request(`/me/note-imports/${id}/search/segments`, {
        method: 'POST',
        signal,
        body: JSON.stringify({ terms, mode: 'ANY', limit: 5, offset }),
      }),
    ),
    id,
    hash,
  )
}
