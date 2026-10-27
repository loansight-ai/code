export const ratioGroups = [
  '유동성',
  '레버리지',
  '활동성',
  '수익성',
  '성장성',
] as const
export type Ratio = {
  id: string
  group: (typeof ratioGroups)[number]
  name: string
  current: string | null
  previous: string | null
  unit: string
  formula: string
  numerator: string
  denominator: string
  basis: string
  reason: string
  source: string
}

// Static, arithmetically consistent layout fixtures; no business thresholds or live calculations.
export const ratios: Ratio[] = [
  {
    id: 'current',
    group: '유동성',
    name: '유동비율',
    current: '150.0',
    previous: '140.0',
    unit: '%',
    formula: '유동자산 ÷ 유동부채 × 100',
    numerator: '유동자산 300억원',
    denominator: '유동부채 200억원',
    basis: '기말 잔액 · 소수 1자리 표시 예시',
    reason: '근사 없음 · 업무 산식 검증 전 예시',
    source: '예시 재무상태표',
  },
  {
    id: 'debt',
    group: '레버리지',
    name: '부채비율',
    current: '100.0',
    previous: '110.0',
    unit: '%',
    formula: '부채총계 ÷ 자본총계 × 100',
    numerator: '부채총계 500억원 (리스 포함)',
    denominator: '자본총계 500억원',
    basis: '기말 잔액 · 소수 1자리 표시 예시',
    reason:
      '리스 제외 예시는 부채 460억원·전기 510억원. 임대보증금은 별도 표시하며 차입 포함 여부는 미정입니다.',
    source: '예시 재무상태표',
  },
  {
    id: 'borrowing',
    group: '레버리지',
    name: '차입금의존도',
    current: '34.0',
    previous: '34.3',
    unit: '%',
    formula: '총차입금 ÷ 총자산 × 100',
    numerator: '총차입금 340억원 (리스 포함)',
    denominator: '총자산 1,000억원',
    basis: '기말 잔액 · 소수 1자리 표시 예시',
    reason:
      '리스 제외 총차입금은 300억원·전기 320억원. 임대보증금은 포함하지 않은 예시입니다.',
    source: '예시 차입금 주석',
  },
  {
    id: 'inventory',
    group: '활동성',
    name: '재고자산 회전일수',
    current: null,
    previous: null,
    unit: '일',
    formula: '평균 재고자산 ÷ 매출원가 × 기간 일수',
    numerator: '평균 재고자산 미확보',
    denominator: '매출원가 미확보',
    basis: '연평균 잔액·기간 일수 정책 확인 필요',
    reason: '매출원가와 평균 잔액을 확보하지 못해 계산하지 않습니다.',
    source: '예시 입력 부족 상태',
  },
  {
    id: 'margin',
    group: '수익성',
    name: '매출액영업이익률',
    current: '8.0',
    previous: '7.9',
    unit: '%',
    formula: '영업이익 ÷ 매출액 × 100',
    numerator: '영업이익 100억원',
    denominator: '매출액 1,250억원',
    basis: '당기 연간 손익 · 소수 1자리 표시 예시',
    reason: '근사 없음 · 업무 산식 검증 전 예시',
    source: '예시 손익계산서',
  },
  {
    id: 'roa',
    group: '수익성',
    name: '총자산영업이익률',
    current: '9.8',
    previous: null,
    unit: '%',
    formula: '영업이익 ÷ 평균 총자산 × 100',
    numerator: '영업이익 100억원',
    denominator: '평균 총자산 1,025억원 (전기말 1,050 · 당기말 1,000억원)',
    basis: '기초·기말 평균을 가정한 예시 · 전기 평균 미확보',
    reason: '평균 잔액·첫해 처리 정책은 업무 검증이 필요합니다.',
    source: '예시 손익·재무상태표',
  },
  {
    id: 'interest',
    group: '수익성',
    name: '이자보상비율',
    current: '4.0',
    previous: '3.8',
    unit: '배',
    formula: '영업이익 ÷ 이자비용',
    numerator: '영업이익 100억원',
    denominator: '이자비용 25억원',
    basis: '당기 연간 손익 · 소수 1자리 표시 예시',
    reason:
      '금융원가로 대체하지 않은 예시입니다. 금융원가 근사 허용 정책은 미정입니다.',
    source: '예시 손익·차입금 주석',
  },
  {
    id: 'growth',
    group: '성장성',
    name: '매출액 증가율',
    current: '5.0',
    previous: '10.2',
    unit: '%',
    formula: '(당기 매출액 − 전기 매출액) ÷ 전기 매출액 × 100',
    numerator: '매출액 차이 60억원',
    denominator: '전기 매출액 1,190억원',
    basis: '같은 연간 기간 비교 · 소수 1자리 표시 예시',
    reason:
      '흑적 전환·음수 분모 정책은 별도이며 이 예시에서는 적용하지 않습니다.',
    source: '예시 손익계산서',
  },
]

export function ratiosForLease(lease: 'include' | 'exclude') {
  return ratios.map((ratio) =>
    lease === 'exclude' && ratio.id === 'debt'
      ? {
          ...ratio,
          current: '92.0',
          previous: '102.0',
          numerator: '리스 제외 부채총계 460억원',
        }
      : lease === 'exclude' && ratio.id === 'borrowing'
        ? {
            ...ratio,
            current: '30.0',
            previous: '30.5',
            numerator: '리스 제외 총차입금 300억원',
          }
        : ratio,
  )
}

export const borrowingRows = [
  ['단기차입금', 100],
  ['유동성장기차입금', 50],
  ['장기차입금', 120],
  ['사채', 30],
] as const
export const cashflowRows = [
  ['영업활동현금흐름', 81, 89],
  ['투자활동현금흐름', -60, -50],
  ['재무활동현금흐름', -10, -20],
  ['환율 변동 효과', 0, 0],
  ['현금 순증감', 11, 19],
] as const
export const profitBridge = [
  { label: '2024 영업이익', base: 0, value: 94, change: '94' },
  { label: '매출 증가', base: 94, value: 60, change: '+60' },
  { label: '원가 증가', base: 112, value: 42, change: '−42' },
  { label: '판관비 증가', base: 100, value: 12, change: '−12' },
  { label: '2025 영업이익', base: 0, value: 100, change: '100' },
]
