import type { FinancialMetric, FinancialResult } from './api'

export type FinancialDataValue = {
  value: string | null
  state: 'CONFIRMED' | 'APPROXIMATE' | 'MISSING' | 'NOT_COMPUTABLE'
  reason: string | null
}
const missingReasons = new Set([
  'missing_input',
  'account_not_found',
  'amount_not_disclosed',
  'missing_lease_input',
  'ambiguous_account',
  'unsupported_currency',
  'construction_receivables_missing',
  'pf_details_missing',
  'maturity_details_missing',
  'funding_rate_details_missing',
])

export function displayedMetricValue(
  metric: FinancialMetric,
  result: FinancialResult,
  period = 'current',
): FinancialDataValue | undefined {
  const value = metric.values.find((v) => v.period === period)
  if (!metric.key.endsWith('_growth')) return value
  const account = metric.inputs[0]
  const index = result.periods.findIndex((p) => p.key === period)
  const previous = result.periods[index + 1]?.key
  const currentFact = result.facts.find(
    (f) => f.key === account && f.period === period,
  )
  const previousFact = result.facts.find(
    (f) => f.key === account && f.period === previous,
  )
  if (
    currentFact?.value != null &&
    previousFact?.value != null &&
    Number(currentFact.value) < 0 !== Number(previousFact.value) < 0
  ) {
    return { value: null, state: 'NOT_COMPUTABLE', reason: 'profit_transition' }
  }
  return value
}
export function dataState(value: FinancialDataValue | undefined) {
  if (!value) return 'MISSING'
  // Older saved runs classified missing inputs as NOT_COMPUTABLE.
  if (value.value == null && missingReasons.has(value.reason ?? ''))
    return 'MISSING'
  if (value.value == null && ['CONFIRMED', 'APPROXIMATE'].includes(value.state))
    return 'MISSING'
  return value.state
}
