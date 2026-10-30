import { useRef, useState } from 'react'
import { Chart } from '../../shared/components/chart'
import { StatePanel } from '../../shared/components/state-panel'
import { money, type FinancialResult } from './api'
import {
  cashBridgeData,
  financialFact,
  profitBridgeOption,
} from './cashflow-charts'

export function CashflowBridge({ result }: { result: FinancialResult }) {
  const bridge = cashBridgeData(result)
  const [expanded, setExpanded] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const period =
    result.periods.find((item) => item.key === 'current')?.label ?? '당기'
  const signed = (value: string | null) =>
    value == null
      ? '자료 없음'
      : `${Number(value) > 0 ? '+' : ''}${money(value)}`
  const option = profitBridgeOption(bridge.points, true)
  option.xAxis = {
    ...(option.xAxis as object),
    data: bridge.points.map((point) =>
      point.label
        .replace('매출채권 증감', '매출채권\n증감')
        .replace('계약자산 증감', '계약자산\n증감')
        .replace('재고자산 증감', '재고자산\n증감')
        .replace('매입채무 증감', '매입채무\n증감')
        .replace('계약부채(선수금) 증감', '계약부채(선수금)\n증감'),
    ),
  }
  return (
    <section
      className="fc-panel fc-cash-bridge"
      aria-labelledby="fc-cash-bridge-title"
    >
      <div className="fc-heading">
        <div>
          <h2 id="fc-cash-bridge-title">이익 → 현금 브리지</h2>
          <p>
            영업이익 {money(financialFact(result, 'operating_profit')?.value)}
            억원이 영업활동현금흐름{' '}
            {money(financialFact(result, 'operating_cashflow')?.value)}억원이
            되기까지 · {period} · {result.context.scope} · 억원
          </p>
        </div>
        <button
          type="button"
          className="fc-metadata"
          aria-expanded={expanded}
          aria-controls="fc-cash-bridge-details"
          onClick={() => {
            if (details.current) details.current.open = !expanded
          }}
        >
          차이 설명 표 {expanded ? '접기' : '펼치기'}
        </button>
      </div>
      {bridge.points.length ? (
        <div
          className="fc-bridge-scroll"
          tabIndex={0}
          role="region"
          aria-label="이익에서 현금 브리지 차트 · 좁은 화면에서 가로 스크롤"
        >
          <Chart
            option={option}
            label={`이익에서 현금 브리지. ${bridge.points.map((point) => `${point.label.replace('\n', ' ')} ${signed(point.value)}억원`).join(', ')}. 운전자본은 잔액 증감 근사이며 기타 조정은 미분해 차액입니다.`}
          />
        </div>
      ) : (
        <StatePanel
          state="pending"
          title="이익·현금 브리지를 표시할 수 없습니다"
          description={bridge.reason ?? '자료를 확인해 주세요.'}
        />
      )}
      <p
        className={`fc-note ${bridge.workingCapital != null && Number(bridge.workingCapital) < 0 ? 'fc-note-caution' : ''}`}
      >
        {bridge.workingCapital != null
          ? `표시한 운전자본 잔액 증감의 현금 영향은 ${signed(bridge.workingCapital)}억원으로 근사합니다. `
          : '일부 비교 잔액이 없어 운전자본 전체 영향은 보류합니다. '}
        잔액 증감에는 비현금 거래·환율·사업결합 영향이 섞일 수 있습니다.
        기타·미분해 조정은 실제 현금흐름표에서 확인해야 합니다.
      </p>
      <details
        ref={details}
        id="fc-cash-bridge-details"
        className="fc-data"
        onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
        <summary>조정 금액·산출 근거 보기</summary>
        <div className="fc-table-scroll">
          <table aria-label="이익 현금 차이 설명">
            <thead>
              <tr>
                <th>항목</th>
                <th>현금 방향 조정 · 억원</th>
                <th>산출 근거·한계</th>
              </tr>
            </thead>
            <tbody>
              {bridge.rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{signed(row.value)}</td>
                  <td>{row.basis}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          영업이익 + 표시 조정 합계 = 영업활동현금흐름. 미확보 금액은 0으로
          대체하지 않고 기타·미분해 조정에 남깁니다. 감가상각비의 자료 상태와
          원문 근거는 원천 계정에서 확인합니다.
        </p>
      </details>
    </section>
  )
}
