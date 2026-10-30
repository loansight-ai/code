import type { FinancialResult } from './api'

export type CashflowPeerData = {
  industry: string
  scope: 'OFS' | 'CFS'
  period: string
  example: boolean
  source: string
  metrics: Record<string, number[]>
}
// Supplied only by the explicitly fictional example route.
export const exampleCashflowPeers: CashflowPeerData = {
  industry: '건설',
  scope: 'OFS',
  period: '2025.12',
  example: true,
  source: '가상 건설 기업 14곳 · 화면 배치용 분포',
  metrics: {
    operating_margin: [
      1.2, 2.1, 2.8, 3.4, 3.7, 4, 4.4, 4.6, 4.8, 5.1, 5.6, 6.2, 7, 8.4,
    ],
    debt_ratio: [
      62, 89, 103, 128, 145, 169, 185, 197, 211, 228, 249, 279, 315, 362,
    ],
    cash_profit: [
      -0.8, -0.5, -0.3, -0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1.1, 1.3, 1.5, 1.8, 2.2,
    ],
  },
}
export function matchingCashflowPeers(
  result: FinancialResult,
  peers: CashflowPeerData | undefined,
  allowExample: boolean,
) {
  return peers &&
    (!peers.example || allowExample) &&
    peers.industry === result.industry &&
    peers.scope === result.context.scope &&
    peers.period === result.context.period
    ? peers
    : null
}
