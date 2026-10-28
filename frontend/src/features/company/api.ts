import { z } from 'zod'
import { request } from '../session/api'

const dartCompanySchema = z.object({
  corp_code: z.string().regex(/^[0-9]{8}$/),
  corp_name: z.string(),
  corp_eng_name: z.string().nullable(),
  stock_code: z.string().nullable(),
  modify_date: z.string(),
  ksic11_code: z.string().nullable().default(null),
  ksic11_name: z.string().nullable().default(null),
  ksic11_level: z.number().int().nullable().default(null),
  ksic11_status: z
    .enum(['matched', 'unmatched', 'review_required'])
    .default('unmatched'),
  induty_code: z.string().nullable().default(null),
  corp_cls: z.enum(['Y', 'K', 'N', 'E']).nullable().default(null),
  acc_mt: z.string().nullable().default(null),
})
export type DartCompany = z.infer<typeof dartCompanySchema>

const resultsSchema = z.object({
  items: z.array(dartCompanySchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
})

export async function searchCompanies(
  query: string,
  offset: number,
  signal: AbortSignal,
) {
  const params = new URLSearchParams({
    q: query,
    offset: String(offset),
    limit: '30',
  })
  return resultsSchema.parse(await request(`/companies?${params}`, { signal }))
}
