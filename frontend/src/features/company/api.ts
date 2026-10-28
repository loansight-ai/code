import { z } from 'zod'
import { request } from '../session/api'
import { industries, type Industry } from './industries'

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
  industry: z.enum(industries).nullable().default(null),
})
export type DartCompany = z.infer<typeof dartCompanySchema>
export const COMPANY_PAGE_SIZE = 10

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
  industry?: Industry,
) {
  const params = new URLSearchParams({
    q: query,
    offset: String(offset),
    limit: String(COMPANY_PAGE_SIZE),
  })
  if (industry) params.set('industry', industry)
  return resultsSchema.parse(await request(`/companies?${params}`, { signal }))
}

const annualReportsSchema = z.object({
  corp_code: z.string().regex(/^[0-9]{8}$/),
  items: z.array(
    z.object({
      receipt_no: z.string().regex(/^[0-9]{14}$/),
      report_name: z.string(),
      fiscal_year: z.string().regex(/^[0-9]{4}$/),
      period: z.string(),
      receipt_date: z.string(),
      withdrawn: z.boolean(),
    }),
  ),
  checked_at: z.string(),
  search_start: z.string(),
  search_end: z.string(),
})

export async function getCompanyReports(corpCode: string, signal: AbortSignal) {
  const result = annualReportsSchema.parse(
    await request(`/companies/${corpCode}/reports`, { signal }),
  )
  if (result.corp_code !== corpCode)
    throw new Error('Company report response mismatch')
  return result
}
