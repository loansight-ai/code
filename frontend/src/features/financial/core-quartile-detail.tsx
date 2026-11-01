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
  if (benchmark?.contract_version === 'core-relative-bands-v1')
    return <RelativeQuartileDetail result={result} metric={metric} />
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

function RelativeQuartileDetail({
  result,
  metric,
}: {
  result: FinancialResult
  metric: FinancialMetric
}) {
  const benchmark = result.core_ratio_benchmark!
  const row = benchmark.metrics.find((m) => m.key === metric.key)!
  const assessment = result.core_card_assessments?.find(
    (a) => a.key === metric.key,
  )
  const current = metric.values.find((v) => v.period === 'current')
  const format = (value: string | null | undefined) =>
    value == null ? '미확보' : metricValue(value, row.unit)
  const boundaries = [
    ['Q1', row.q1, row.q1_ecos, row.q1_ci_low, row.q1_ci_high],
    [
      '중앙값',
      row.median,
      row.median_ecos,
      row.median_ci_low,
      row.median_ci_high,
    ],
    ['Q3', row.q3, row.q3_ecos, row.q3_ci_low, row.q3_ci_high],
  ] as const
  const rate =
    row.resampling_change_rate == null
      ? null
      : Number(row.resampling_change_rate) * 100
  return (
    <div className="core-relative-detail">
      <p className="core-relative-position">
        회사값 <strong>{format(current?.value)}</strong> ·{' '}
        {assessment?.label ?? '비교 기준 확인 중'}
      </p>
      {assessment?.boundary_note && (
        <p className="vs-core-boundary-note">{assessment.boundary_note}</p>
      )}
      <div
        className="core-quartile-history"
        tabIndex={0}
        role="region"
        aria-label={`${metric.label} 현재 비교 기준`}
      >
        <table className="formula-definition">
          <caption>
            {row.year}년 · {row.comparison_industry ?? '비교산업 미확보'} · 기업
            규모 전체
          </caption>
          <thead>
            <tr>
              <th scope="col">경계</th>
              <th scope="col">값</th>
              <th scope="col">출처</th>
              <th scope="col">95% 신뢰구간</th>
            </tr>
          </thead>
          <tbody>
            {boundaries.map(([label, value, ecos, low, high]) => {
              const validCi =
                low != null && high != null && Number(low) <= Number(high)
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{format(value)}</td>
                  <td>
                    {value == null || ecos == null
                      ? '미확보'
                      : ecos
                        ? 'ECOS'
                        : 'OFS 수집 표본'}
                  </td>
                  <td>
                    {ecos === false
                      ? validCi
                        ? `${format(low)} ~ ${format(high)}`
                        : '확인 불가'
                      : '해당 없음'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {row.source_kind === 'OFS' && (
        <p>
          OFS 수집 표본{' '}
          {row.sample_count == null
            ? '수 미확보'
            : `${row.sample_count.toLocaleString('ko-KR')}개 기업`}
          . 표본이 업종 전체를 대표한다는 보장은 없습니다.
        </p>
      )}
      {rate != null && Number.isFinite(rate) && row.source_kind !== 'ECOS' && (
        <p>
          표본을 다시 뽑아 경계를 계산했을 때 기존 표본 기업의 구간이 평균{' '}
          {rate.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}%
          변경되었습니다. 내 기업의 구간이 바뀔 확률은 아닙니다.
        </p>
      )}
      {assessment?.boundary_proximity === 'UNKNOWN' && (
        <p>경계 부근 여부 확인 불가: OFS 경계의 신뢰구간을 확인해 주세요.</p>
      )}
      <div
        className="core-quartile-history"
        tabIndex={0}
        role="region"
        aria-label={`${metric.label} 업종 기준 5년 이력`}
      >
        <table className="formula-definition">
          <caption>연도별 비교산업·출처와 기준값 ({row.unit})</caption>
          <thead>
            <tr>
              <th scope="col">연도</th>
              <th scope="col">비교산업</th>
              <th scope="col">Q1</th>
              <th scope="col">중앙값</th>
              <th scope="col">Q3</th>
              <th scope="col">표본 수</th>
              <th scope="col">업종합산비율 (참고)</th>
            </tr>
          </thead>
          <tbody>
            {row.history.map((history) => (
              <tr key={history.year}>
                <th scope="row">{history.year}</th>
                <td>
                  {history.comparison_industry ?? '미확보'}
                  <small>
                    {history.source_kind === 'OFS'
                      ? 'OFS 수집 표본'
                      : history.source_kind === 'ECOS'
                        ? 'ECOS'
                        : '출처 확인 필요'}
                  </small>
                </td>
                <td>{format(history.q1)}</td>
                <td>{format(history.median)}</td>
                <td>{format(history.q3)}</td>
                <td>
                  {history.source_kind === 'OFS' && history.sample_count != null
                    ? history.sample_count.toLocaleString('ko-KR')
                    : '—'}
                </td>
                <td>
                  {format(history.aggregate)}
                  <small>
                    {history.aggregate_industry ?? '산업 범위 미확보'}
                  </small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Q1·중앙값·Q3는 값의 크기에 따른 네 상대 구간의 경계입니다. 동점·보간
        때문에 각 구간에 정확히 25%가 들어간다는 뜻은 아닙니다. 신뢰구간
        밖에서도 표본 구성에 따라 구간이 달라질 수 있습니다.
      </p>
      <p>
        업종합산비율 (참고)은 사분위수나 기업별 중앙값이 아닙니다.{' '}
        {metric.key === 'operating_roa'
          ? '총자산영업이익률 업종합산값은 ECOS 지표를 이용한 근사값입니다.'
          : ''}
      </p>
    </div>
  )
}
