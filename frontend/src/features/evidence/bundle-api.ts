import { z } from 'zod'
import { request } from '../session/api'

export const bundleCandidate = z.object({
  segment_id: z.string().uuid(),
  kind: z.string(),
  origin: z.enum(['html', 'dump']),
  region: z.string(),
  scope: z.string(),
  source_revision: z.string(),
  sha256: z.string(),
  section_path: z.array(z.object({ id: z.string(), title: z.string() })),
  excerpt: z.object({
    text: z.string(),
    start: z.number(),
    end: z.number(),
    truncated: z.boolean(),
  }),
  location: z.record(z.string(), z.unknown()),
  source_url: z.string().nullable(),
  body_skipped: z.boolean().optional(),
  content_available: z.boolean().optional(),
})
const searchSchema = z.object({
  bundle_id: z.string().uuid(),
  bundle_revision: z.string(),
  total: z.number(),
  candidates: z.array(bundleCandidate),
  next_offset: z.number().nullable(),
})
const baselineSchema = z.object({
  bundle_id: z.string().uuid(),
  bundle_revision: z.string(),
  items: z
    .array(
      searchSchema.extend({
        key: z.string(),
        title: z.string(),
        terms: z.array(z.string()),
        candidate_status: z.string(),
        unavailable_regions: z.array(z.string()),
      }),
    )
    .length(6),
})
export const bundleSchema = z.object({
  bundle_id: z.string().uuid(),
  bundle_revision: z.string(),
  corp_code: z.string(),
  receipt_no: z.string(),
  scope: z.enum(['OFS', 'CFS']),
  period: z.string(),
  company_name: z.string().nullable(),
  review_status: z.literal('PENDING'),
  evidence_verified: z.literal(false),
  model_input_status: z.literal('WITHHELD_UNVERIFIED'),
  collection_import_id: z.string().uuid().nullable(),
  sources: z.array(
    z.object({
      origin: z.enum(['html', 'dump']),
      structure_id: z.string().optional(),
      archive: z.string().optional(),
    }),
  ),
  coverage: z.array(
    z.object({
      region: z.string(),
      scope: z.string(),
      segments: z.number(),
      nonempty: z.number(),
    }),
  ),
  limitations: z.array(z.string()),
  baseline: baselineSchema.nullable(),
})
export type EvidenceBundle = z.infer<typeof bundleSchema>
export type BundleCandidate = z.infer<typeof bundleCandidate>

function check<T extends { bundle_id: string; bundle_revision: string }>(
  value: T,
  bundle: EvidenceBundle,
) {
  if (
    value.bundle_id !== bundle.bundle_id ||
    value.bundle_revision !== bundle.bundle_revision
  )
    throw new Error('Evidence bundle response mismatch')
  return value
}
export async function getBundle(id: string, signal: AbortSignal) {
  const value = bundleSchema.parse(
    await request(`/me/evidence-bundles/${id}`, { signal }),
  )
  if (value.bundle_id !== id)
    throw new Error('Evidence bundle response mismatch')
  return value
}
export async function openBundle(
  corp: string,
  receipt: string,
  scope: string,
  structure?: string,
  signal?: AbortSignal,
) {
  const value = bundleSchema.parse(
    await request('/me/evidence-bundles', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        corp_code: corp,
        receipt_no: receipt,
        scope,
        ...(structure ? { structure_ids: [structure] } : {}),
      }),
    }),
  )
  if (
    value.corp_code !== corp ||
    value.receipt_no !== receipt ||
    value.scope !== scope
  )
    throw new Error('Evidence report response mismatch')
  return value
}
export async function searchBundle(
  bundle: EvidenceBundle,
  terms: string[],
  offset: number,
  node?: string,
  origin?: 'html' | 'dump',
) {
  return check(
    searchSchema.parse(
      await request(`/me/evidence-bundles/${bundle.bundle_id}/search`, {
        method: 'POST',
        body: JSON.stringify({
          terms,
          offset,
          limit: 10,
          ...(node ? { node_id: node } : {}),
          ...(origin ? { origin } : {}),
        }),
      }),
    ),
    bundle,
  )
}
export async function baselineBundle(bundle: EvidenceBundle) {
  return check(
    baselineSchema.parse(
      await request(`/me/evidence-bundles/${bundle.bundle_id}/baseline`, {
        method: 'POST',
      }),
    ),
    bundle,
  )
}
export async function bundleSections(
  bundle: EvidenceBundle,
  offset: number,
  signal: AbortSignal,
) {
  const schema = z.object({
    bundle_id: z.string(),
    bundle_revision: z.string(),
    next_offset: z.number().nullable(),
    sections: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        origin: z.string(),
        body_skipped: z.boolean().optional(),
      }),
    ),
  })
  return check(
    schema.parse(
      await request(
        `/me/evidence-bundles/${bundle.bundle_id}/sections?offset=${offset}&limit=30`,
        { signal },
      ),
    ),
    bundle,
  )
}
const storedTable = z.object({
  cells: z.array(z.array(z.string())).optional(),
  rows: z
    .array(z.array(z.object({ text: z.object({ text: z.string() }) })))
    .optional(),
  unit: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  row_offset: z.number(),
  next_row_offset: z.number().nullable(),
})
export async function bundleContext(
  bundle: EvidenceBundle,
  candidate: BundleCandidate,
  row: number,
  text: number,
  signal: AbortSignal,
) {
  const schema = z.object({
    bundle_id: z.string(),
    bundle_revision: z.string(),
    segments: z.array(bundleCandidate),
    table: storedTable.nullable(),
    next_text_offset: z.number().nullable(),
  })
  const value = check(
    schema.parse(
      await request(
        `/me/evidence-bundles/${bundle.bundle_id}/context?${new URLSearchParams(
          {
            segment_id: candidate.segment_id,
            row_offset: String(row),
            text_offset: String(text),
            row_limit: '20',
          },
        )}`,
        { signal },
      ),
    ),
    bundle,
  )
  if (
    !value.segments.some(
      (s) =>
        s.segment_id === candidate.segment_id &&
        s.source_revision === candidate.source_revision,
    )
  )
    throw new Error('Evidence source response mismatch')
  return value
}
export async function getBundleCandidate(
  bundle: EvidenceBundle,
  segment: string,
) {
  const candidate = bundleCandidate.parse(
    await request(
      `/me/evidence-bundles/${bundle.bundle_id}/segments/${segment}`,
    ),
  )
  if (candidate.segment_id !== segment)
    throw new Error('Evidence segment response mismatch')
  return candidate
}
export const agentSchema = z.object({
  available: z.boolean(),
  run: z
    .object({
      status: z.string(),
      result: z
        .object({
          items: z.array(
            z.object({
              key: z.string(),
              search_status: z.string(),
              limitations: z.string(),
              findings: z.array(
                z.object({
                  statement: z.string(),
                  citations: z.array(
                    z.object({ segment_id: z.string(), quote: z.string() }),
                  ),
                }),
              ),
            }),
          ),
          stop_reason: z.string().nullable().optional(),
        })
        .nullable(),
    })
    .nullable(),
})
