import type { FinancialMetric, FinancialResult } from './api'
import { money, metricValue, reasonLabels } from './api'
import './data-status.css'

import {
  dataState,
  displayedMetricValue,
  type FinancialDataValue,
} from './data-state'

const labels = {
  CONFIRMED: '확정',
  APPROXIMATE: '근사',
  MISSING: '미확보',
  NOT_COMPUTABLE: '계산 불가',
}

export function DataBadge({
  value,
}: {
  value: FinancialDataValue | undefined
}) {
  return <DataStateBadge state={dataState(value)} />
}

export function DataStateBadge({
  state,
}: {
  state: FinancialDataValue['state']
}) {
  return (
    <span
      className={`financial-data-badge financial-data-${state.toLowerCase()}`}
    >
      {labels[state]}
    </span>
  )
}

export function DataStatus({
  value,
}: {
  value: FinancialDataValue | undefined
}) {
  const state = dataState(value)
  const explanation = value?.reason
    ? (reasonLabels[value.reason] ?? value.reason)
    : state === 'CONFIRMED'
      ? '공시 계정·검증된 산식 기준'
      : state === 'APPROXIMATE'
        ? '근사 사유 확인 필요'
        : state === 'MISSING'
          ? '필요한 자료 없음'
          : '계산 조건 확인 필요'
  return (
    <span className="financial-data-status">
      <DataBadge value={value} />
      <span>{explanation}</span>
    </span>
  )
}

export function FinancialValue({
  value,
  unit,
}: {
  value: FinancialDataValue | undefined
  unit?: string
}) {
  const state = dataState(value)
  if (state === 'MISSING')
    return <span className="financial-data-empty">자료 없음</span>
  if (state === 'NOT_COMPUTABLE')
    return <span className="financial-data-empty">계산 불가</span>
  return (
    <span>
      {unit === undefined
        ? money(value?.value)
        : metricValue(value?.value, unit)}
      {state === 'APPROXIMATE' && (
        <span className="financial-approximation">
          {' '}
          <DataBadge value={value} />{' '}
          {value?.reason
            ? (reasonLabels[value.reason] ?? value.reason)
            : '근사 사유 확인 필요'}
        </span>
      )}
    </span>
  )
}

export function MetricStatus({
  metric,
  result,
}: {
  metric: FinancialMetric
  result: FinancialResult
}) {
  const value = displayedMetricValue(metric, result)
  const keys = [...new Set(metric.inputs)]
  const acquired = keys.filter((key) =>
    result.facts.some(
      (f) => f.key === key && f.period === 'current' && f.value != null,
    ),
  ).length
  const incomplete = keys.length > 0 && acquired < keys.length
  return (
    <span className="financial-metric-status">
      <DataStatus value={value} />
      {(incomplete || dataState(value) === 'MISSING') && (
        <span className="financial-reference">
          <span className="financial-data-badge financial-data-reference">
            참고
          </span>{' '}
          {keys.length > 0 &&
            `당기 입력 계정 ${acquired}/${keys.length} 확보 · `}
          주석 보강 필요
        </span>
      )}
    </span>
  )
}

export function MetricValue({
  metric,
  result,
  period = 'current',
}: {
  metric: FinancialMetric
  result: FinancialResult
  period?: string
}) {
  const value = displayedMetricValue(metric, result, period)
  const change =
    period === 'current' ? result.changes[metric.inputs[0]] : undefined
  return (
    <span>
      <FinancialValue value={value} unit={metric.unit} />
      {value?.reason === 'profit_transition' && change && (
        <small>
          {' '}
          · {change.transition === 'NEGATIVE_TURN' ? '적자 전환' : '흑자 전환'}
          {change.amount != null && ` · 증감 ${money(change.amount)}억원`}
        </small>
      )}
    </span>
  )
}
