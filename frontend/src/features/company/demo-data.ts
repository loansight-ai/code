import type { Industry } from './industries'
export { industries, type Industry } from './industries'
export type Company = {
  id: string
  name: string
  code: string
  market: string
  industry: Industry | null
  description: string
  classification: '대상' | '복합' | '미분류' | '제외'
  classificationReason: string
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
    classification: '대상',
    classificationReason:
      '제조 업종으로 분류한 화면 예시입니다. 실제 업종코드 매핑은 미연동입니다.',
  },
  {
    id: 'demo-construction',
    name: '새움건설',
    code: '예시 000002',
    market: '가상 기업',
    industry: '건설',
    description: '건축 및 토목 공사',
    classification: '대상',
    classificationReason:
      '건설 업종으로 분류한 화면 예시입니다. 실제 업종코드 매핑은 미연동입니다.',
  },
  {
    id: 'demo-retail',
    name: '온유리테일',
    code: '예시 000003',
    market: '가상 기업',
    industry: '도소매',
    description: '생활용품 도매 및 소매',
    classification: '대상',
    classificationReason:
      '도소매 업종으로 분류한 화면 예시입니다. 실제 업종코드 매핑은 미연동입니다.',
  },
  {
    id: 'demo-property',
    name: '이음에스테이트',
    code: '예시 000004',
    market: '가상 기업',
    industry: '부동산 임대',
    description: '비주거용 부동산 임대',
    classification: '대상',
    classificationReason:
      '부동산 임대 업종으로 분류한 화면 예시입니다. 실제 업종코드 매핑은 미연동입니다.',
  },
  {
    id: 'demo-mixed',
    name: '다온산업',
    code: '예시 000005',
    market: '가상 기업',
    industry: null,
    description: '제조·도소매 부문 매출 근거 확인 필요',
    classification: '복합',
    classificationReason:
      '부문별 매출 근거와 적용 업종을 확인해야 합니다. 이 예시에서는 업종을 임의로 선택하지 않습니다.',
  },
  {
    id: 'demo-unclassified',
    name: '여울개발',
    code: '예시 000006',
    market: '가상 기업',
    industry: null,
    description: '서비스 업종 매핑 미확보',
    classification: '미분류',
    classificationReason:
      '업종코드 매핑 근거가 확보되지 않았습니다. 미분류 상태를 유지하며 업종 기준 분석은 보류합니다.',
  },
  {
    id: 'demo-excluded',
    name: '누리렌탈',
    code: '예시 000007',
    market: '가상 기업',
    industry: null,
    description: '장비·물품 렌탈 · 서비스 대상 제외',
    classification: '제외',
    classificationReason:
      '장비·물품 렌탈은 현재 서비스 대상 업종에서 제외됩니다.',
  },
]
export const reports = ['2025 사업보고서', '2024 사업보고서', '2023 사업보고서']
export const financialRows = [
  { name: '매출액', y2023: 1080, y2024: 1190, y2025: 1250 },
  { name: '영업이익', y2023: 87, y2024: 94, y2025: 100 },
  { name: '당기순이익', y2023: 51, y2024: 62, y2025: 68 },
  { name: '영업활동현금흐름', y2023: 72, y2024: 81, y2025: 89 },
]
export function findCompany(id?: string) {
  return companies.find(
    (company) => company.id === id && isAnalysisReady(company),
  )
}

export function isAnalysisReady(company: Company) {
  return company.classification === '대상' && company.industry !== null
}
