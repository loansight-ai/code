import { useState } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CircleHelp } from 'lucide-react'
import { findCompany } from '../features/company/demo-data'
import { searchCompanies } from '../features/company/api'
import { useNoteWorkspace } from '../features/analysis/use-note-workspace'
import { Modal } from '../shared/components/modal'
import { SessionControls } from '../features/session/session-controls'
import { TaskControls } from '../features/tasks/task-controls'
import { useSession } from '../features/session/session-context'
import { getFinancialRun } from '../features/financial/api'

const menus = [
  ['summary', '핵심 재무 요약'],
  ['cashflow', '실적 변동·현금흐름'],
  ['evidence', '주석·위험징후'],
  ['prediction', '위험 사건 예측'],
  ['review', '체크·검토 메모'],
] as const

export function Shell() {
  const { analysisId, structureId, financialId, section } = useParams()
  const session = useSession()
  const financialQuery = useQuery({
    queryKey: [
      'server',
      session.session?.workspace_id,
      'financial-run',
      financialId?.toLowerCase(),
    ],
    queryFn: ({ signal }) =>
      getFinancialRun(financialId!.toLowerCase(), signal),
    enabled: !!financialId && session.phase === 'ready' && !!session.session,
    retry: false,
  }).data
  const financial = session.phase === 'ready' ? financialQuery : undefined
  const financialContext =
    session.phase === 'ready' ? financial?.context : undefined
  const location = useLocation()
  const params = new URLSearchParams(location.search)
  const company = findCompany(analysisId)
  const live = useNoteWorkspace(structureId?.toLowerCase())
  const metadata = live.data
  const corp =
    financialContext?.corp_code ?? metadata?.corp_code ?? params.get('corp')
  const publicCompany = useQuery({
    queryKey: ['dart', 'workspace-company', corp],
    queryFn: ({ signal }) => searchCompanies(corp!, 0, signal),
    enabled: !!corp && !company,
    staleTime: 60_000,
    retry: false,
  }).data?.items.find((item) => item.corp_code === corp)
  const name =
    company?.name ??
    publicCompany?.corp_name ??
    metadata?.company_name ??
    financial?.result?.company_name ??
    (corp ? `DART ${corp}` : '기업을 선택해 주세요')
  const searchPath = company
    ? `/?${new URLSearchParams({ data: 'demo', company: company.id, report: params.get('report') ?? '2025', scope: params.get('scope') ?? 'CFS', lease: params.get('lease') ?? 'include' })}`
    : financialContext
      ? `/?${new URLSearchParams({ q: financialContext.corp_code, corp: financialContext.corp_code, report: financialContext.receipt_no, scope: financialContext.scope })}`
      : metadata
        ? `/?${new URLSearchParams({ q: metadata.corp_code, corp: metadata.corp_code, report: metadata.receipt_no, scope: metadata.scope })}`
        : '/'
  const [helpOpen, setHelpOpen] = useState(false)
  const ready = !!company || !!metadata?.hierarchy || !!financialContext
  const base = financialId
    ? `/financials/${financialId}`
    : company
      ? `/analyses/${analysisId}`
      : `/notes/${structureId}`
  const active = section ?? (structureId ? 'evidence' : 'summary')
  const scope =
    financialContext?.scope ??
    metadata?.scope ??
    params.get('scope') ??
    (company ? 'CFS' : 'OFS')
  return (
    <div className="app-shell design-shell">
      <a className="skip-link" href="#main">
        본문 바로가기
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand" aria-label="LoanSight AI 홈">
          LoanSight <b>AI</b>
        </NavLink>
        <p className="sidebar-description">기업 여신 검토 지원</p>
        <nav aria-label="기업 분석">
          <NavLink
            to={searchPath}
            end
            className={`nav-item ${!analysisId && !structureId && !financialId ? 'active' : ''}`}
          >
            기업 검색
          </NavLink>
          {menus.map(([path, label]) =>
            ready &&
            (!financialId || ['summary', 'cashflow'].includes(path)) ? (
              <NavLink
                key={path}
                to={`${base}/${path}${location.search}`}
                className={`nav-item ${active === path ? 'active' : ''}`}
              >
                {label}
              </NavLink>
            ) : (
              <span
                key={path}
                className="nav-item disabled"
                aria-disabled="true"
              >
                {label}
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-secondary">
          <span>관련 뉴스 · 후순위</span>
          <span>검증 기록 · 내부 문서</span>
        </div>
        <button className="help-link" onClick={() => setHelpOpen(true)}>
          <CircleHelp size={15} />
          이용 안내
        </button>
        <div className="sidebar-footer">LoanSight AI · 4조참치</div>
      </aside>
      <header className="topbar">
        <div className="company-context" aria-label="기업 분석 기준">
          <div className="context-title">
            <strong>{name}</strong>
            <span>
              {company
                ? `${company.code} · ${company.market}`
                : publicCompany?.stock_code
                  ? `${publicCompany.stock_code} · ${{ Y: '유가증권', K: '코스닥', N: '코넥스', E: '기타' }[publicCompany.corp_cls ?? 'E']}`
                  : corp
                    ? `고유번호 ${corp}`
                    : '공시 기반 기업 분석'}
            </span>
            {(company?.industry ?? publicCompany?.industry) && (
              <span className="context-industry">
                {company?.industry ?? publicCompany?.industry}
              </span>
            )}
            {company && <span className="demo-label">예시 데이터</span>}
            {publicCompany?.ksic11_name && (
              <span>{publicCompany.ksic11_name}</span>
            )}
          </div>
          <div className="context-chips">
            {metadata || company || corp ? (
              <>
                <span>
                  {financialContext
                    ? `${financialContext.period} 결산 보고서`
                    : metadata
                      ? `${metadata.period} 결산 보고서`
                      : `${params.get('report')?.slice(0, 4) ?? '보고서 선택 전'}${params.get('report') ? ' 사업보고서' : ''}`}
                </span>
                <span>{scope === 'OFS' ? '별도(OFS)' : '연결(CFS)'}</span>
                {financialContext && (
                  <>
                    <span>접수번호 {financialContext.receipt_no}</span>
                    <span>
                      리스{' '}
                      {financialContext.lease === 'include' ? '포함' : '제외'}
                    </span>
                  </>
                )}
                {metadata && (
                  <>
                    <span>접수번호 {metadata.receipt_no}</span>
                    <span>원문 {metadata.source_sha256.slice(0, 12)}</span>
                    <span>검수 전</span>
                    {metadata.source_saved_at && (
                      <span>
                        원문 저장{' '}
                        {new Date(metadata.source_saved_at).toLocaleDateString(
                          'ko-KR',
                          { timeZone: 'Asia/Seoul' },
                        )}
                      </span>
                    )}
                  </>
                )}
                {publicCompany?.acc_mt && (
                  <span>결산 {publicCompany.acc_mt}월</span>
                )}
                {company && <span>출처·재무 기준일: 예시</span>}
              </>
            ) : (
              <span>
                기업·보고서·회계 범위를 선택하면 같은 기준으로 모든 화면을
                확인합니다.
              </span>
            )}
          </div>
        </div>
        <div className="top-actions">
          {ready && (
            <NavLink className="context-change" to={searchPath}>
              기업 변경
            </NavLink>
          )}
          <TaskControls />
          <SessionControls />
        </div>
      </header>
      <div className="main-area">
        <Outlet />
        <footer className="service-footer">
          공시 기반 확인 지원 서비스입니다. 여신 승인·거절, 자산건전성 분류,
          내부 등급 산정을 대신하지 않습니다.
          <span>© 2026 LoanSight AI · 4조참치</span>
        </footer>
      </div>
      <Modal
        title="LoanSight AI 이용 안내"
        description="공시 기반 기업 여신 검토를 지원하는 도구입니다."
        open={helpOpen}
        onOpenChange={setHelpOpen}
      >
        <ol className="help-steps">
          <li>기업과 보고서·회계 범위를 선택하고 원문을 수집합니다.</li>
          <li>
            주석 추출 근거에서 기본 검색·보완 탐색·인용 원문을 확인합니다.
          </li>
          <li>체크·검토 메모에서 근거를 대조하고 담당자 의견을 정리합니다.</li>
        </ol>
        <p className="notice">
          핵심 재무 분석에서 실제 공시 계정과 산식을 확인할 수 있습니다. 예시
          화면은 별도 표시합니다. 위험규칙·외부 모델·검토 기록의 서버 저장은
          후속입니다.
        </p>
      </Modal>
    </div>
  )
}
