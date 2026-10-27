export type Industry = '제조' | '건설' | '도소매' | '부동산 임대'
export type Company = {
  id: string
  name: string
  code: string
  market: string
  industry: Industry
  description: string
}

// Entirely fictional fixtures. No live disclosure, risk or inference results.
export const companies: Company[] = [
  {
    id: 'demo-manufacturing',
    name: '한빛정밀',
    code: '예시 000001',
    market: '가상 기업',
    industry: '제조',
    description: '산업용 정밀 부품 제조',
  },
  {
    id: 'demo-construction',
    name: '새움건설',
    code: '예시 000002',
    market: '가상 기업',
    industry: '건설',
    description: '건축 및 토목 공사',
  },
  {
    id: 'demo-retail',
    name: '온유리테일',
    code: '예시 000003',
    market: '가상 기업',
    industry: '도소매',
    description: '생활용품 도매 및 소매',
  },
  {
    id: 'demo-property',
    name: '이음에스테이트',
    code: '예시 000004',
    market: '가상 기업',
    industry: '부동산 임대',
    description: '비주거용 부동산 임대',
  },
]
export const industries: Industry[] = ['제조', '건설', '도소매', '부동산 임대']
export const reports = ['2025 사업보고서', '2024 사업보고서', '2023 사업보고서']
export const financialRows = [
  { name: '매출액', y2023: 1080, y2024: 1190, y2025: 1250 },
  { name: '영업이익', y2023: 87, y2024: 94, y2025: 100 },
  { name: '당기순이익', y2023: 51, y2024: 62, y2025: 68 },
  { name: '영업활동현금흐름', y2023: 72, y2024: 81, y2025: 89 },
]
export function findCompany(id?: string) {
  return companies.find((company) => company.id === id)
}
