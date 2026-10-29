import { Chart } from '../../shared/components/chart'
import { StatusBadge } from '../../shared/components/status-badge'
import { cashflowRows, profitBridge } from './financial-data'
import { financialRows } from '../company/demo-data'

const waterfall = {
  color: ['#FFBC00', '#60584C'],
  tooltip: {
    trigger: 'axis',
    formatter: (items: { dataIndex: number }[]) => {
      const step = profitBridge[items[0]?.dataIndex ?? 0]
      return `${step.label}: ${step.change}억원`
    },
  },
  grid: { left: 45, right: 20, top: 25, bottom: 65 },
  xAxis: {
    type: 'category',
    data: profitBridge.map((step) => step.label),
    axisLabel: { interval: 0, rotate: 15, fontSize: 10 },
  },
  yAxis: {
    type: 'value',
    name: '억원',
    splitLine: { lineStyle: { color: '#eceee8' } },
  },
  series: [
    {
      name: '누적 기준',
      type: 'bar',
      stack: 'bridge',
      itemStyle: { color: 'transparent' },
      emphasis: { itemStyle: { color: 'transparent' } },
      tooltip: { show: false },
      data: profitBridge.map((step) => step.base),
    },
    {
      name: '예시 기여분',
      type: 'bar',
      stack: 'bridge',
      barWidth: 35,
      label: {
        show: true,
        position: 'top',
        formatter: (item: { dataIndex: number }) =>
          profitBridge[item.dataIndex].change,
      },
      data: profitBridge.map((step, index) => ({
        value: step.value,
        itemStyle: {
          color: index === 2 || index === 3 ? '#B42318' : '#60584C',
          borderType: step.label === '기타·조정' ? 'dashed' : 'solid',
        },
      })),
    },
  ],
}
const cashChart = {
  color: ['#FFBC00', '#60584C', '#8b9b87'],
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 50, right: 25, top: 30, bottom: 65 },
  xAxis: { type: 'category', data: ['2024', '2025'] },
  yAxis: {
    type: 'value',
    name: '억원',
    splitLine: { lineStyle: { color: '#eceee8' } },
  },
  series: cashflowRows.slice(0, 3).map(([name, previous, current]) => ({
    name,
    type: 'bar',
    data: [previous, current],
  })),
}

const comparisonChart = {
  color: ['#60584C', '#FFBC00'],
  tooltip: { trigger: 'axis' },
  legend: { bottom: 0 },
  grid: { left: 48, right: 20, top: 25, bottom: 60 },
  xAxis: { type: 'category', data: ['2023', '2024', '2025'] },
  yAxis: { type: 'value', name: '억원' },
  series: [
    {
      name: '영업이익',
      type: 'bar',
      data: [
        financialRows[1].y2023,
        financialRows[1].y2024,
        financialRows[1].y2025,
      ],
    },
    {
      name: '영업활동현금흐름',
      type: 'bar',
      data: [
        financialRows[3].y2023,
        financialRows[3].y2024,
        financialRows[3].y2025,
      ],
      markLine: { silent: true, data: [{ yAxis: 0 }] },
    },
  ],
}

export function CashflowView() {
  return (
    <>
      <div className="financial-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>영업이익 변동 분해</h2>
            <StatusBadge>회계상 분해 · 예시</StatusBadge>
          </div>
          <Chart
            option={waterfall}
            label="영업이익 변동 예시: 2024년 94억원에 매출 증가 60억원, 원가 증가 -42억원, 판관비 증가 -12억원을 반영하면 2025년 100억원. 아래 표에서 확인할 수 있습니다."
          />
          <div className="table-scroll">
            <table aria-label="영업이익 변동 분해">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>예시 금액 (억원)</th>
                </tr>
              </thead>
              <tbody>
                {profitBridge.map((step) => (
                  <tr key={step.label}>
                    <td>{step.label}</td>
                    <td>{step.change}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            매출 +60 − 원가 +42 − 판관비 +12 = 영업이익 +6억원. 회계상
            기여분이며 경영 원인을 단정하지 않습니다.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>영업이익과 영업활동현금흐름</h2>
            <span className="muted">공통 레이아웃 예시 · 억원</span>
          </div>
          <Chart
            option={comparisonChart}
            label="3개년 예시. 영업이익 87·94·100억원, 영업활동현금흐름 72·81·89억원. 0 기준선으로 이익과 현금의 차이를 확인합니다."
          />
          <details className="cash-composition">
            <summary>현금흐름 구성 상세</summary>
            <Chart
              option={cashChart}
              label="영업·투자·재무 현금흐름 구성 예시"
            />
          </details>
          <div className="table-scroll">
            <table aria-label="현금흐름 구성">
              <thead>
                <tr>
                  <th>구분</th>
                  <th>2024 예시</th>
                  <th>2025 예시</th>
                </tr>
              </thead>
              <tbody>
                {cashflowRows.map(([name, previous, current]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{previous}</td>
                    <td>{current}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div className="financial-layout analysis-section">
        <section className="panel">
          <div className="panel-heading">
            <h2>영업이익 → 영업현금흐름</h2>
            <span className="muted">2025 공통 예시 · 억원</span>
          </div>
          <div className="table-scroll">
            <table aria-label="영업현금흐름 조정">
              <thead>
                <tr>
                  <th>조정 항목</th>
                  <th>예시 금액</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['영업이익', 100],
                  ['감가상각', 20],
                  ['매출채권 증가', -15],
                  ['재고 증가', -10],
                  ['매입채무 증가', 5],
                  ['이자·법인세 등 기타 조정', -11],
                  ['영업활동현금흐름', 89],
                ].map(([name, value]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            비현금 조정과 운전자본 변동을 구분합니다. 이자·법인세의 회계 분류는
            실제 보고서 기준으로 확인해야 합니다.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>운전자본·현금전환주기</h2>
            <StatusBadge tone="caution">계산 불가</StatusBadge>
          </div>
          <div className="table-scroll">
            <table aria-label="운전자본 자료 상태">
              <thead>
                <tr>
                  <th>지표</th>
                  <th>상태</th>
                  <th>사유</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>재고 회전일수</td>
                  <td>자료 없음</td>
                  <td>평균 잔액·매출원가 미확보</td>
                </tr>
                <tr>
                  <td>채권·채무 회전일수</td>
                  <td>자료 없음</td>
                  <td>평균 잔액·기초 자료 미확보</td>
                </tr>
                <tr>
                  <td>현금전환주기 (CCC)</td>
                  <td>계산 불가</td>
                  <td>구성 회전일수 미확보</td>
                </tr>
                <tr>
                  <td>계약자산·계약부채 증감</td>
                  <td>자료 없음</td>
                  <td>업종별 원천 미연동</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            미확보 값을 0일이나 정상으로 표시하지 않습니다. 첫해·근사·기간 일수
            정책은 업무 검증이 필요합니다.
          </p>
        </section>
      </div>
    </>
  )
}
