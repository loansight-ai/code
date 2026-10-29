import { createBrowserRouter } from 'react-router'
import { Shell } from './shell'
import { CompanyPage } from '../pages/company-page'
import { AnalysisPage } from '../pages/analysis-page'
import { LiveAnalysisPage } from '../pages/live-analysis-page'

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <CompanyPage /> },
      { path: '/analyses/:analysisId/:section?', element: <AnalysisPage /> },
      { path: '/notes/:structureId/:section?', element: <LiveAnalysisPage /> },
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
