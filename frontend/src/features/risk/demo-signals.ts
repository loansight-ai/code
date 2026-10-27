import type { SourceId } from '../evidence/demo-evidence'

export const axes = [
  '상환재원',
  '유동성/만기',
  '재무구조',
  '우발/부외 부담',
  '외부 평가',
  '담보/회수 여력',
] as const
export const signals: {
  id: string
  title: string
  severity: '경고' | '주의' | '관찰'
  axis: (typeof axes)[number]
  sourceId: SourceId
  rule: string
  eventType: string
  suggestion: string
}[] = [
  {
    id: 'demo-covenant',
    title: '약정 위반 사유 발생 문구 확인',
    severity: '경고',
    axis: '유동성/만기',
    sourceId: 'covenant',
    rule: 'demo-W01',
    eventType: '사유 발생 문구 · 가상 예시',
    suggestion:
      '원문과 유예·차환 조건을 확인하세요. 실제 승인·거절 판단을 의미하지 않습니다.',
  },
  {
    id: 'demo-guarantee',
    title: '제공 보증의 범위와 금액 역할 확인',
    severity: '주의',
    axis: '우발/부외 부담',
    sourceId: 'guarantee',
    rule: 'demo-C01',
    eventType: '조건·약정 존재 · 사건 발생 미제공',
    suggestion: '한도·잔액과 실제 이행 청구 여부를 구분하세요.',
  },
  {
    id: 'demo-cashflow',
    title: '영업이익과 현금흐름의 차이 확인',
    severity: '관찰',
    axis: '상환재원',
    sourceId: 'cashflow',
    rule: 'demo-O01',
    eventType: '재무 차이 · 원인 확인 전',
    suggestion: '비현금 조정과 운전자본 변동을 함께 확인하세요.',
  },
]

export function severityTone(severity: '경고' | '주의' | '관찰') {
  return severity === '경고'
    ? 'warning'
    : severity === '주의'
      ? 'caution'
      : 'observation'
}
