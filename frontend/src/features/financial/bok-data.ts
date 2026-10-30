import type { FinancialResult } from './api'

export function bokGap(value: string, unit: string) {
  const number = Number(value)
  return `${number > 0 ? '+' : ''}${number.toLocaleString('ko-KR', {
    maximumFractionDigits: Math.abs(number) < 0.01 ? 4 : 2,
  })}${unit === '%' ? '%p' : unit}`
}

export function bokValue(
  result: FinancialResult,
  key: string,
  period = 'current',
) {
  const metric = result.bok_benchmark?.metrics.find((m) => m.key === key)
  const value = metric?.values.find((v) => v.period === period)
  return metric && value ? { ...value, unit: metric.unit } : undefined
}
