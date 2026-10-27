import { useState } from 'react'
import { NavLink, Outlet, useLocation, useParams } from 'react-router'
import {
  ArrowUpRight,
  Bell,
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
import { Button } from '../shared/components/button'
import { Modal } from '../shared/components/modal'
import { StatePanel } from '../shared/components/state-panel'

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
  const { analysisId } = useParams()
  const location = useLocation()
  const company = findCompany(analysisId)
  const searchPath = company
    ? `/?${new URLSearchParams({ company: company.id, report: new URLSearchParams(location.search).get('report') ?? '2025', scope: new URLSearchParams(location.search).get('scope') ?? 'CFS' })}`
    : '/'
  const [tasksOpen, setTasksOpen] = useState(false)
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
          <span className="demo-label">프론트엔드 미리보기</span>
          <Button variant="ghost" onClick={() => setTasksOpen(true)}>
            <Bell size={17} />내 분석 작업
          </Button>
          <span className="avatar">DE</span>
          <span className="guest">데모 사용자</span>
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
          <strong>{company?.name ?? '기업을 선택해 주세요'}</strong>
          <p>
            {company
              ? `${company.industry} · 가상 기업`
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
          {company ? company.name : '기업 검색'}
        </div>
        <Outlet />
      </div>
      <Modal
        title="내 분석 작업"
        description="서버 연결 후 사용자 세션에 연결된 작업을 표시합니다."
        open={tasksOpen}
        onOpenChange={setTasksOpen}
      >
        <StatePanel
          state="empty"
          title="연결된 분석 작업이 없습니다"
          description="미리보기에서는 수집이나 분석 작업을 실행하지 않습니다."
        />
      </Modal>
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
          현재는 가상 기업과 예시 데이터로 구성된 프론트엔드입니다. 코드
          발급·서버 세션·공시 수집·모델 추론은 연결되지 않았습니다.
        </p>
      </Modal>
    </div>
  )
}
