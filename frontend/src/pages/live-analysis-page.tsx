import { Link, useParams } from 'react-router'
import { useNoteWorkspace } from '../features/analysis/use-note-workspace'
import {
  FinancialOverview,
  IndustryMetrics,
  PredictionWorkspace,
} from '../features/analysis/workspace-panels'
import { LiveReviewWorkspace } from '../features/review/live-review-workspace'
import { StatePanel } from '../shared/components/state-panel'
import { NoteResultsPage } from './note-results-page'

const titles: Record<string, string> = {
  summary: '핵심 재무 요약',
  cashflow: '실적 변동·현금흐름',
  prediction: '위험 사건 예측과 근거',
  review: '체크·검토 메모',
}
export function LiveAnalysisPage() {
  const { structureId = '', section = 'evidence' } = useParams()
  const id = structureId.toLowerCase()
  const note = useNoteWorkspace(id)
  if (section === 'evidence') return <NoteResultsPage />
  if (!note.valid || !titles[section])
    return (
      <main id="main" className="page">
        <StatePanel state="error" title="분석 화면 주소를 확인해 주세요" />
      </main>
    )
  if (note.session?.phase === 'loading' || note.session?.phase === 'changing')
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="접속 상태를 확인하고 있습니다" />
      </main>
    )
  if (!note.session?.session)
    return (
      <main id="main" className="page">
        <StatePanel state="pending" title="사용자 코드로 접속해 주세요" />
      </main>
    )
  if (note.isPending)
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="분석 기준을 확인하고 있습니다" />
      </main>
    )
  if (note.isError || !note.data?.hierarchy)
    return (
      <main id="main" className="page">
        <StatePanel
          state="error"
          title="수집 결과를 확인하지 못했습니다"
          action={{
            label: '다시 조회',
            onClick: () => {
              void note.refetch()
            },
          }}
        />
      </main>
    )
  const metadata = note.data
  return (
    <main id="main" className="page">
      <div className="page-title-row">
        <div>
          <h1>{titles[section]}</h1>
          <p className="page-description">
            {metadata.company_name ?? metadata.corp_code} · {metadata.period}{' '}
            결산 · {metadata.scope} · 수집한 원문 기준
          </p>
        </div>
        <span className="classification-tag">검수 전</span>
      </div>
      {section !== 'review' && (
        <p className="notice">
          주석 원문과 근거 탐색은 연결되어 있습니다. 재무 계산·위험규칙·외부
          모델 결과는 아직 확보되지 않아 자료 없음으로 표시합니다.
        </p>
      )}
      {section === 'summary' && (
        <>
          <FinancialOverview />
          <div className="financial-layout analysis-section">
            <section className="panel">
              <div className="panel-heading">
                <h2>핵심 재무 비율</h2>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>지표</th>
                    <th>당기</th>
                    <th>전기</th>
                    <th>자료 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {['유동성', '레버리지', '활동성', '수익성', '성장성'].map(
                    (v) => (
                      <tr key={v}>
                        <td>{v}</td>
                        <td>—</td>
                        <td>—</td>
                        <td>계정·산식 미확보</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>상환능력·차입 구성</h2>
              </div>
              <StatePanel
                state="pending"
                title="검증된 차입 자료가 없습니다"
                description="단기·유동성장기·장기·사채·리스부채와 이자비용을 확인한 뒤 제공합니다."
              />
            </section>
          </div>
          <IndustryMetrics />
        </>
      )}
      {section === 'cashflow' && (
        <>
          <div className="financial-layout">
            <section className="panel">
              <div className="panel-heading">
                <h2>영업이익 변동 분해</h2>
              </div>
              <StatePanel
                state="pending"
                title="워터폴 계산에 필요한 계정이 없습니다"
                description="매출·매출원가·판관비·영업이익을 확보한 뒤 기타·조정 잔차와 함께 표시합니다."
              />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>업종 비교</h2>
              </div>
              <StatePanel
                state="pending"
                title="비교 보류"
                description="같은 기간·회계 기준의 표본과 업종 통계 원천이 필요합니다."
              />
            </section>
          </div>
          <div className="financial-layout analysis-section">
            <section className="panel">
              <div className="panel-heading">
                <h2>영업이익과 영업활동현금흐름</h2>
              </div>
              <StatePanel
                state="pending"
                title="3개년 비교 자료 미확보"
                description="비현금 조정·운전자본·이자·법인세 지급 항목이 확보되면 이익과 현금의 차이를 구분합니다."
              />
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>영업순환·운전자본</h2>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>지표</th>
                    <th>당기</th>
                    <th>전기</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    '재고 회전일수',
                    '매출채권 회수일수',
                    '매입채무 지급일수',
                    '현금전환주기',
                    '계약자산·계약부채 변화',
                  ].map((v) => (
                    <tr key={v}>
                      <td>{v}</td>
                      <td>미확보</td>
                      <td>미확보</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
      {section === 'prediction' && <PredictionWorkspace />}
      {section === 'review' && (
        <LiveReviewWorkspace
          key={`${note.workspaceId}:${id}:${metadata.source_sha256}`}
          metadata={metadata}
          workspaceId={note.workspaceId!}
        />
      )}
      {section !== 'review' && (
        <div className="workspace-next">
          <Link to={`/notes/${id}/evidence?tab=notes`}>
            주석 추출 근거에서 원문 확인 →
          </Link>
          <Link to={`/notes/${id}/review`}>체크·검토 메모 →</Link>
        </div>
      )}
    </main>
  )
}
