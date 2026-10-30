import type { FinancialResult } from './api'
import { displayedMetricValue, type FinancialDataValue } from './data-state'
import { financialFact, financialNumber } from './cashflow-charts'

function numeric(value: FinancialDataValue | undefined) {
  if (
    !value ||
    !['CONFIRMED', 'APPROXIMATE'].includes(value.state) ||
    value.value == null
  )
    return null
  const number = Number(value.value)
  return Number.isFinite(number) ? number : null
}
export function workingCapitalDays(result: FinancialResult) {
  const construction = result.industry === '건설'
  return [
    [
      construction ? 'construction_receivable_days' : 'receivable_days',
      construction ? '공사미수금 회수' : '매출채권 회수',
      true,
    ],
    ['inventory_days', '재고자산 회전', true],
    ['payable_days', '매입채무 지급', false],
    ['ccc', '현금전환주기', true],
  ].map(([key, label, lowerBetter]) => {
    const metric = result.metrics.find((item) => item.key === key)
    const current = metric ? displayedMetricValue(metric, result) : undefined
    const previous = metric
      ? displayedMetricValue(metric, result, 'previous')
      : undefined
    return {
      key: String(key),
      label: String(label),
      current,
      previous,
      now: numeric(current),
      before: numeric(previous),
      lowerBetter: Boolean(lowerBetter),
    }
  })
}
export function cashflowCheckRows(result: FinancialResult) {
  const cash = financialNumber(financialFact(result, 'operating_cashflow'))
  const metric = result.metrics.find(
    (item) => item.key === 'cash_current_liabilities',
  )
  const ratio = metric ? displayedMetricValue(metric, result) : undefined
  const negativePeriods = result.periods.filter((period) => {
    const profit = financialNumber(
      financialFact(result, 'operating_profit', period.key),
    )
    const cashflow = financialNumber(
      financialFact(result, 'operating_cashflow', period.key),
    )
    return profit != null && profit > 0 && cashflow != null && cashflow < 0
  }).length
  const hasProfitCash = result.periods.some(
    (period) =>
      financialNumber(financialFact(result, 'operating_profit', period.key)) !=
        null &&
      financialNumber(
        financialFact(result, 'operating_cashflow', period.key),
      ) != null,
  )
  return { cash, ratio, negativePeriods, hasProfitCash }
}
