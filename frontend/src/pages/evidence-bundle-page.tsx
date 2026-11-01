import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { SessionContext } from '../features/session/session-context'
import { ApiError } from '../features/session/api'
import { getBundle, openBundle } from '../features/evidence/bundle-api'
import { BundlePanel } from '../features/evidence/bundle-panel'
import { ExtractionWorkspace } from '../features/evidence/extraction-workspace'
import { LiveSignals } from '../features/risk/live-signals'
import { PredictionWorkspace } from '../features/analysis/workspace-panels'
import { useCollectedData } from '../features/company/collected-api'
import { StatePanel } from '../shared/components/state-panel'
import { StatusBadge } from '../shared/components/status-badge'
import { ArrowLeft, FileText, ShieldCheck } from 'lucide-react'
import '../features/evidence/evidence-workspace.css'

export function EvidenceReportEntry() {
  const {
    corpCode = '',
    receiptNo = '',
    reportScope = 'OFS',
    section = 'evidence',
  } = useParams()
  const [params] = useSearchParams()
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const structure = params.get('structure_id') ?? undefined
  const valid =
    /^\d{8}$/.test(corpCode) &&
    /^\d{14}$/.test(receiptNo) &&
    ['OFS', 'CFS'].includes(reportScope) &&
    ['evidence', 'prediction'].includes(section) &&
    (!structure || z.string().uuid().safeParse(structure).success)
  const query = useQuery({
    queryKey: [
      'server',
      owner,
      'open-evidence',
      corpCode,
      receiptNo,
      reportScope,
      structure,
    ],
    queryFn: ({ signal }) =>
      openBundle(corpCode, receiptNo, reportScope, structure, signal),
    enabled: valid && !!owner,
    retry: false,
  })
  if (query.data && owner)
    return (
      <Navigate replace to={`/evidence/${query.data.bundle_id}/${section}`} />
    )
  return (
    <main className="page">
      <StatePanel
        state={
          !valid || query.isError ? 'error' : !owner ? 'pending' : 'loading'
        }
        title={
          !valid
            ? '보고서 주소를 확인해 주세요'
            : !owner
              ? '사용자 코드로 접속해 주세요'
              : query.isError
                ? '저장된 보고서 근거를 찾지 못했습니다'
                : '보고서 근거를 연결하고 있습니다'
        }
        description={
          query.error instanceof ApiError && query.error.status === 404
            ? '선택 보고서의 덤프 자료나 현재 사용자 소유의 구조화 결과가 필요합니다.'
            : undefined
        }
      />
      <Link to={`/?corp=${corpCode}&report=${receiptNo}&scope=${reportScope}`}>
        기업·보고서 선택 →
      </Link>
    </main>
  )
}

export function EvidenceBundlePage() {
  const { bundleId = '', section = 'evidence' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') ?? 'notes'
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const valid =
    z.string().uuid().safeParse(bundleId).success &&
    ['evidence', 'prediction'].includes(section)
  const query = useQuery({
    queryKey: ['server', owner, 'evidence-bundle', bundleId],
    queryFn: ({ signal }) => getBundle(bundleId, signal),
    enabled: valid && !!owner,
    retry: false,
  })
  const data = owner ? query.data : undefined
  const observations = useCollectedData({
    corpCode: data?.corp_code ?? null,
    receiptNo: data?.receipt_no,
    scope: data?.scope ?? 'OFS',
    importId: data?.collection_import_id ?? undefined,
    enabled: !!data?.collection_import_id && section === 'prediction',
  })
  if (!valid || !owner || query.isPending || query.isError || !data)
    return (
      <main className="page">
        <StatePanel
          state={
            !valid || query.isError ? 'error' : !owner ? 'pending' : 'loading'
          }
          title={
            !valid
              ? '근거 주소를 확인해 주세요'
              : !owner
                ? '사용자 코드로 접속해 주세요'
                : query.isError
                  ? '근거가 없거나 조회 권한이 없습니다'
                  : '보고서 근거를 불러오는 중입니다'
          }
        />
      </main>
    )
  if (section === 'evidence')
    return (
      <main id="main" className="page evidence-workspace extraction-page">
        <div className="extraction-page-heading">
          <div>
            <h1>주석 확인과 위험징후</h1>
            <p className="extraction-page-description">
              {data.company_name ?? data.corp_code} · {data.period} ·{' '}
              {data.scope} · 공통 추출 항목의 검출 상태와 원문 근거를
              확인합니다.
            </p>
          </div>
          <nav className="extraction-tabs" aria-label="주석 확인 메뉴">
            {[
              ['signals', '위험징후 패널'],
              ['notes', '주석 추출 근거'],
              ['summary', 'AI 요약'],
            ].map(([value, label]) => (
              <button
                key={value}
                aria-current={
                  tab === value ||
                  (value === 'notes' && !['signals', 'summary'].includes(tab))
                    ? 'page'
                    : undefined
                }
                onClick={() => setParams({ tab: value }, { replace: true })}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
        {tab === 'signals' ? (
          <div className="extraction-signals">
            <LiveSignals
              key={`${owner}:${data.bundle_revision}`}
              bundle={data}
            />
          </div>
        ) : tab === 'summary' ? (
          <section className="panel extraction-summary">
            <StatePanel
              state="pending"
              title="AI 요약 대기"
              description="검수된 근거와 요약 기능이 연결되면 확인할 수 있습니다."
            />
          </section>
        ) : (
          <ExtractionWorkspace
            key={`${owner}:${data.bundle_revision}`}
            bundle={data}
          />
        )}
        <details className="extraction-tools">
          <summary>상세 검색·사실 검수</summary>
          <BundlePanel key={`${owner}:${data.bundle_revision}`} bundle={data} />
        </details>
      </main>
    )
  return (
    <main id="main" className="page evidence-workspace">
      <Link
        className="evidence-back-link"
        to={`/?corp=${data.corp_code}&report=${data.receipt_no}&scope=${data.scope}`}
      >
        <ArrowLeft size={15} aria-hidden="true" /> 기업·보고서 선택
      </Link>
      <div className="page-title-row">
        <div>
          <h1>
            {section === 'prediction'
              ? '위험 사건 예측과 근거'
              : '주석·위험징후'}
          </h1>
          <p className="page-description">
            {data.company_name ?? data.corp_code} · {data.period} 결산 ·{' '}
            {data.scope === 'OFS' ? '별도' : '연결'} 기준
          </p>
        </div>
        <StatusBadge tone="caution">사실별 검수 필요</StatusBadge>
      </div>
      <nav className="evidence-page-tabs" aria-label="보고서 근거 메뉴">
        <Link
          aria-current={section === 'evidence' ? 'page' : undefined}
          to={`/evidence/${bundleId}/evidence`}
        >
          <FileText size={16} aria-hidden="true" />
          주석·위험징후
        </Link>
        <Link
          aria-current={section === 'prediction' ? 'page' : undefined}
          to={`/evidence/${bundleId}/prediction`}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          위험 사건 예측
        </Link>
      </nav>
      <div className="evidence-overview" aria-label="보고서 자료 현황">
        <div>
          <span>분석 보고서</span>
          <strong>
            {data.period} 결산 <small>{data.scope}</small>
          </strong>
          <p>접수번호 {data.receipt_no}</p>
        </div>
        <div>
          <span>확보된 근거</span>
          <strong>
            {data.coverage.reduce((n, c) => n + c.nonempty, 0).toLocaleString()}{' '}
            <small>개 구간</small>
          </strong>
          <p>
            {data.sources.some((s) => s.origin === 'html') ? '구조화 HTML' : ''}
            {data.sources.some((s) => s.origin === 'html') &&
            data.sources.some((s) => s.origin === 'dump')
              ? ' · '
              : ''}
            {data.sources.some((s) => s.origin === 'dump')
              ? '저장된 공시 자료'
              : ''}
          </p>
        </div>
        <div>
          <span>검토 진행</span>
          <strong>근거 확인 단계</strong>
          <p>사실 검수 후 규칙 입력 여부를 확인합니다.</p>
        </div>
      </div>
      {section === 'prediction' && (
        <>
          <PredictionWorkspace observations={observations.data} />
          {observations.isError && (
            <p role="alert">사건 이력을 불러오지 못했습니다.</p>
          )}
          <p className="notice">
            주석 사실의 검수·규칙 입력 상태는 아래에서 확인합니다. 공개
            시각·제공 모델 확인 전에는 예측을 보류합니다.
          </p>
        </>
      )}
      <BundlePanel key={`${owner}:${data.bundle_revision}`} bundle={data} />
    </main>
  )
}
