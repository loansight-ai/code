import { Link, useLocation, useParams } from 'react-router'
import { analysisMenus } from '../app/analysis-menu'
import { StatePanel } from '../shared/components/state-panel'

export function AnalysisEntryPage() {
  const { section } = useParams()
  const location = useLocation()
  const title = analysisMenus.find(([key]) => key === section)?.[1]
  return (
    <main id="main" className="page">
      <h1>{title ?? '분석 화면'}</h1>
      <StatePanel
        state={title ? 'pending' : 'error'}
        title={
          title
            ? '기업·보고서를 선택해 주세요'
            : '분석 화면 주소를 확인해 주세요'
        }
        description="기업 검색에서 분석 대상을 선택하고 핵심 재무 분석을 시작하면 결과를 확인할 수 있습니다."
      >
        <Link to={`/${location.search}`}>기업 검색으로 이동 →</Link>
      </StatePanel>
    </main>
  )
}
