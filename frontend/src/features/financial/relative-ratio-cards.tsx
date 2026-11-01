import type { FinancialMetric, FinancialResult } from './api'
import { DataBadge, MetricStatus, MetricValue } from './data-status'
import { dataState, displayedMetricValue } from './data-state'

const specs = [
  ['current_ratio', '유동비율', true],
  ['debt_ratio', '부채비율', false],
  ['operating_margin', '매출액영업이익률', true],
  ['operating_roa', '총자산영업이익률', true],
  ['interest_coverage', '이자보상비율', true],
] as const

const number = (value: string | null | undefined) =>
  value != null && Number.isFinite(Number(value)) ? Number(value) : null
const format = (value: number, unit = '') =>
  `${value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`

export function RelativeRatioCards({
  result,
  onFormula,
}: {
  result: FinancialResult
  onFormula: (metric: FinancialMetric, button: HTMLButtonElement) => void
}) {
  return (
    <section className="vs-panel vs-core-panel" aria-labelledby="vs-core-title">
      <div className="vs-heading">
        <div>
          <span className="vs-eyebrow">02 / 한눈에 보는 비율</span>
          <h2 id="vs-core-title">공통 핵심 5개 비율</h2>
        </div>
        <span className="vs-muted">같은 연도·비교산업의 상대 구간</span>
      </div>
      <div className="vs-core-grid">
        {specs.map(([key, label, higherBetter]) => {
          const metric = result.metrics.find((m) => m.key === key)
          if (!metric)
            return (
              <article className="vs-core-card vs-core-unassessed" key={key}>
                <span className="vs-core-label">{label}</span>
                <strong className="vs-core-value">자료 없음</strong>
                <span className="vs-muted">비교할 수 없음</span>
              </article>
            )
          const value = displayedMetricValue(metric, result)
          const previousValue = displayedMetricValue(metric, result, 'previous')
          const current =
            dataState(value) === 'CONFIRMED' ? number(value?.value) : null
          const previous =
            dataState(previousValue) === 'CONFIRMED'
              ? number(previousValue?.value)
              : null
          const assessment = result.core_card_assessments?.find(
            (a) => a.key === key,
          )
          const row = result.core_ratio_benchmark?.metrics.find(
            (m) => m.key === key,
          )
          const allowed = assessment?.comparison_allowed === true
          const change =
            current != null && previous != null ? number(metric.change) : null
          const deltaClass = !change
            ? ''
            : (higherBetter ? change > 0 : change < 0)
              ? 'vs-change-up'
              : 'vs-change-down'
          const boundaries = [row?.q1, row?.median, row?.q3].map(number)
          const points = [current, previous, ...boundaries].filter(
            (n): n is number => n != null,
          )
          const low = Math.min(0, ...points)
          const high = Math.max(1, ...points)
          const margin = (high - low) * 0.08
          const position = (n: number) =>
            ((n - low + margin) / (high - low + margin * 2)) * 100
          const source =
            row?.source_kind === 'OFS'
              ? 'OFS 수집 표본'
              : row?.source_kind === 'ECOS'
                ? 'ECOS'
                : row?.source_kind === 'MIXED'
                  ? 'ECOS·OFS 혼합 기준'
                  : '출처 확인 중'
          const median = boundaries[1]
          const adjustedMetric =
            key === 'debt_ratio'
              ? result.metrics.find((m) => m.key === 'debt_excluding_advances')
              : undefined
          const adjustedValue = adjustedMetric
            ? displayedMetricValue(adjustedMetric, result)
            : undefined
          const adjusted =
            dataState(adjustedValue) === 'CONFIRMED'
              ? number(adjustedValue?.value)
              : null
          return (
            <article
              className="vs-core-card vs-core-unassessed vs-core-relative"
              key={key}
            >
              <div className="vs-core-card-heading">
                <button
                  className="vs-text-button vs-core-label"
                  aria-label={label}
                  onClick={(e) => onFormula(metric, e.currentTarget)}
                >
                  {label}
                </button>
                <div className="vs-core-tags">
                  <DataBadge value={value} />
                </div>
              </div>
              <strong className="vs-core-value">
                {current == null ? (
                  <MetricValue metric={metric} result={result} />
                ) : (
                  <>
                    {format(current)}
                    <small>{metric.unit}</small>
                  </>
                )}
              </strong>
              <span
                className="vs-core-relative-label"
                title={assessment?.reason}
              >
                {assessment?.label ?? '비교 기준 확인 중'}
              </span>
              <div className="vs-core-comparison">
                <b className={deltaClass}>
                  {change == null
                    ? '전기 비교 보류'
                    : `${change < 0 ? '▼ ' : change > 0 ? '▲ +' : ''}${format(change, metric.change_unit)}`}
                </b>
                <span>
                  전기{' '}
                  {previous == null
                    ? '자료 없음'
                    : format(previous, metric.unit)}
                </span>
              </div>
              <div className="vs-core-subtext">
                {adjusted == null
                  ? '\u00a0'
                  : `선수금 제외 ${format(adjusted, '%')}`}
              </div>
              <div className="vs-core-source">
                <span>
                  {row?.year ?? result.context.fiscal_year}년 ·{' '}
                  {row?.comparison_industry ?? '비교산업 미확보'}
                </span>
                <span>
                  {source}
                  {row?.source_kind === 'OFS' && row.sample_count != null
                    ? ` ${row.sample_count.toLocaleString('ko-KR')}개 기업`
                    : ''}
                </span>
              </div>
              <div className="vs-core-bullet-area">
                <div
                  className="vs-core-bullet vs-core-relative-bullet"
                  role="img"
                  aria-label={`${label}: 당기 ${current == null ? '자료 없음' : format(current, metric.unit)}, Q1 ${boundaries[0] == null ? '미확보' : format(boundaries[0], metric.unit)}, 중앙값 ${median == null ? '미확보' : format(median, metric.unit)}, Q3 ${boundaries[2] == null ? '미확보' : format(boundaries[2], metric.unit)}. ${assessment?.label ?? '비교 기준 확인 중'}`}
                >
                  {allowed &&
                    boundaries.map((boundary, i) =>
                      boundary == null ? null : (
                        <i
                          key={i}
                          className={
                            i === 1
                              ? 'vs-core-reference-marker'
                              : 'vs-core-boundary-marker'
                          }
                          style={{ left: `${position(boundary)}%` }}
                        />
                      ),
                    )}
                  {previous != null && (
                    <i
                      className="vs-core-previous-marker"
                      style={{ left: `${position(previous)}%` }}
                    />
                  )}
                  {current != null && (
                    <i
                      className="vs-core-current-bar"
                      style={{ left: 0, width: `${position(current)}%` }}
                    />
                  )}
                </div>
                <span className="vs-core-reference-caption">
                  {median == null
                    ? '중앙값 미확보'
                    : `${allowed ? '중앙값' : '참고 중앙값'} ${format(median, metric.unit)}`}
                </span>
                {!allowed && (
                  <p className="vs-core-position-note">
                    {assessment?.reason ??
                      row?.comparison_reason ??
                      '비교 기준 확인 중'}
                  </p>
                )}
                {assessment?.boundary_note && (
                  <p className="vs-core-boundary-note">
                    {assessment.boundary_note}
                  </p>
                )}
                {assessment?.flags?.map((flag) => (
                  <p className="vs-core-position-note" key={flag}>
                    {flag}
                  </p>
                ))}
              </div>
              {dataState(value) !== 'CONFIRMED' && (
                <div className="vs-core-data-detail">
                  <MetricStatus metric={metric} result={result} />
                </div>
              )}
              <button
                className="vs-text-button vs-core-detail-button"
                onClick={(e) => onFormula(metric, e.currentTarget)}
                aria-label={`${label} 상세 보기`}
              >
                상세 보기 ›
              </button>
            </article>
          )
        })}
      </div>
      <p className="vs-footnote vs-core-legend">
        상대 구간은 값의 크기에 따른 위치입니다. 부채비율이 높다는 이유로 재무
        상태가 좋다고 해석하지 않습니다. 막대 끝은 당기, 회색 선은 전기, 검은
        선은 중앙값이며 가는 선은 Q1·Q3입니다. 표본 수·경계의 95%
        신뢰구간·재추출 민감도와 5년 기준은 상세 보기에서 확인합니다.
      </p>
    </section>
  )
}
