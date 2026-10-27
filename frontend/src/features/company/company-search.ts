import { companies } from './demo-data'

// Local demo adapter. Replace only after the server response contract is agreed.
export async function searchDemoCompanies(query: string, industry: string) {
  return companies.filter(
    (company) =>
      (industry === '전체' || company.industry === industry) &&
      `${company.name} ${company.code}`.includes(query.trim()),
  )
}
