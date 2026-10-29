import type { ReactNode } from 'react'
import { FormulaDialog } from './formula-dialog'
import { FinancialFactEvidence } from './note-progress'
import { MetricValue, MetricStatus } from './data-status'
import { dataState, displayedMetricValue } from './data-state'
import {
  money,
  reasonLabels,
  type FinancialMetric,
  type FinancialResult,
} from './api'

const operands: Record<string, [string[], string[]]> = {
  current_ratio: [['current_assets'], ['current_liabilities']],
  debt_ratio: [['liabilities'], ['equity']],
  equity_ratio: [['equity'], ['assets']],
  operating_margin: [['operating_profit'], ['revenue']],
  gross_margin: [['gross_profit'], ['revenue']],
  cost_ratio: [['cost_of_sales'], ['revenue']],
  interest_coverage: [['operating_profit'], ['interest_expense']],
  cash_profit: [['operating_cashflow'], ['operating_profit']],
  cash_current_liabilities: [['operating_cashflow'], ['current_liabilities']],
}

export function LiveFormulaDialog({
  metric,
  result,
  onClose,
  onCloseAutoFocus,
}: {
  metric: FinancialMetric
  result: FinancialResult
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const current = displayedMetricValue(metric, result)
  const state = dataState(current)
  const explanation = current?.reason
    ? (reasonLabels[current.reason] ?? current.reason)
    : state === 'CONFIRMED'
      ? '공시 계정으로 계산했습니다. 다른 계정으로 대체하거나 근사하지 않았습니다.'
      : state === 'APPROXIMATE'
        ? '근사 사유 확인 필요'
        : '필요한 자료와 산식 조건을 확인해 주세요.'
  function fact(key: string, period = 'current'): ReactNode {
    const value = result.facts.find((f) => f.key === key && f.period === period)
    return (
      <span key={`${key}:${period}`}>
        {value?.label ?? key}:{' '}
        {value?.value == null ? '자료 없음' : `${money(value.value)}억원`}
        {value?.reason && (
          <small>{reasonLabels[value.reason] ?? value.reason}</small>
        )}
      </span>
    )
  }
  const rows: { label: string; value: ReactNode }[] = []
  const pair = operands[metric.key]
  const debt =
    result.borrowing_totals.current == null
      ? '총차입금 미확보 · 구성 계정 확인 필요'
      : `총차입금: ${money(result.borrowing_totals.current)}억원`
  if (pair) {
    const numerator =
      metric.key === 'debt_ratio' && result.context.lease === 'exclude' ? (
        <>
          {fact('liabilities')}
          <span>차감: 유동·비유동 리스부채</span>
          {fact('current_lease')}
          {fact('noncurrent_lease')}
        </>
      ) : (
        pair[0].map((key) => fact(key))
      )
    rows.push(
      { label: '분자', value: numerator },
      { label: '분모', value: pair[1].map((key) => fact(key)) },
    )
  } else if (metric.key === 'note_borrowing_ratio') {
    const summary = result.note_borrowing_summaries.current
    rows.push(
      {
        label: '분자',
        value:
          summary?.adjusted_subtotal == null
            ? '검산된 주석 차입금 소계 미확보'
            : `주석 차입금 소계: ${money(summary.adjusted_subtotal)}억원 · 리스 ${result.context.lease === 'include' ? '포함' : '제외'}`,
      },
      { label: '분모', value: fact('assets') },
    )
  } else if (metric.key === 'operating_roa') {
    rows.push(
      { label: '분자', value: fact('operating_profit') },
      {
        label: '분모',
        value: metric.inputs.includes('assets') ? (
          <>기말 자산총계{fact('assets')}</>
        ) : (
          '기존 산식의 잔액 기준 미정 · 다시 수집·분석 필요'
        ),
      },
    )
  } else if (
    [
      'borrowing_ratio',
      'borrowing_investment_property',
      'short_borrowing_ratio',
    ].includes(metric.key)
  ) {
    rows.push(
      {
        label: '분자',
        value:
          metric.key === 'short_borrowing_ratio'
            ? fact('short_borrowings')
            : debt,
      },
      {
        label: '분모',
        value:
          metric.key === 'short_borrowing_ratio'
            ? debt
            : fact(
                metric.key === 'borrowing_ratio'
                  ? 'assets'
                  : 'investment_property',
              ),
      },
    )
  } else if (metric.key.endsWith('_growth')) {
    const key = metric.inputs[0]
    rows.push(
      {
        label: '분자',
        value: (
          <>
            당기 − 전기{fact(key)}
            {fact(key, 'previous')}
          </>
        ),
      },
      { label: '분모', value: <>전기 금액{fact(key, 'previous')}</> },
    )
  } else {
    rows.push({
      label: '계산 입력',
      value: metric.inputs.length
        ? metric.inputs.map((key) => fact(key))
        : '자료·산식 정책 확보 후 계산',
    })
  }
  rows.push(
    {
      label: '잔액 기준',
      value: [
        'interest_coverage',
        'operating_margin',
        'gross_margin',
        'cost_ratio',
      ].includes(metric.key)
        ? '해당 없음 (보고기간 손익 항목)'
        : metric.basis,
    },
    { label: '단위', value: `${metric.unit} · 소수 첫째 자리 표시` },
    {
      label: '입력 근거',
      value: metric.inputs.map((key) => (
        <FinancialFactEvidence
          key={key}
          sources={
            result.facts.find((f) => f.key === key && f.period === 'current')
              ?.sources ?? []
          }
        />
      )),
    },
    {
      label: '당기 결과',
      value: <MetricValue metric={metric} result={result} />,
    },
    {
      label: '자료 상태',
      value: <MetricStatus metric={metric} result={result} />,
    },
    {
      label: '버전',
      value: (
        <>
          {result.formula_version}
          <small>계정 매핑 {result.mapping_version}</small>
        </>
      ),
    },
  )
  return (
    <FormulaDialog
      title={`${metric.label} 산식`}
      description={`${result.context.report_name} · ${result.context.scope === 'OFS' ? '별도(OFS)' : '연결(CFS)'} · 당기 기준`}
      formula={metric.formula}
      state={
        state.toLowerCase() as
          'confirmed' | 'approximate' | 'missing' | 'not_computable'
      }
      rows={rows}
      reason={explanation}
      sourceUrl={result.source_url}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
    />
  )
}
