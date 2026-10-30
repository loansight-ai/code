import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { request } from '../session/api'

const sourceRow = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
)
const schema = z.object({
  corp_code: z.string().regex(/^\d{8}$/),
  receipt_no: z.string().regex(/^\d{14}$/),
  scope: z.enum(['CFS', 'OFS']),
  import_id: z.string().uuid().nullable(),
  source_as_of: z.string().nullable(),
  exported_on: z.string().nullable(),
  financial: z.array(sourceRow),
  history: z.array(sourceRow),
  available_scopes: z.array(z.enum(['CFS', 'OFS'])),
  event_candidates: z.array(sourceRow),
  coverage: sourceRow.nullable(),
})
export type CollectedData = z.infer<typeof schema>
export type CollectedSelection = {
  corpCode: string | null
  receiptNo?: string
  scope: string
  importId?: string
  fiscalYear?: string
  enabled?: boolean
}

export async function getCollectedData(
  selection: CollectedSelection,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    receipt_no: selection.receiptNo!,
    scope: selection.scope,
  })
  if (selection.importId) params.set('import_id', selection.importId)
  if (selection.fiscalYear) params.set('fiscal_year', selection.fiscalYear)
  const data = schema.parse(
    await request(`/companies/${selection.corpCode}/collected-data?${params}`, {
      signal,
    }),
  )
  if (
    data.corp_code !== selection.corpCode ||
    data.receipt_no !== selection.receiptNo ||
    data.scope !== selection.scope ||
    (selection.importId && data.import_id !== selection.importId) ||
    data.financial.some(
      (row) =>
        row.corp_code !== selection.corpCode ||
        row.rcept_no !== selection.receiptNo ||
        row.fs_div !== selection.scope ||
        (selection.fiscalYear && row.bsns_year !== selection.fiscalYear),
    )
  )
    throw new Error('collected_response_mismatch')
  return data
}

export function useCollectedData(selection: CollectedSelection) {
  const { corpCode, receiptNo, scope, importId, fiscalYear } = selection
  return useQuery({
    queryKey: ['collected', corpCode, receiptNo, scope, importId, fiscalYear],
    queryFn: ({ signal }) => getCollectedData(selection, signal),
    enabled:
      selection.enabled !== false &&
      !!corpCode &&
      /^\d{8}$/.test(corpCode) &&
      !!receiptNo &&
      /^\d{14}$/.test(receiptNo) &&
      ['CFS', 'OFS'].includes(scope),
    retry: false,
  })
}
