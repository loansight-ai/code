import { Link } from 'react-router'
import { VisualFinancialSummary } from '../features/financial/visual-summary'
import { visualSummaryExample } from '../features/financial/visual-summary-example'
import { exampleIndustryBenchmark } from '../features/financial/industry-position-example'
import { FinancialCashflow } from '../features/financial/financial-cashflow'

export function VisualSummaryPreviewPage({
  section = 'summary',
}: {
  section?: 'summary' | 'cashflow'
}) {
  return (
    <main id="main" className="page visual-summary-page">
      <div className="page-title-row">
        <div>
          <h1>
            {section === 'cashflow' ? '실적 변동·현금흐름' : '핵심 재무 요약'}
          </h1>
          <p className="page-description">새움건설 · 가상 기업 · 화면 예시</p>
        </div>
        <Link className="button button-outline" to="/">
          실제 기업 분석 →
        </Link>
      </div>
      <div className="vs-demo-banner" id="example-data">
        <strong>예시 데이터</strong>로 화면 구성을 확인하는 페이지입니다.
        금액·비율·자료 상태는 가상의 예시이며 실제 기업 분석이나 위험 판정
        결과가 아닙니다. 기업·보고서 선택 후 재무 분석을 시작하면 핵심 재무
        요약에서 같은 화면을 실제 데이터로 확인할 수 있습니다.
      </div>
      <div className="vs-demo-context">
        <strong>새움건설</strong>
        <span className="vs-pill">건설</span>
        <span>2025 사업보고서 · 예시</span>
        <span>별도(OFS) 기준</span>
        <span>리스 포함</span>
      </div>
      {section === 'cashflow' ? (
        <FinancialCashflow result={visualSummaryExample} />
      ) : (
        <VisualFinancialSummary
          result={visualSummaryExample}
          demo
          benchmark={exampleIndustryBenchmark}
        />
      )}
      <div className="workspace-next">
        <Link
          to={
            section === 'cashflow'
              ? '/examples/financial-summary'
              : '/examples/financial-cashflow'
          }
        >
          {section === 'cashflow' ? '핵심 재무 요약 →' : '실적 변동·현금흐름 →'}
        </Link>
      </div>
    </main>
  )
}
