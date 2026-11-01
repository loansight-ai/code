// Synthetic screen fixture. Never imported by the application or stored as company data.
const sid = '22222222-2222-4222-8222-222222222222'
const source = { segment_id: sid, title: 'XI.2 · 주석 34', scope: 'OFS' }
const won = (value: number) => String(value * 100_000_000)
const values = (a: number, b: number, c: number, d: number) => ({
  limit: won(a),
  commitment: won(b),
  loan_balance: won(c),
  related_party: won(d),
})
const rows = [
  {
    type: 'PF_GUARANTEE',
    label: 'PF 대출보증',
    project_count: 7,
    values: values(8120, 6540, 5860, 1840),
    sources: [source],
    aggregation_ready: true,
    level: 'DETAIL',
  },
  {
    type: 'COMPLETION_SUPPORT',
    label: '책임준공 미이행 시 채무인수',
    project_count: 5,
    values: values(0, 4400, 3105, 0),
    sources: [source],
    aggregation_ready: true,
    level: 'DETAIL',
  },
  {
    type: 'FUNDING_SUPPORT',
    label: '자금보충',
    project_count: 2,
    values: values(1500, 1200, 1200, 0),
    sources: [source],
    aggregation_ready: true,
    level: 'DETAIL',
  },
  {
    type: 'BUYER_GUARANTEE',
    label: '수분양자 중도금 보증',
    project_count: 3,
    values: values(1350, 1100, 820, 0),
    sources: [source],
    aggregation_ready: true,
    level: 'DETAIL',
  },
]
const maturity = (within: number, beyond: number, undisclosed: number) => ({
  values: {
    within: won(within),
    beyond: won(beyond),
    undisclosed: won(undisclosed),
  },
  within_percent: String((within / (within + beyond + undisclosed)) * 100),
  total: won(within + beyond + undisclosed),
  sources: [source],
  items: [
    {
      label: '검증용 만기 항목',
      amount: won(within),
      maturity: '2026-06-30',
      source,
    },
  ],
})
export function exposureFixture(bundle: {
  bundle_id: string
  bundle_revision: string
  period: string
  scope: string
}) {
  return {
    ...bundle,
    as_of: '2025-12-31',
    cutoff: '2026-12-31',
    currency: 'KRW',
    unit: '원',
    provided: {
      rows,
      totals: values(10970, 13240, 10985, 1840),
      complete: true,
    },
    received: {
      rows: [{ ...rows[0], values: values(1240, 0, 0, 0), label: '수취 보증' }],
      totals: values(1240, 0, 0, 0),
      complete: true,
    },
    equity: won(18008),
    ratio_percent: String((10985 / 18008) * 100),
    maturity: {
      debt: maturity(9300, 4850, 0),
      obligation: maturity(5010, 5165, 810),
    },
    litigation: {
      case_count: 12,
      claim: won(2100),
      provision: won(120),
      top_cases: [
        {
          case_number: '2025가합100',
          label: '검증용 공사대금 소송',
          claim: won(900),
          sources: [source],
        },
      ],
      sources: [source],
      plaintiff_facts: 1,
    },
    excluded_facts: 2,
  }
}
