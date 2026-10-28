import { useState } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import {
  ArrowUpRight,
  Building2,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  FileSearch,
  LayoutDashboard,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { findCompany } from '../features/company/demo-data'
import { Modal } from '../shared/components/modal'
import { SessionControls } from '../features/session/session-controls'
import { TaskControls } from '../features/tasks/task-controls'

const menus = [
  {
    label: '핵심 재무 요약',
    path: 'summary',
    icon: LayoutDashboard,
    number: '01',
  },
  {
    label: '실적 변동·현금흐름',
    path: 'cashflow',
    icon: ChartNoAxesCombined,
    number: '02',
  },
  { label: '주석·위험징후', path: 'evidence', icon: FileSearch, number: '03' },
  {
    label: '12개월 위험 예측',
    path: 'prediction',
    icon: ShieldAlert,
    number: '04',
  },
  { label: '담당자 검토', path: 'review', icon: FileCheck2, number: '05' },
]

export function Shell() {
  const { analysisId, structureId } = useParams()
  const location = useLocation()
  const company = findCompany(analysisId)
  const searchPath = company
    ? `/?${new URLSearchParams({ company: company.id, report: new URLSearchParams(location.search).get('report') ?? '2025', scope: new URLSearchParams(location.search).get('scope') ?? 'CFS', lease: new URLSearchParams(location.search).get('lease') ?? 'include' })}`
    : '/'
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        본문 바로가기
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="LoanSight AI 홈">
          <span className="brand-mark">
            L<span />
          </span>
          <span>
            LoanSight <b>AI</b>
          </span>
        </NavLink>
        <span className="brand-description">기업 여신 검토 워크스페이스</span>
        <div className="top-actions">
          <span className="demo-label">
            {structureId ? '수집한 주석 · 검수 전' : '기업 분석은 예시 데이터'}
          </span>
          <TaskControls />
          <SessionControls />
        </div>
      </header>
      <aside className="sidebar">
        <div className="workspace-label">WORKSPACE</div>
        <NavLink
          to={searchPath}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          end
        >
          <Search size={18} />
          기업 검색<span className="nav-shortcut">⌕</span>
        </NavLink>
        {structureId && (
          <NavLink
            to={`/notes/${structureId}${location.search}`}
            className="nav-item active"
          >
            <FileSearch size={18} />
            주석 구조화 결과
          </NavLink>
        )}
        <div className="nav-heading">기업 분석</div>
        <nav aria-label="기업 분석">
          {menus.map(({ label, path, icon: Icon, number }) =>
            company ? (
              <NavLink
                key={path}
                to={`/analyses/${analysisId}/${path}${location.search}`}
                className={({ isActive }) =>
                  `nav-item ${isActive ? 'active' : ''}`
                }
              >
                <Icon size={18} />
                {label}
                <span className="nav-number">{number}</span>
              </NavLink>
            ) : (
              <span
                key={path}
                className="nav-item disabled"
                aria-disabled="true"
              >
                <Icon size={18} />
                {label}
                <span className="nav-number">{number}</span>
              </span>
            ),
          )}
        </nav>
        <div className="sidebar-context">
          <Building2 size={18} />
          <strong>
            {company?.name ??
              (structureId ? '저장된 주석 결과' : '기업을 선택해 주세요')}
          </strong>
          <p>
            {company
              ? `${company.industry} · 가상 기업`
              : structureId
                ? '선택한 구간의 원문 위치와 목차를 확인할 수 있습니다.'
                : '분석할 기업과 보고서를 선택하면 검토를 시작할 수 있습니다.'}
          </p>
        </div>
        <button className="help-link" onClick={() => setHelpOpen(true)}>
          <CircleHelp size={17} />
          이용 안내
          <ArrowUpRight size={15} />
        </button>
        <div className="sidebar-footer">
          공시에서 근거로,
          <br />
          <strong>근거에서 더 나은 판단으로.</strong>
          <span>LoanSight AI · KB Bridge</span>
        </div>
      </aside>
      <div className="main-area">
        <div className="breadcrumb">
          워크스페이스
          <ChevronRight size={13} />
          {company
            ? company.name
            : structureId
              ? '주석 구조화 결과'
              : '기업 검색'}
        </div>
        <Outlet />
      </div>
      <Modal
        title="LoanSight AI 이용 안내"
        description="공시 기반 기업 여신 검토를 지원하는 도구입니다."
        open={helpOpen}
        onOpenChange={setHelpOpen}
      >
        <ol className="help-steps">
          <li>기업을 검색하고 보고서와 회계 범위를 선택합니다.</li>
          <li>핵심 재무와 주석의 원문 근거를 확인합니다.</li>
          <li>
            담당자 의견을 정리합니다. 최종 여신 판단은 담당자가 수행합니다.
          </li>
        </ol>
        <p className="notice">
          기업 검색·원문 수집·주석 구조화와 결과 조회는 서버에 연결됩니다.
          재무·위험 분석은 예시 화면이며 모델 추론과 주석 내용 검수는
          후속입니다.
        </p>
      </Modal>
    </div>
  )
}
