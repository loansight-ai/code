import { DataBadge, MetricStatus, MetricValue } from './data-status'
import { dataState, displayedMetricValue } from './data-state'
import type { FinancialMetric, FinancialResult } from './api'
import { bokGap, bokValue } from './bok-data'

const specs = [
  {
    key: 'current_ratio',
    label: '유동비율',
    higherBetter: true,
    tone: 'attention',
    status: '주의',
    reference: 150,
    referenceLabel: '권고',
    max: 260,
  },
  {
    key: 'debt_ratio',
    label: '부채비율',
    higherBetter: false,
    tone: 'warning',
    status: '경고',
    reference: 200,
    referenceLabel: '기준',
    max: 360,
  },
  {
    key: 'operating_margin',
    label: '매출액영업이익률',
    higherBetter: true,
    tone: 'watch',
    status: '관찰',
    reference: 4.8,
    referenceLabel: '업종',
    max: 10,
  },
  {
    key: 'operating_roa',
    label: '총자산영업이익률',
    higherBetter: true,
    tone: 'watch',
    status: '관찰',
    reference: 2.9,
    referenceLabel: '업종',
    max: 6,
  },
  {
    key: 'interest_coverage',
    label: '이자보상비율',
    higherBetter: true,
    tone: 'attention',
    status: '주의',
    reference: 3,
    referenceLabel: '권고',
    max: 5,
  },
] as const
function numeric(value: { value: string | null; state: string } | undefined) {
  return value?.value != null &&
    ['CONFIRMED', 'APPROXIMATE'].includes(value.state) &&
    Number.isFinite(Number(value.value))
    ? Number(value.value)
    : null
}
function formatted(value: number, unit: string) {
  return `${value.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${unit}`
}
const statusLabels = {
  WARNING: '경고',
  CAUTION: '주의',
  DETERIORATING: '악화',
  IMPROVING: '개선',
  UNCHANGED: '변동 없음',
  UNAVAILABLE: '미확보',
  NOT_EVALUATED: '평가 보류',
  CONTEXT_REQUIRED: '업종 확인',
}
const statusTones = {
  WARNING: 'warning',
  CAUTION: 'attention',
  DETERIORATING: 'watch',
  IMPROVING: 'positive',
  UNCHANGED: 'unassessed',
  UNAVAILABLE: 'unassessed',
  NOT_EVALUATED: 'unassessed',
  CONTEXT_REQUIRED: 'unassessed',
}

export function CoreRatioCards({
  result,
  demo,
  onFormula,
}: {
  result: FinancialResult
  demo: boolean
  onFormula: (metric: FinancialMetric, button: HTMLButtonElement) => void
}) {
  const usesEcos =
    !demo &&
    specs.some((spec) => bokValue(result, spec.key)?.source_kind === 'ECOS')
  return (
    <section className="vs-panel vs-core-panel" aria-labelledby="vs-core-title">
      <div className="vs-heading">
        <div>
          <span className="vs-eyebrow">02 / 한눈에 보는 비율</span>
          <h2 id="vs-core-title">공통 핵심 5개 비율</h2>
        </div>
        <span className="vs-muted">
          {demo
            ? '상태·기준선은 예시'
            : result.bok_benchmark
              ? '비교선: 한국은행 업종 평균 · 상태: 기존 규칙'
              : '팀 가설 150% · 200% · 3배 / 수익성은 전기 비교'}
        </span>
      </div>
      <div className="vs-core-grid">
        {specs.map((spec) => {
          const metric = result.metrics.find((m) => m.key === spec.key)
          if (!metric)
            return (
              <article
                className="vs-core-card vs-core-unassessed"
                key={spec.key}
              >
                <span className="vs-core-label">{spec.label}</span>
                <strong className="vs-core-value">자료 없음</strong>
                <span className="vs-muted">지표 미확보</span>
              </article>
            )
          const value = displayedMetricValue(metric, result)
          const current = numeric(value)
          const previous = numeric(
            displayedMetricValue(metric, result, 'previous'),
          )
          const change =
            current != null &&
            previous != null &&
            metric.change != null &&
            Number.isFinite(Number(metric.change))
              ? Number(metric.change)
              : null
          const improving =
            change != null && (spec.higherBetter ? change > 0 : change < 0)
          const changeClass =
            change == null || change === 0
              ? ''
              : improving
                ? 'vs-change-up'
                : 'vs-change-down'
          const assessment = result.core_card_assessments?.find(
            (item) => item.key === spec.key,
          )
          const fallbackStatus =
            current == null
              ? 'UNAVAILABLE'
              : change == null
                ? 'NOT_EVALUATED'
                : change === 0
                  ? 'UNCHANGED'
                  : improving
                    ? 'IMPROVING'
                    : 'DETERIORATING'
          const status = assessment?.status ?? fallbackStatus
          const liveReference = assessment?.reference
          const bok = !demo ? bokValue(result, spec.key) : undefined
          const candidate =
            bok?.value != null
              ? Number(bok.value)
              : liveReference
                ? Number(liveReference.value)
                : previous
          const reference = demo
            ? spec.reference
            : candidate != null && Number.isFinite(candidate)
              ? candidate
              : null
          const referenceLabel = demo
            ? spec.referenceLabel
            : bok?.value != null
              ? `업종 평균 · ${bok.year}`
              : (liveReference?.label ?? '전기')
          const tone = demo ? spec.tone : statusTones[status]
          const referenceSource = demo
            ? '가상 예시'
            : bok?.value != null
              ? `${result.bok_benchmark?.industry_name} · ${bok.source_kind === 'ECOS' ? '한국은행 ECOS' : '한국은행'} · 전체 기업 규모`
              : (liveReference?.source ??
                '동일 공시의 전기 비교값 · 업종 평균 아님')
          const max =
            Math.max(
              demo ? spec.max : 1,
              current ?? 0,
              previous ?? 0,
              reference ?? 0,
            ) * (demo ? 1 : 1.25)
          const min =
            Math.min(0, current ?? 0, previous ?? 0, reference ?? 0) * 1.1
          const position = (n: number) =>
            Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100))
          const adjustedDebt = result.metrics.find(
            (m) => m.key === 'debt_excluding_advances',
          )
          const adjusted = adjustedDebt
            ? numeric(displayedMetricValue(adjustedDebt, result))
            : null
          return (
            <article className={`vs-core-card vs-core-${tone}`} key={spec.key}>
              <div className="vs-core-card-heading">
                <button
                  className="vs-text-button vs-core-label"
                  aria-label={metric.label}
                  onClick={(event) => onFormula(metric, event.currentTarget)}
                >
                  {metric.label}
                </button>
                <div className="vs-core-tags">
                  {demo ? (
                    <>
                      {spec.key === 'interest_coverage' && <span>근사</span>}
                      <span>{spec.status}</span>
                    </>
                  ) : (
                    <>
                      <DataBadge value={value} />
                      <span
                        title={
                          assessment?.reason ??
                          '전기 대비 방향 비교이며 업종 위험 등급이 아닙니다.'
                        }
                      >
                        {statusLabels[status]}
                      </span>
                    </>
                  )}
                </div>
              </div>
              <strong className="vs-core-value">
                {current != null && dataState(value) === 'CONFIRMED' ? (
                  <>
                    {formatted(current, '')}
                    <small>{metric.unit}</small>
                  </>
                ) : (
                  <MetricValue metric={metric} result={result} />
                )}
              </strong>
              <div className="vs-core-comparison">
                <b className={changeClass}>
                  {change == null
                    ? '비교 보류'
                    : `${change < 0 ? '▼ ' : change > 0 ? '▲ ' : ''}${change > 0 ? '+' : ''}${formatted(change, metric.change_unit)}`}
                </b>
                <span>
                  전기{' '}
                  {previous == null
                    ? '자료 없음'
                    : formatted(previous, metric.unit)}
                </span>
              </div>
              <div className="vs-core-subtext">
                {spec.key === 'debt_ratio' && (demo || adjusted != null)
                  ? `선수금 제외 ${formatted(demo ? 164.2 : adjusted!, '%')}`
                  : '\u00a0'}
              </div>
              <div className="vs-core-bullet-area">
                <div
                  className="vs-core-bullet"
                  role="img"
                  aria-label={`${metric.label}: 당기 ${current == null ? '자료 없음' : formatted(current, metric.unit)}, 전기 ${previous == null ? '자료 없음' : formatted(previous, metric.unit)}${reference == null ? ', 기준선 미확보' : `, ${referenceLabel} ${formatted(reference, metric.unit)} · ${referenceSource}`}`}
                >
                  {reference != null && (demo || bok?.value == null) && (
                    <i
                      className="vs-core-risk-range"
                      style={{
                        left: `${spec.higherBetter ? 0 : position(reference)}%`,
                        width: `${spec.higherBetter ? position(reference) : 100 - position(reference)}%`,
                      }}
                    />
                  )}
                  {previous != null && (
                    <>
                      <i
                        className="vs-core-previous-bar"
                        style={{
                          left: `${Math.min(position(0), position(previous))}%`,
                          width: `${Math.abs(position(previous) - position(0))}%`,
                        }}
                      />
                      <i
                        className="vs-core-previous-marker"
                        style={{ left: `${position(previous)}%` }}
                      />
                    </>
                  )}
                  {current != null && (
                    <i
                      className="vs-core-current-bar"
                      style={{
                        left: `${Math.min(position(0), position(current))}%`,
                        width: `${Math.abs(position(current) - position(0))}%`,
                      }}
                    />
                  )}
                  {reference != null && (
                    <i
                      className="vs-core-reference-marker"
                      style={{ left: `${position(reference)}%` }}
                    />
                  )}
                </div>
                <span className="vs-core-reference-caption">
                  {reference == null
                    ? '기준선 비교 보류'
                    : `${referenceLabel} ${formatted(reference, metric.unit)}`}
                </span>
                {!demo && bok && (
                  <span className="vs-muted">
                    {bok.gap != null
                      ? `평균 대비 ${bokGap(bok.gap, metric.unit)}`
                      : (bok.comparison_reason ?? '비교 보류')}
                  </span>
                )}
              </div>
              {dataState(value) !== 'CONFIRMED' && (
                <div className="vs-core-data-detail">
                  <MetricStatus metric={metric} result={result} />
                </div>
              )}
            </article>
          )
        })}
      </div>
      <p className="vs-footnote vs-core-legend">
        바탕·값 색 = 상태 <span className="vs-core-legend-warning">경고</span> ·{' '}
        <span className="vs-core-legend-attention">주의</span> ·{' '}
        <span className="vs-core-legend-watch">관찰</span> │ 증감:{' '}
        <b className="vs-change-down">빨강 = 나빠짐</b> ·{' '}
        <b className="vs-change-up">초록 = 좋아짐</b> (화살표는 방향) │ 막대
        당기 · 회색 전기 · 검은 선 기준
        {demo
          ? ' · 상태·기준선은 가상 예시'
          : ' · 팀 가설은 참고선이며 정상·최종 여신 판단을 뜻하지 않습니다. 업종상 왜곡 지표는 판정을 보류합니다.'}
        {!demo && result.bok_benchmark?.source_url && (
          <>
            {' · '}
            <a
              href={
                usesEcos
                  ? 'https://ecos.bok.or.kr/'
                  : result.bok_benchmark.source_url
              }
              target="_blank"
              rel="noreferrer"
              title={`${result.bok_benchmark.industry_name ?? '업종 미확정'} · 전체 기업 규모 · ${result.bok_benchmark.scope_note ?? ''}`}
            >
              {usesEcos
                ? '한국은행 기업경영분석 · ECOS 보완'
                : '한국은행 기업경영분석'}
            </a>
          </>
        )}
      </p>
    </section>
  )
}
