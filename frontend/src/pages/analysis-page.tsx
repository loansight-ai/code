import { Suspense, lazy } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { findCompany } from '../features/company/demo-data'
import {
  contextKey,
  demoVersions,
  type DemoContext,
} from '../features/analysis/demo-context'
import { RatioPanel } from '../features/financial/ratio-panel'
import { StatePanel } from '../shared/components/state-panel'
import { StatusBadge } from '../shared/components/status-badge'
import {
  FinancialOverview,
  IndustryMetrics,
  PredictionWorkspace,
} from '../features/analysis/workspace-panels'

const FinancialView = lazy(() =>
  import('../features/financial/financial-view').then((module) => ({
    default: module.FinancialView,
  })),
)
const CashflowView = lazy(() =>
  import('../features/financial/cashflow-view').then((module) => ({
    default: module.CashflowView,
  })),
)
const RiskEvidenceView = lazy(() =>
  import('../features/risk/risk-evidence-view').then((module) => ({
    default: module.RiskEvidenceView,
  })),
)
const ReviewWorkspace = lazy(() =>
  import('../features/review/review-workspace').then((module) => ({
    default: module.ReviewWorkspace,
  })),
)
const titles: Record<string, string> = {
  summary: '핵심 재무 요약',
  cashflow: '실적 변동·현금흐름',
  evidence: '주석·위험징후',
  prediction: '위험 사건 예측과 근거',
  review: '체크·검토 메모',
}

export function AnalysisPage() {
  const { analysisId, section = 'summary' } = useParams()
  const [params] = useSearchParams()
  const company = findCompany(analysisId)
  const report = params.get('report') ?? '2025'
  const scope = params.get('scope') ?? 'CFS'
  const lease = params.get('lease') ?? 'include'
  if (
    !company ||
    !titles[section] ||
    !['2025', '2024', '2023'].includes(report) ||
    !['CFS', 'OFS'].includes(scope) ||
    (lease !== 'include' && lease !== 'exclude')
  )
    return (
      <main id="main" className="page">
        <h1>분석 기준을 확인해 주세요</h1>
        <p>해당 예시 분석 또는 조회 조건을 찾을 수 없습니다.</p>
        <Link to="/">기업 다시 선택</Link>
      </main>
    )
  const context: DemoContext = {
    companyId: company.id,
    companyName: company.name,
    industry: company.industry!,
    report,
    scope,
    lease,
  }
  return (
    <AnalysisContent
      key={`${context.companyId}.${context.report}.${context.scope}.${demoVersions.source}`}
      context={context}
      section={section}
    />
  )
}

function AnalysisContent({
  context,
  section,
}: {
  context: DemoContext
  section: string
}) {
  const company = findCompany(context.companyId)!
  return (
    <main id="main" className="page">
      <Link
        to={`/?${new URLSearchParams({ company: company.id, report: context.report, scope: context.scope, lease: context.lease })}`}
        className="back-link"
      >
        <ArrowLeft size={14} />
        기업 다시 선택
      </Link>
      <div className="page-title-row">
        <div>
          <h1>{titles[section]}</h1>
          <p className="page-description">
            {company.name}의 재무와 검토 근거를 한곳에서 확인합니다.
          </p>
        </div>
        <span className="demo-label">예시 분석</span>
      </div>
      <div className="source-strip legacy-source-strip">
        <strong>{company.name}</strong>
        {[
          company.code,
          company.market,
          company.industry,
          `${context.report} 사업보고서`,
          context.scope === 'CFS' ? '연결 CFS' : '별도 OFS',
          `리스부채 ${context.lease === 'include' ? '포함' : '제외'}`,
        ].map((text) => (
          <span key={text}>{text}</span>
        ))}
        <span>출처 revision: {demoVersions.source}</span>
        <span>접수번호·수집일: 미연동</span>
        <span>재무 기준일·결산월: 미연동</span>
      </div>
      <div className="notice">
        <ShieldAlert size={17} />
        <span>
          모든 기업·보고서·회계 범위에 동일한 2025 중심 공통 예시를 사용합니다.
          실제 수집·규칙 판정·모델 확률이 아닙니다. 조회 기준과 리스 옵션별 로컬
          검토 기록은 분리합니다.
        </span>
      </div>
      <Suspense
        fallback={
          <StatePanel state="loading" title="분석 화면을 불러오는 중입니다." />
        }
      >
        {section === 'summary' && (
          <>
            <FinancialOverview demo lease={context.lease} />
            <RatioPanel context={context} />
            <IndustryMetrics industry={context.industry} />
            <details className="supplementary-data" open>
              <summary>3개년 실적·주요 재무 계정</summary>
              <FinancialView />
            </details>
          </>
        )}
        {section === 'cashflow' && <CashflowView />}
        {section === 'evidence' && (
          <RiskEvidenceView key={contextKey(context)} context={context} />
        )}
        {section === 'review' && (
          <ReviewWorkspace key={contextKey(context)} context={context} />
        )}
        {section === 'prediction' && (
          <section className="prediction-page">
            <PredictionWorkspace />
            <div className="prediction-availability">
              <StatePanel
                state="pending"
                title="외부 모델과 검증 결과가 연결되지 않았습니다"
                description="모델·입력 계약·검증 보고서 확인 후 확률을 표시합니다. 현재 위험징후와 미래 12개월 위험 사건 예측은 별도로 확인합니다."
              >
              <StatusBadge tone="caution">모델 미연동</StatusBadge>
                <div className="pending-grid">
                  <div>
                    기준 모델<strong>미연동</strong>
                  </div>
                  <div>
                    결합 모델<strong>미연동</strong>
                  </div>
                  <div>
                    예측 공시일<strong>미확보</strong>
                  </div>
                </div>
              </StatePanel>
            </div>
          </section>
        )}
      </Suspense>
    </main>
  )
}
