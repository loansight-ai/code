import { z } from 'zod'
import { request } from '../session/api'

const resultSchema = z.object({
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  execution_status: z.enum(['COMPLETED', 'INCOMPLETE']),
  evidence_verified: z.literal(false),
  stop_reason: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        key: z.string(),
        search_status: z.enum(['COMPLETED', 'INCOMPLETE']),
        limitations: z.string(),
        findings: z.array(
          z.object({
            statement: z.string(),
            citations: z.array(
              z.object({ segment_id: z.string().uuid(), quote: z.string() }),
            ),
          }),
        ),
      }),
    )
    .length(6),
})
const savedSchema = z.object({
  available: z.boolean(),
  provider: z.string().default('codex'),
  run: z
    .object({
      run_id: z.string().uuid(),
      structure_id: z.string().uuid(),
      status: z.string(),
      error_code: z.string().nullable(),
      result: resultSchema.nullable(),
    })
    .nullable(),
})
export type AgentSaved = z.infer<typeof savedSchema>
export async function getAgentRun(
  id: string,
  hash: string,
  signal: AbortSignal,
) {
  const data = savedSchema.parse(
    await request(`/me/note-imports/${id}/search/agent`, { signal }),
  )
  if (
    data.run &&
    (data.run.structure_id !== id ||
      (data.run.result &&
        (data.run.result.structure_id !== id ||
          data.run.result.source_sha256 !== hash)))
  )
    throw new Error('Agent source mismatch')
  return data
}
