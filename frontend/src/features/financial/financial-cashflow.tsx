import { Chart } from '../../shared/components/chart'
import { StatePanel } from '../../shared/components/state-panel'
import { FinancialValue } from './data-status'
import { money, type FinancialResult } from './api'
import {
  financialFact,
  financialNumber,
  profitBridgeData,
  profitBridgeOption,
  profitCashflowOption,
} from './cashflow-charts'
import './financial-cashflow.css'
import { CashflowBridge } from './cashflow-bridge'
import { CashflowChecks } from './cashflow-checks'
import { CashflowOverview } from './cashflow-overview'
import type { CashflowPeerData } from './cashflow-peer-data'

export function FinancialCashflow({
  result,
  peers,
  demo = false,
}: {
  result: FinancialResult
  peers?: CashflowPeerData
  demo?: boolean
}) {
  const bridge = profitBridgeData(result)
  const currentProfit = financialNumber(
    financialFact(result, 'operating_profit'),
  )
  const currentCash = financialNumber(
    financialFact(result, 'operating_cashflow'),
  )
  const previousCash = financialNumber(
    financialFact(result, 'operating_cashflow', 'previous'),
  )
  const periods = [...result.periods].reverse()
  const hasComparison = periods.some(
    (period) =>
      financialNumber(financialFact(result, 'operating_profit', period.key)) !=
        null ||
      financialNumber(
        financialFact(result, 'operating_cashflow', period.key),
      ) != null,
  )
  const residual = result.profit_bridge?.find((item) =>
    /조정|잔차/.test(item.label),
  )
  const allProfitsPositive =
    periods.length > 1 &&
    periods.every((period) => {
      const value = financialNumber(
        financialFact(result, 'operating_profit', period.key),
      )
      return value != null && value > 0
    })
  const currentPeriod =
    result.periods.find((period) => period.key === 'current')?.label ?? '당기'
  const previousPeriod =
    result.periods.find((period) => period.key === 'previous')?.label ?? '전기'
  const scope = result.context.scope
  const caution = currentCash != null && currentCash < 0
  const signedMoney = (value: string) =>
    `${Number(value) > 0 ? '+' : ''}${money(value)}`
  return (
    <div className="fc-workspace">
      <div className="fc-chart-grid">
        <section className="fc-panel" aria-labelledby="fc-bridge-title">
          <div className="fc-heading">
            <div>
              <h2 id="fc-bridge-title">영업이익 변동 분해</h2>
              <p>
                {previousPeriod} → {currentPeriod} · {scope} · 억원
              </p>
            </div>
            {residual && !bridge.reason && (
              <span className="fc-metadata">
                기타 조정 {signedMoney(residual.value)}
              </span>
            )}
          </div>
          {bridge.points.length ? (
            <Chart
              option={profitBridgeOption(bridge.points)}
              label={`영업이익 변동 워터폴. ${bridge.points.map((point) => `${point.label.replace('\n', ' ')} ${money(point.value)}억원`).join(', ')}. 상세 표에서 원래 금액을 확인할 수 있습니다.`}
            />
          ) : (
            <StatePanel
              state="pending"
              title="영업이익 분해를 표시할 수 없습니다"
              description={bridge.reason ?? '필요한 원천 계정을 확인해 주세요.'}
            />
          )}
          <div className="fc-legend" aria-label="영업이익 변동 범례">
            <span>
              <i className="fc-total" />
              합계
            </span>
            <span>
              <i className="fc-increase" />
              증가
            </span>
            <span>
              <i className="fc-decrease" />
              감소
            </span>
            <span>
              <i className="fc-residual" />
              기타 조정(잔차)
            </span>
          </div>
          <p className="fc-note">
            매출 증감 − 매출원가 증감 − 판관비 증감으로 나눈 회계상 분해입니다.
            사업상 원인을 뜻하지 않습니다.
          </p>
          {bridge.points.length > 0 && (
            <details className="fc-data">
              <summary>분해 금액·검산 보기</summary>
              <table aria-label="영업이익 변동 분해 금액">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>금액 · 억원</th>
                  </tr>
                </thead>
                <tbody>
                  {bridge.points.map((point, index) => (
                    <tr key={`${point.label}:${index}`}>
                      <th scope="row">{point.label.replace('\n', ' ')}</th>
                      <td>
                        {point.total
                          ? money(point.value)
                          : signedMoney(point.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                전기 영업이익 + 기여분 합계 = 당기 영업이익을 원 단위 소수
                6자리까지 검산했습니다.
              </p>
            </details>
          )}
        </section>
        <section className="fc-panel" aria-labelledby="fc-comparison-title">
          <div className="fc-heading">
            <div>
              <h2 id="fc-comparison-title">영업이익과 영업활동현금흐름</h2>
              <p>
                {periods.length}개 비교기간 · {scope} · 억원
              </p>
            </div>
            <label
              className="fc-scope-toggle"
              title="같은 공시의 연결·별도 비교 데이터가 확보되면 사용할 수 있습니다."
            >
              <input type="checkbox" disabled />
              <span aria-hidden="true" />
              {scope === 'OFS' ? 'CFS' : 'OFS'} 비교 <small>자료 미확보</small>
            </label>
          </div>
          <div
            className="fc-legend fc-comparison-legend"
            aria-label="이익·현금흐름 범례"
          >
            <span>
              <i className="fc-total" />
              영업이익
            </span>
            <span>
              <i className="fc-cash" />
              영업활동현금흐름
            </span>
            <span>
              <i className="fc-negative" />
              음수
            </span>
          </div>
          {hasComparison ? (
            <Chart
              option={profitCashflowOption(result)}
              label={`비교기간별 영업이익과 영업활동현금흐름. ${periods.map((period) => `${period.label}: 영업이익 ${money(financialFact(result, 'operating_profit', period.key)?.value)}, 영업CF ${money(financialFact(result, 'operating_cashflow', period.key)?.value)}억원`).join('; ')}. 음수는 0 기준선 아래 빨강으로 표시합니다.`}
            />
          ) : (
            <StatePanel
              state="empty"
              title="비교할 이익·현금흐름 값이 없습니다"
              description="미확보 금액은 0으로 채우지 않습니다."
            />
          )}
          <p className={`fc-note ${caution ? 'fc-note-caution' : ''}`}>
            {currentProfit == null || currentCash == null ? (
              '당기 이익과 현금의 관계를 확인하려면 누락된 계정을 먼저 확보해야 합니다.'
            ) : currentProfit > 0 && currentCash < 0 ? (
              <>
                {allProfitsPositive
                  ? `표시된 ${periods.length}개 비교기간 모두 영업이익은 흑자지만 `
                  : '영업이익은 흑자지만 '}
                영업CF는 {currentPeriod} {money(String(currentCash))}억원
                {previousCash != null && previousCash >= 0
                  ? '으로 음수 전환했습니다.'
                  : '의 유출을 보입니다.'}
              </>
            ) : currentCash < 0 ? (
              <>
                당기 영업활동현금흐름은 {money(String(currentCash))}억원입니다.
                현금 유출과 영업손익을 함께 확인하세요.
              </>
            ) : (
              <>
                당기 영업이익 {money(String(currentProfit))}억원 · 영업CF{' '}
                {money(String(currentCash))}억원입니다. 이익과 현금의 차이는
                원천 계정과 함께 확인하세요.
              </>
            )}
          </p>
          <details className="fc-data">
            <summary>기간별 금액·자료 상태 보기</summary>
            <div className="fc-table-scroll">
              <table aria-label="기간별 영업이익·현금흐름">
                <thead>
                  <tr>
                    <th>항목</th>
                    {periods.map((period) => (
                      <th key={period.key}>{period.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['operating_profit', '영업이익'],
                    ['operating_cashflow', '영업활동현금흐름'],
                  ].map(([key, label]) => (
                    <tr key={key}>
                      <th scope="row">{label}</th>
                      {periods.map((period) => (
                        <td key={period.key}>
                          <FinancialValue
                            value={financialFact(result, key, period.key)}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      </div>
      <CashflowBridge result={result} />
      <CashflowChecks result={result} />
      <CashflowOverview result={result} peers={peers} demo={demo} />
    </div>
  )
}
