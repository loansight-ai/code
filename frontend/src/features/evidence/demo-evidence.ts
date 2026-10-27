export const evidenceRevision = 'demo-evidence-v2'
export const sources = [
  {
    id: 'covenant',
    title: '차입 약정 · 가상 원문',
    location: '예시 주석 21 · 문단 2',
    text: '당기말 회사는 차입 약정 조건을 충족하지 못하여 기한이익상실 사유가 발생하였습니다. 금융기관과 유예 여부를 협의하고 있습니다. 이 문장은 화면 검토용 가상 문구이며 실제 기업의 사건을 의미하지 않습니다.',
    fact: '사유 발생 문구 · 유예 확정 여부 미제공',
    related: ['guarantee'],
    detection: '검출',
  },
  {
    id: 'guarantee',
    title: '보증 약정 · 가상 원문',
    location: '예시 주석 34 · 표 1',
    text: '회사는 거래처의 차입에 대하여 보증을 제공하였습니다. 보증한도는 60억원, 당기말 보증잔액은 40억원입니다. 약정 존재를 설명하는 문구이며 실제 이행 청구 또는 약정 위반의 발생 여부는 이 예시에서 제공하지 않습니다.',
    fact: '제공 보증 · 한도 60억원 / 잔액 40억원 · 당기말',
    related: ['covenant'],
    detection: '검출',
  },
  {
    id: 'cashflow',
    title: '손익·현금흐름 · 가상 원문',
    location: '예시 재무제표 · 손익·현금흐름표',
    text: '2025년 예시 영업이익은 100억원, 영업활동현금흐름은 89억원입니다. 두 값의 차이는 비현금 조정 및 운전자본 등의 변동과 함께 검토해야 합니다. 이 문구는 공통 레이아웃 수치를 설명하며 실제 수집 결과가 아닙니다.',
    fact: '당기 연간 · 영업이익 100억원 / 영업CF 89억원',
    related: [],
    detection: '검출',
  },
  {
    id: 'pledge',
    title: '담보 제공 · 가상 원문',
    location: '예시 주석 22 · 문단 1',
    text: '당기말 장부금액 20억원의 자산을 차입금에 대한 담보로 제공하였습니다. 담보 설정금액·회수 가능액은 이 예시에서 제공하지 않습니다. 자산 장부금액을 은행의 담보 평가액으로 해석하지 않습니다.',
    fact: '제공 담보 · 장부금액 20억원 · 평가액 미확보',
    related: [],
    detection: '검출',
  },
  {
    id: 'litigation',
    title: '소송·제재 · 가상 원문',
    location: '예시 주석 35 · 문단 1',
    text: '당기말 현재 계류 중인 소송 및 제재는 없습니다. 이 문구는 원문에 해당사항 없음이 명시된 화면 예시이며 실제 공시의 부재를 확인한 결과가 아닙니다.',
    fact: '해당사항 없음 명시 · 당기말 · 가상 문구',
    related: [],
    detection: '공시상 없음',
  },
] as const
export type SourceId = (typeof sources)[number]['id']
export function findSource(id: string | null) {
  return sources.find((source) => source.id === id)
}
export const noteCategories = [
  {
    name: '감사의견/계속기업',
    detection: '미검출',
    reason: '예시에서 관련 구간 미확보. 감사의견을 추정하지 않습니다.',
    sourceId: null,
  },
  {
    name: '차입 만기/재무약정',
    detection: '검출',
    reason: '사유 발생 문구와 약정의 존재를 분리해 확인합니다.',
    sourceId: 'covenant',
  },
  {
    name: '신용등급',
    detection: '추출 실패',
    reason: '실패 상태 예시. 등급·전망을 제공하지 않습니다.',
    sourceId: null,
  },
  {
    name: '담보',
    detection: '검출',
    reason: '제공 방향·장부금액 역할을 확인합니다.',
    sourceId: 'pledge',
  },
  {
    name: '소송/제재',
    detection: '공시상 없음',
    reason: '가상 원문에 해당사항 없음이 명시된 예시입니다.',
    sourceId: 'litigation',
  },
  {
    name: '부외/후속사건',
    detection: '검출',
    reason: '보증한도와 보증잔액은 중복 합산하지 않습니다.',
    sourceId: 'guarantee',
  },
] as const
