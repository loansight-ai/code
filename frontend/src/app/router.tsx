import { createBrowserRouter, redirect } from 'react-router'
import { Shell } from './shell'
import { CompanyPage } from '../pages/company-page'
import { AnalysisPage } from '../pages/analysis-page'
import { LiveAnalysisPage } from '../pages/live-analysis-page'
import { FinancialSummaryPage } from '../pages/financial-summary-page'
import { AnalysisEntryPage } from '../pages/analysis-entry-page'
import { VisualSummaryPreviewPage } from '../pages/visual-summary-preview-page'

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <CompanyPage /> },
      { path: '/workspace/:section', element: <AnalysisEntryPage /> },
      { path: '/analyses/:analysisId/:section?', element: <AnalysisPage /> },
      { path: '/notes/:structureId/:section?', element: <LiveAnalysisPage /> },
      {
        path: '/preview/financial-summary',
        loader: ({ request }) =>
          redirect(`/examples/financial-summary${new URL(request.url).search}`),
      },
      {
        path: '/examples/financial-summary',
        element: <VisualSummaryPreviewPage />,
      },
      {
        path: '/financials/:financialId/summary-preview',
        loader: ({ params, request }) =>
          redirect(
            `/financials/${params.financialId}/summary${new URL(request.url).search}`,
          ),
      },
      {
        path: '/financials/:financialId/:section?',
        element: <FinancialSummaryPage />,
      },
      {
        path: '*',
        element: (
          <main className="page">
            <h1>페이지를 찾을 수 없습니다</h1>
            <a href="/">기업 검색으로 돌아가기</a>
          </main>
        ),
      },
    ],
  },
])
