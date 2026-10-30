import type { EChartsCoreOption } from 'echarts/core'
import type { CustomSeriesOption } from 'echarts/charts'
import { Chart } from '../../shared/components/chart'
import { money, reasonLabels, type FinancialResult } from './api'
import { FinancialValue } from './data-status'
import { workingCapitalDays, cashflowCheckRows } from './cashflow-check-data'
import { financialFact, financialNumber } from './cashflow-charts'
import { scaledFontSize } from '../../shared/typography'

function daysOption(
  rows: ReturnType<typeof workingCapitalDays>,
): EChartsCoreOption {
  const renderItem: NonNullable<CustomSeriesOption['renderItem']> = (
    params,
    api,
  ) => {
    const row = rows[params.dataIndex]
    const y = api.coord([0, params.dataIndex])[1]
    const now = row.now == null ? null : api.coord([row.now, params.dataIndex])
    const before =
      row.before == null ? null : api.coord([row.before, params.dataIndex])
    const worse =
      row.now != null &&
      row.before != null &&
      (row.lowerBetter ? row.now > row.before : row.now < row.before)
    const color = row.before == null ? '#60584c' : worse ? '#b42318' : '#16786a'
    return {
      type: 'group',
      children: [
        ...(now && before
          ? [
              {
                type: 'line' as const,
                shape: { x1: before[0], y1: y, x2: now[0], y2: y },
                style: { stroke: worse ? '#e7a59b' : '#a4c7bd', lineWidth: 3 },
              },
            ]
          : []),
        ...(before
          ? [
              {
                type: 'circle' as const,
                shape: { cx: before[0], cy: y, r: 4 },
                style: { fill: 'white', stroke: '#aba69d', lineWidth: 2 },
              },
            ]
          : []),
        ...(now
          ? [
              {
                type: 'circle' as const,
                shape: { cx: now[0], cy: y, r: 4 },
                style: { fill: color },
              },
            ]
          : []),
        {
          type: 'text',
          style: {
            x: api.getWidth() - 90,
            y,
            text:
              row.now == null
                ? '보류'
                : `${row.now.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}일${row.before == null ? '' : ` (${row.now - row.before > 0 ? '+' : ''}${(row.now - row.before).toLocaleString('ko-KR', { maximumFractionDigits: 1 })})`}`,
            fill: row.now == null ? '#8c9087' : color,
            fontSize: scaledFontSize(10),
            verticalAlign: 'middle',
          },
        },
      ],
    }
  }
  return {
    animation: false,
    grid: { left: 115, right: 100, top: 25, bottom: 12 },
    xAxis: {
      type: 'value',
      position: 'top',
      splitNumber: 2,
      axisLabel: { fontSize: 10, color: '#92978f', formatter: '{value}일' },
      splitLine: { lineStyle: { color: '#efefeb' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((row) => row.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { fontSize: 10, color: '#586054' },
    },
    series: [
      {
        type: 'custom',
        renderItem,
        dimensions: ['row', 'before', 'now'],
        encode: { x: [1, 2], y: 0 },
        data: rows.map((row, i) => [i, row.before, row.now]),
      },
    ],
  }
}
export function CashflowChecks({ result }: { result: FinancialResult }) {
  const construction = result.industry === '건설'
  const days = workingCapitalDays(result)
  const check = cashflowCheckRows(result)
  const balanceKeys = construction
    ? ['contract_assets', 'contract_liabilities']
    : ['receivables', 'inventory']
  return (
    <div className="fc-chart-grid fc-check-grid">
      <section className="fc-panel" aria-labelledby="fc-working-title">
        <div className="fc-heading">
          <div>
            <h2 id="fc-working-title">
              운전자본{result.industry ? ` · ${result.industry}` : ''}
            </h2>
            <p>기말 잔액 기준 · 전기 → 당기</p>
          </div>
          <span className="fc-metadata">전기 비교</span>
        </div>
        <div className="fc-balance-cards">
          {balanceKeys.map((key) => {
            const current = financialFact(result, key)
            const previous = financialFact(result, key, 'previous')
            const now = financialNumber(current)
            const before = financialNumber(previous)
            const change = now == null || before == null ? null : now - before
            const growth =
              change != null && before != null && before > 0
                ? (change / before) * 100
                : null
            return (
              <div className="fc-balance-card" key={key}>
                <span>
                  {current?.label ??
                    (key === 'contract_assets'
                      ? '계약자산'
                      : key === 'contract_liabilities'
                        ? '계약부채'
                        : key === 'receivables'
                          ? '매출채권'
                          : '재고자산')}{' '}
                  증감
                </span>
                <strong
                  className={
                    change != null &&
                    change > 0 &&
                    key !== 'contract_liabilities'
                      ? 'fc-text-negative'
                      : ''
                  }
                >
                  {change == null
                    ? '자료 없음'
                    : `${change > 0 ? '+' : ''}${money(String(change))}`}
                  <small>{change == null ? '' : ' 억원'}</small>
                </strong>
                <small>
                  {growth == null
                    ? '비교 증감률 보류'
                    : `전기 대비 ${growth > 0 ? '+' : ''}${growth.toFixed(1)}%`}
                  {current?.state === 'APPROXIMATE' ||
                  previous?.state === 'APPROXIMATE'
                    ? ' · 근사'
                    : ''}
                </small>
              </div>
            )
          })}
          <div className="fc-balance-card">
            <span>{days[0].label}기간</span>
            <strong>
              <FinancialValue value={days[0].current} unit="일" />
            </strong>
            <small>
              전기 <FinancialValue value={days[0].previous} unit="일" /> · 업종
              비교 보류
            </small>
          </div>
        </div>
        {days.some((row) => row.now != null || row.before != null) ? (
          <div className="fc-days-scroll">
            <Chart
              option={daysOption(days)}
              label={`운전자본 전기 당기 일수 비교. ${days.map((row) => `${row.label}: 전기 ${row.before ?? '자료 없음'}, 당기 ${row.now ?? '자료 없음'}`).join('; ')}. 빨강은 비교 방향상 악화, 초록은 개선입니다.`}
            />
          </div>
        ) : (
          <div className="fc-days-pending">
            {days.map((row) => (
              <div key={row.key}>
                <span>{row.label}</span>
                <span>비교 보류</span>
              </div>
            ))}
            <p>회전일수 산식·필수 자료 확보 후 전기·당기 비교를 표시합니다.</p>
          </div>
        )}
        <p className="fc-day-legend">
          ○ 전기 · ● 당기 · 빨강: 현금회전상 악화 · 초록: 개선
        </p>
        <p className="fc-days-context">
          매입채무 지급기간은 단축 시 빨강으로 표시합니다. 지급 지연의
          신용위험은 별도 확인이 필요합니다.
        </p>
        <details className="fc-data">
          <summary>일수·자료 상태 보기</summary>
          <div className="fc-table-scroll">
            <table aria-label="운전자본 일수 자료 상태">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>당기</th>
                  <th>전기</th>
                  <th>기준·보류 사유</th>
                </tr>
              </thead>
              <tbody>
                {days.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    <td>
                      <FinancialValue value={row.current} unit="일" />
                    </td>
                    <td>
                      <FinancialValue value={row.previous} unit="일" />
                    </td>
                    <td>
                      {row.current?.reason
                        ? (reasonLabels[row.current.reason] ??
                          row.current.reason)
                        : (result.metrics.find((item) => item.key === row.key)
                            ?.basis ?? '자료 미확보')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
      <section className="fc-panel" aria-labelledby="fc-check-title">
        <div className="fc-heading">
          <div>
            <h2 id="fc-check-title">현금흐름 확인 항목</h2>
            <p>검토할 항목과 판단에 필요한 자료를 확인합니다.</p>
          </div>
        </div>
        <div className="fc-table-scroll">
          <table className="fc-check-table" aria-label="현금흐름 확인 항목">
            <thead>
              <tr>
                <th>항목</th>
                <th>값</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">영업CF ÷ 유동부채</th>
                <td>
                  {check.cash != null && check.cash < 0 ? (
                    <>
                      <span className="fc-status fc-status-pending">
                        계산 불가
                      </span>{' '}
                      <strong className="fc-text-negative">
                        {money(String(check.cash))}억
                      </strong>
                    </>
                  ) : (
                    <FinancialValue value={check.ratio} unit="%" />
                  )}
                </td>
                <td>
                  <span
                    className={`fc-status ${check.cash != null && check.cash < 0 ? 'fc-status-check' : 'fc-status-pending'}`}
                  >
                    {check.cash != null && check.cash < 0
                      ? '확인 필요'
                      : '평가 보류'}
                  </span>
                </td>
              </tr>
              <tr>
                <th scope="row">단기차입으로 장기부채 상환</th>
                <td>자금 용도 미확보</td>
                <td>
                  <span className="fc-status fc-status-pending">판단 보류</span>
                </td>
              </tr>
              <tr>
                <th scope="row">과다 배당 (배당 &gt; 영업CF)</th>
                <td>배당 지급 자료 미확보</td>
                <td>
                  <span className="fc-status fc-status-pending">판단 보류</span>
                </td>
              </tr>
              <tr>
                <th scope="row">흑자 중 영업CF 음수</th>
                <td>
                  {check.hasProfitCash
                    ? `${check.negativePeriods}개 비교기간`
                    : '비교 자료 미확보'}
                </td>
                <td>
                  <span
                    className={`fc-status ${check.negativePeriods > 0 ? 'fc-status-watch' : 'fc-status-pending'}`}
                  >
                    {check.negativePeriods > 0 ? '관찰' : '평가 보류'}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="fc-note">
          영업CF가 음수면 비율을 표시하지 않고 금액과 상태를 보여 줍니다. 차입
          잔액 증감만으로 상환 용도를 판단하지 않으며, 미확보 항목을 정상으로
          처리하지 않습니다.
        </p>
      </section>
    </div>
  )
}
