import { useContext } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { SessionContext } from '../features/session/session-context'
import { ApiError } from '../features/session/api'
import { getBundle, openBundle } from '../features/evidence/bundle-api'
import { BundlePanel } from '../features/evidence/bundle-panel'
import { PredictionWorkspace } from '../features/analysis/workspace-panels'
import { useCollectedData } from '../features/company/collected-api'
import { StatePanel } from '../shared/components/state-panel'

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
  return (
    <main className="page">
      <h1>
        {section === 'prediction' ? '위험 사건 예측과 근거' : '주석·위험징후'}
      </h1>
      <p>
        {data.company_name ?? data.corp_code} · {data.period} · {data.scope} ·
        접수번호 {data.receipt_no}
      </p>
      <nav aria-label="보고서 근거 메뉴">
        <Link to={`/evidence/${bundleId}/evidence`}>주석·위험징후</Link>
        {' · '}
        <Link to={`/evidence/${bundleId}/prediction`}>위험 사건 예측</Link>
      </nav>
      {section === 'prediction' && (
        <>
          <PredictionWorkspace observations={observations.data} />
          {observations.isError && (
            <p role="alert">사건 이력을 불러오지 못했습니다.</p>
          )}
          <p>
            주석 사실의 검수·규칙 입력 상태는 아래에서 확인합니다. 공개
            시각·제공 모델 확인 전에는 예측을 보류합니다.
          </p>
        </>
      )}
      <BundlePanel key={`${owner}:${data.bundle_revision}`} bundle={data} />
    </main>
  )
}
