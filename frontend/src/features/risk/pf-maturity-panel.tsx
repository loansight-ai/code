import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { EChartsCoreOption } from 'echarts/core'
import { Chart } from '../../shared/components/chart'
import { Button } from '../../shared/components/button'
import type { EvidenceBundle } from '../evidence/bundle-api'
import {
  exposureMoney as money,
  useExposureSummary,
  type ExposureSource,
} from '../evidence/exposure-api'
import { ExposureSourceLinks } from '../evidence/exposure-source-links'
import { ExposureSourceDrawer } from '../evidence/exposure-panels'
import './pf-maturity-panel.css'

const states: Record<string, string> = {
  DISCLOSED: '만기 근거 확인',
  RECALCULATED: '대출기간으로 계산',
  UNDISCLOSED: '공시상 만기 미기재',
  MATURITY_UNCONFIRMED: '만기 근거 미확보',
  EXPLICIT_NONE: '공시상 없음',
  CONFLICT: '근거 충돌 · 확인 필요',
  PARTIAL: '일부 자료 · 합계 보류',
  REVIEW_REQUIRED: '사실 검수·근거 확인 필요',
  NOT_DETECTED: '집계할 사실 미확보',
  AMOUNT_UNCONFIRMED: '대출잔액 집계 보류',
}
const methods: Record<string, string> = {
  REPORTED_BAND: '공시 구간',
  MATURITY_DATE: '공시 만기일',
  LOAN_PERIOD: '대출기간으로 계산',
  EXPLICIT_UNDISCLOSED: '공시상 미기재',
  UNCONFIRMED: '만기 근거 미확보',
  CONFLICT: '만기 근거 충돌',
}

export function PfMaturityPanel({
  bundle,
  showDetails = false,
}: {
  bundle: EvidenceBundle
  showDetails?: boolean
}) {
  const query = useExposureSummary(bundle)
  const data = query.data
  const ladder = data?.maturity_ladder
  const [source, setSource] = useState<ExposureSource | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(showDetails)
  const summary =
    ladder?.within_amount != null
      ? `1년 내 만기 ${money(ladder.within_amount)}억원${ladder.within_percent != null ? ` (${Number(ladder.within_percent).toFixed(0)}%)` : ''}`
      : '1년 내 만기 비중 계산 불가'
  const option = useMemo<EChartsCoreOption>(() => {
    if (!ladder) return {}
    const labels = ladder.bins.map((b) => b.label)
    return {
      animation: false,
      grid: { left: 60, right: 25, top: 50, bottom: 55 },
      tooltip: {
        trigger: 'axis',
        renderMode: 'richText',
        valueFormatter: (value: unknown) =>
          `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(Number(value))}억원`,
      },
      xAxis: {
        type: 'category',
        data: labels,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#b7bbb3' } },
        axisLabel: {
          interval: 0,
          fontSize: 11,
          color: '#37404c',
          formatter: (label: string) =>
            label === '만기 미공시·미확인' ? '만기 미공시\n·미확인' : label,
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          fontSize: 10,
          color: '#708098',
          formatter: (value: number) =>
            new Intl.NumberFormat('ko-KR').format(value),
        },
      },
      series: [
        {
          type: 'bar',
          barMaxWidth: 72,
          data: ladder.bins.map((b) => ({
            value: b.amount == null ? null : Number(b.amount) / 100_000_000,
            itemStyle: {
              color:
                b.key === 'UNDISCLOSED'
                  ? '#caccc5'
                  : b.key === 'OVERDUE'
                    ? '#751c17'
                    : b.within_year
                      ? '#b42318'
                      : '#203d62',
              ...(b.key === 'UNDISCLOSED'
                ? {
                    borderColor: '#aeb2a7',
                    borderWidth: 1,
                    decal: {
                      symbol: 'rect',
                      color: 'rgba(255,255,255,.7)',
                      rotation: -Math.PI / 4,
                      dashArrayX: [1, 0],
                      dashArrayY: [4, 4],
                    },
                  }
                : {}),
            },
          })),
          label: {
            show: true,
            position: 'top',
            fontWeight: 600,
            fontSize: 12,
            color: '#15181d',
            formatter: (event: { value: unknown }) =>
              event.value == null
                ? '—'
                : new Intl.NumberFormat('ko-KR', {
                    maximumFractionDigits: 2,
                  }).format(Number(event.value)),
          },
          markArea: {
            silent: true,
            itemStyle: { color: '#fceceb' },
            label: {
              show: true,
              position: 'insideTop',
              color: '#a71913',
              fontSize: 11,
              fontWeight: 600,
            },
            data: [[{ name: summary, xAxis: labels[0] }, { xAxis: labels[2] }]],
          },
        },
      ],
    }
  }, [ladder, summary])
  const choose = useCallback(
    (event: { name?: string }) => {
      const bin = ladder?.bins.find((b) => b.label === event.name)
      if (bin) {
        setSelected(bin.key)
        setExpanded(true)
      }
    },
    [ladder],
  )
  const onlyUnknown =
    ladder &&
    ladder.items.length > 0 &&
    ladder.items.every((item) => item.band === 'UNDISCLOSED')
  const shownItems =
    ladder?.items.filter((item) => !selected || item.band === selected) ?? []
  return (
    <div className="pf-risk-workspace">
      <section
        className="panel pf-ladder-panel"
        aria-label="PF 보증·조건부 의무 만기 사다리"
      >
        <div className="pf-ladder-heading">
          <div>
            <h2>PF 보증·조건부 의무 만기 사다리</h2>
            <p className="pf-ladder-subtitle">
              <strong>{summary}</strong>
              <span>
                {' '}
                · 전체{' '}
                {ladder?.total != null
                  ? `${money(ladder.total)}억원`
                  : '금액 미확보'}{' '}
                ·{' '}
                <Link to="?tab=notes#evidence-guarantees">
                  구성 표 분자 합계
                </Link>{' '}
                · 대출잔액 기준
              </span>
            </p>
          </div>
          <div className="extraction-tags">
            <span>기준일 {data?.as_of ?? bundle.period}부터</span>
            <span>{bundle.scope === 'OFS' ? '별도' : '연결'} · 억원</span>
          </div>
        </div>
        <div className="pf-ladder-status">
          <span>
            {query.isPending
              ? '자료 확인 중'
              : query.isError
                ? '조회 실패'
                : states[ladder?.state ?? 'NOT_DETECTED']}
          </span>
          {ladder?.basis.includes('LOAN_PERIOD') && (
            <span className="pf-recalculated">대출기간으로 계산</span>
          )}
          {!!ladder?.unready_facts && (
            <span>집계 보류 {ladder.unready_facts}개 사실</span>
          )}
        </div>
        {query.isError ? (
          <div className="pf-ladder-empty" role="alert">
            <p>만기 자료를 불러오지 못했습니다.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              다시 조회
            </Button>
          </div>
        ) : query.isPending ? (
          <div className="pf-ladder-empty" role="status">
            검수된 만기 자료를 확인하고 있습니다.
          </div>
        ) : ladder?.state === 'EXPLICIT_NONE' ? (
          <div className="pf-ladder-empty is-absence">
            <h3>공시상 제공 보증 없음</h3>
            {ladder.absence_quotes.map((q, i) => (
              <blockquote key={i}>“{q.quote}”</blockquote>
            ))}
            <p>해당 보고서의 명시적 없음 기재를 확인했습니다.</p>
          </div>
        ) : onlyUnknown ? (
          <div className="pf-ladder-unknown">
            <h3>{states[ladder.state]}</h3>
            <div className="pf-hatched-amount" />
            <p>
              확보 대출잔액 <strong>{money(ladder.known_total)}억원</strong> ·
              1년 내 비중은 계산할 수 없습니다.
            </p>
            <p>공시상 미기재와 아직 확인하지 못한 만기 근거를 구분합니다.</p>
          </div>
        ) : ladder?.items.length ? (
          <div className="pf-ladder-chart-scroll">
            <Chart
              option={option}
              onClick={choose}
              label={`PF 보증 만기 사다리. ${ladder.bins.map((b) => `${b.label} ${money(b.amount)}억원`).join(', ')}. 전체 금액은 만기 미공시를 포함합니다.`}
            />
          </div>
        ) : (
          <div className="pf-ladder-empty">
            <h3>{states[ladder?.state ?? 'NOT_DETECTED']}</h3>
            <p>
              주석 추출 근거에서 대출잔액·만기 근거를 확인하고 사실 검수를
              완료해 주세요.
            </p>
            <Link to="?tab=notes">주석 추출 근거 보기 →</Link>
          </div>
        )}
        <div className="pf-ladder-legend-row">
          <div className="pf-ladder-legend">
            <span>
              <i className="is-within" />
              1년 내 만기
            </span>
            <span>
              <i className="is-beyond" />
              1년 초과
            </span>
            <span>
              <i className="is-unknown" />
              만기 미공시·미확인
            </span>
          </div>
          <p>
            소송은 만기가 없어 사다리에 넣지 않습니다 ·{' '}
            <Link to="?tab=notes#evidence-litigation">소송 현황 보기 →</Link>
          </p>
        </div>
        <div className="pf-ladder-provenance">
          <span>출처: </span>
          {ladder?.sources.length ? (
            <ExposureSourceLinks sources={ladder.sources} onOpen={setSource} />
          ) : (
            <span>원문 미확보</span>
          )}
          <span>
            {' '}
            · 접수번호 {bundle.receipt_no} · 비중 분모는 미공시를 포함한 전체
            금액
          </span>
        </div>
        <p className="pf-ladder-limitation">
          검수 완료된 확보분 기준입니다. 만기 미공시 금액에도 1년 내 만기가
          포함될 수 있습니다.
          {ladder?.state === 'CONFLICT'
            ? ' 서로 다른 만기 근거를 확인할 때까지 비중을 보류합니다.'
            : ''}
        </p>
        <details
          className="pf-ladder-details"
          open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
        >
          <summary>구간별 금액·원문 근거 보기</summary>
          <label>
            만기 구간{' '}
            <select
              value={selected ?? ''}
              onChange={(event) => setSelected(event.target.value || null)}
            >
              <option value="">전체 구간</option>
              {ladder?.bins.map((bin) => (
                <option key={bin.key} value={bin.key}>
                  {bin.label} · {money(bin.amount)}억원
                </option>
              ))}
            </select>
          </label>
          <div className="exposure-table-scroll">
            <table
              className="pf-ladder-source-table"
              aria-label="상세 만기 사다리"
            >
              <thead>
                <tr>
                  <th>항목</th>
                  <th>대출잔액 (억원)</th>
                  <th>만기 구간</th>
                  <th>계산 근거</th>
                  <th>원문</th>
                </tr>
              </thead>
              <tbody>
                {shownItems.map((item, i) => (
                  <tr key={i}>
                    <th scope="row">{item.label}</th>
                    <td>{money(item.amount)}</td>
                    <td>
                      {ladder?.bins.find((b) => b.key === item.band)?.label}
                    </td>
                    <td>
                      {methods[item.basis] ?? item.basis}
                      {item.maturity && <small>{item.maturity}</small>}
                      {item.loan_period && <small>{item.loan_period}</small>}
                    </td>
                    <td>
                      <ExposureSourceLinks
                        sources={[item.source]}
                        onOpen={setSource}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!shownItems.length && (
            <p className="exposure-footnote">
              이 구간으로 집계할 검수 완료 근거가 없습니다.
            </p>
          )}
        </details>
      </section>
      <section className="pf-state-guide" aria-label="자료 상태별 표시 안내">
        <div className="pf-state-guide-heading">
          <h2>자료 상태별 표시 안내</h2>
          <p>
            현재 상태: {states[ladder?.state ?? 'NOT_DETECTED']}. 아래 카드는
            상태에 따른 표시 방식을 설명합니다.
          </p>
        </div>
        <div className="pf-state-cards">
          <article
            className={
              ladder?.basis.includes('LOAN_PERIOD') ? 'is-current' : ''
            }
          >
            <div>
              <h3>구간표 없음 · 사업장별 대출기간 있음</h3>
              <span>재계산 안내</span>
            </div>
            <div className="pf-mini-bar">
              <i />
              <i />
              <i />
            </div>
            <p>
              대출기간의 종료일로 만기 구간을 다시 계산합니다.{' '}
              <strong>‘대출기간으로 계산’</strong> 표시를 붙입니다.
            </p>
          </article>
          <article className={onlyUnknown ? 'is-current' : ''}>
            <div>
              <h3>만기 정보 없음</h3>
              <span>미공시·미확보 구분</span>
            </div>
            <div className="pf-mini-bar is-hatched" />
            <p>
              금액을 미확인 구간에 남기고 1년 내 비중을 보류합니다.{' '}
              <strong>0%로 표시하지 않습니다.</strong>
            </p>
          </article>
          <article
            className={ladder?.state === 'EXPLICIT_NONE' ? 'is-current' : ''}
          >
            <div>
              <h3>제공 보증 없음</h3>
              <span>명시적 없음 확인</span>
            </div>
            <div className="pf-mini-bar is-absence" />
            <p>
              원문에 <strong>‘해당사항 없음’</strong>이 명시되고 검수된 경우에만
              표시합니다. 미검출·미검수와 구분합니다.
            </p>
          </article>
        </div>
      </section>
      {source && (
        <ExposureSourceDrawer
          key={source.segment_id}
          bundle={bundle}
          source={source}
          onClose={() => setSource(null)}
        />
      )}
    </div>
  )
}
