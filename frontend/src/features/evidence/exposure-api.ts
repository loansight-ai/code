import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { SessionContext } from '../session/session-context'
import { request } from '../session/api'
import { factPath } from './fact-api'
import type { EvidenceBundle } from './bundle-api'

const amount = z.string().nullable()
const source = z.object({
  segment_id: z.string().uuid(),
  title: z.string(),
  scope: z.string(),
})
const values = z.object({
  limit: amount,
  commitment: amount,
  loan_balance: amount,
  related_party: amount,
})
const composition = z.object({
  rows: z.array(
    z.object({
      type: z.string(),
      label: z.string(),
      project_count: z.number().nullable(),
      values,
      sources: z.array(source),
      aggregation_ready: z.boolean(),
      level: z.string(),
    }),
  ),
  totals: values,
  complete: z.boolean(),
})
const maturity = z.object({
  values: z.object({
    within: amount,
    beyond: amount,
    undisclosed: amount,
    overdue: amount.optional(),
  }),
  within_percent: amount,
  total: amount,
  sources: z.array(source),
  items: z.array(
    z.object({
      label: z.string(),
      amount: z.string(),
      maturity: z.string().nullable(),
      source,
    }),
  ),
})
const schema = z.object({
  bundle_id: z.string().uuid(),
  bundle_revision: z.string(),
  period: z.string(),
  scope: z.enum(['OFS', 'CFS']),
  as_of: z.string(),
  cutoff: z.string(),
  currency: z.literal('KRW'),
  unit: z.literal('원'),
  provided: composition,
  received: composition,
  equity: amount,
  ratio_percent: amount,
  maturity: z.object({ debt: maturity, obligation: maturity }),
  litigation: z.object({
    case_count: z.number().nullable(),
    claim: amount,
    provision: amount,
    top_cases: z.array(
      z.object({
        case_number: z.string(),
        label: z.string(),
        claim: z.string(),
        sources: z.array(source),
        filing_date: z.string().nullable().optional(),
        plaintiff: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
      }),
    ),
    sources: z.array(source),
    plaintiff_facts: z.number(),
    detected: z.boolean().default(false),
    case_list_available: z.boolean().default(false),
    notes: z
      .array(z.object({ quote: z.string(), sources: z.array(source) }))
      .default([]),
    plaintiff: z
      .object({
        case_count: z.number().nullable(),
        claim: amount,
        sources: z.array(source),
      })
      .optional(),
  }),
  excluded_facts: z.number(),
})
export type ExposureSummary = z.infer<typeof schema>
export type ExposureSource = z.infer<typeof source>

export function useExposureSummary(bundle: EvidenceBundle) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  return useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      'facts',
      'exposure-summary',
      bundle.bundle_revision,
    ],
    enabled: !!owner,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = schema.parse(
        await request(`${factPath(bundle.bundle_id)}/exposure-summary`, {
          signal,
        }),
      )
      if (
        result.bundle_id !== bundle.bundle_id ||
        result.bundle_revision !== bundle.bundle_revision ||
        result.scope !== bundle.scope ||
        result.period !== bundle.period
      )
        throw new Error('exposure_response_mismatch')
      return result
    },
  })
}

export function exposureMoney(value: string | null | undefined) {
  if (value == null) return '미확보'
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(
    Number(value) / 100_000_000,
  )
}
