import { metricValue, type FinancialMetric, type FinancialResult } from './api'

export function CoreQuartileDetail({
  result,
  metric,
}: {
  result: FinancialResult
  metric: FinancialMetric
}) {
  const benchmark = result.core_ratio_benchmark
  const comparison = benchmark?.metrics.find((m) => m.key === metric.key)
  if (!comparison) return null
  const format = (value: string | null) =>
    value == null ? '미확보' : metricValue(value, comparison.unit)
  return (
    <div
      className="core-quartile-history"
      tabIndex={0}
      role="region"
      aria-label={`${metric.label} 업종 기준 5년 이력`}
    >
      <table className="formula-definition">
        <caption>
          {benchmark?.industry_name ?? '업종 미확보'} · 전체 규모 · 별도 기준 ·{' '}
          {comparison.unit}
        </caption>
        <thead>
          <tr>
            <th scope="col">연도</th>
            <th scope="col">Q1</th>
            <th scope="col">중앙값</th>
            <th scope="col">Q3</th>
            <th scope="col">업종합산비율</th>
          </tr>
        </thead>
        <tbody>
          {comparison.history.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year}</th>
              <td>{format(row.q1)}</td>
              <td>{format(row.median)}</td>
              <td>{format(row.q3)}</td>
              <td>{format(row.aggregate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Q1·Q3는 25·75% 경계입니다. 세 분위수만으로 정확한 백분위나 전체 분포를
        추정하지 않습니다. 업종합산비율은 별도 참고값이며 판정에는 쓰지
        않습니다.
      </p>
    </div>
  )
}
