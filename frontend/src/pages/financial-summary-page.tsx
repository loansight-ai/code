import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { z } from 'zod'
import { SessionContext } from '../features/session/session-context'
import { TaskContext } from '../features/tasks/task-context'
import { ApiError } from '../features/session/api'
import {
  getFinancialRun,
  startFinancialRun,
  financialError,
  reasonLabels,
  type FinancialResult,
} from '../features/financial/api'
import { StatePanel } from '../shared/components/state-panel'
import { Button } from '../shared/components/button'
import { DataStatus, FinancialValue } from '../features/financial/data-status'
import '../financial-summary.css'
import { VisualFinancialSummary } from '../features/financial/visual-summary'
import { FinancialCashflow } from '../features/financial/financial-cashflow'
import { analysisMenus } from '../app/analysis-menu'
import {
  FinancialFactEvidence,
  FinancialNoteProgress,
} from '../features/financial/note-progress'

export function FinancialSummaryPage() {
  const { financialId = '', section = 'summary' } = useParams()
  return (
    <FinancialPage
      key={financialId}
      id={financialId.toLowerCase()}
      section={section}
    />
  )
}

function FinancialPage({ id, section }: { id: string; section: string }) {
  const session = useContext(SessionContext)
  const tasks = useContext(TaskContext)
  const navigate = useNavigate()
  const workspace = session?.session?.workspace_id
  const activeWorkspace = useRef<string | null>(null)
  const activeOwner = session?.phase === 'ready' ? workspace : undefined
  useEffect(() => {
    activeWorkspace.current = activeOwner ?? null
    return () => {
      activeWorkspace.current = null
    }
  }, [activeOwner])
  const valid =
    z.string().uuid().safeParse(id).success &&
    analysisMenus.some(([key]) => key === section)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const run = useQuery({
    queryKey: ['server', workspace, 'financial-run', id],
    queryFn: ({ signal }) => getFinancialRun(id, signal),
    enabled: valid && !!workspace && session?.phase === 'ready',
    retry: false,
    refetchInterval: (q) =>
      q.state.data &&
      (['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(q.state.data.status) ||
        ['BASE_ANALYSIS', 'WAITING_STRUCTURE', 'ENRICHING'].includes(
          q.state.data.note_workflow?.stage ?? '',
        ))
        ? 1000
        : false,
  })
  useEffect(() => {
    if (run.error instanceof ApiError && run.error.status === 401)
      session?.expire()
  }, [run.error, session])
  if (!valid)
    return (
      <main id="main" className="page">
        <StatePanel state="error" title="재무 분석 주소를 확인해 주세요" />
      </main>
    )
  if (session?.phase === 'loading' || session?.phase === 'changing')
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="접속 상태를 확인하고 있습니다" />
      </main>
    )
  if (!workspace)
    return (
      <main id="main" className="page">
        <StatePanel state="pending" title="사용자 코드로 접속해 주세요" />
      </main>
    )
  if (run.isPending)
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="재무 분석을 불러오는 중입니다" />
      </main>
    )
  if (run.isError || !run.data)
    return (
      <main id="main" className="page">
        <StatePanel
          state="error"
          title="재무 분석을 확인하지 못했습니다"
          description={financialError(run.error)}
          action={{
            label: '다시 조회',
            onClick: () => {
              void run.refetch()
            },
          }}
        />
      </main>
    )
  const { context, result, status, error_code } = run.data
  const search = new URLSearchParams({
    q: context.corp_code,
    corp: context.corp_code,
    report: context.receipt_no,
    scope: context.scope,
  })
  const running = ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(status)
  const supplementing = [
    'BASE_ANALYSIS',
    'WAITING_STRUCTURE',
    'ENRICHING',
  ].includes(run.data.note_workflow?.stage ?? '')
  async function start(lease: 'include' | 'exclude', refresh = false) {
    if (!run.data) return
    const owner = activeWorkspace.current
    setPending(true)
    setError('')
    try {
      const next = await startFinancialRun({
        corp_code: context.corp_code,
        receipt_no: context.receipt_no,
        scope: context.scope,
        lease,
        ...(context.enrich_notes ? { enrich_notes: true } : {}),
        ...(refresh
          ? { refresh_key: crypto.randomUUID() }
          : context.refresh_key
            ? { refresh_key: context.refresh_key }
            : {}),
      })
      if (owner !== activeWorkspace.current) return
      tasks?.refresh()
      await navigate(
        `/financials/${next.analysis_run_id}/${section}?corp=${context.corp_code}`,
      )
    } catch (failure) {
      setError(financialError(failure))
      setPending(false)
    }
  }
  return (
    <main
      id="main"
      className={`page ${section === 'summary' ? 'visual-summary-page' : ''}`}
    >
      <div className="page-title-row">
        <div className="financial-page-title">
          <h1>{analysisMenus.find(([key]) => key === section)?.[1]}</h1>
        </div>
        <Button
          variant="outline"
          disabled={running || supplementing || pending}
          onClick={() => {
            void start(context.lease, true)
          }}
        >
          다시 수집·분석
        </Button>
      </div>

      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {pending ? (
        <StatePanel
          state="loading"
          title="변경한 조건의 분석을 요청하고 있습니다"
        />
      ) : running ? (
        <StatePanel
          state="loading"
          title={
            status === 'RETRY_WAIT'
              ? '재무 수집을 다시 시도할 예정입니다'
              : '재무 데이터를 수집·계산하고 있습니다'
          }
          description="작업은 화면을 닫아도 계속됩니다. 내 분석 작업에서 다시 열 수 있습니다."
        />
      ) : status === 'FAILED' ? (
        <StatePanel
          state="error"
          title="재무 분석에 실패했습니다"
          description={
            reasonLabels[error_code ?? ''] ??
            '내 분석 작업에서 상태를 확인한 뒤 다시 수집해 주세요.'
          }
        />
      ) : result ? (
        <>
          {result.availability === 'NO_DATA' && (
            <StatePanel
              state="empty"
              title="선택한 회계 범위의 정형 재무 데이터가 없습니다"
              description="다른 회계 범위의 값으로 대체하지 않았습니다. 보고서와 회계 범위를 확인해 주세요."
            />
          )}
          <FinancialNoteProgress
            workflow={run.data.note_workflow}
            result={result}
          />
          {section === 'summary' ? (
            <VisualFinancialSummary
              result={result}
              onLease={(lease) => {
                void start(lease)
              }}
            />
          ) : section === 'cashflow' ? (
            <FinancialCashflow result={result} />
          ) : (
            <StatePanel
              state="empty"
              title={
                section === 'prediction'
                  ? '예측 결과가 없습니다'
                  : run.data.note_workflow?.structure_id
                    ? '구조화된 주석에서 확인할 수 있습니다'
                    : '구조화된 주석 결과가 필요합니다'
              }
              description={
                section === 'prediction'
                  ? '외부 모델의 예측 결과가 확보되면 이 화면에서 확인할 수 있습니다.'
                  : '기업 검색에서 주석 구조화·Codex 데이터 보완 옵션을 선택해 분석할 수 있습니다.'
              }
            >
              {run.data.note_workflow?.structure_id && (
                <Link
                  to={`/notes/${run.data.note_workflow.structure_id}/${section}`}
                >
                  구조화된 주석 화면으로 이동 →
                </Link>
              )}
              <Link to={`/?${search}`}>기업·분석 옵션 선택 →</Link>
            </StatePanel>
          )}
          {['summary', 'cashflow'].includes(section) ? (
            <details className="vs-source-details">
              <summary>원천 재무 계정·추출 근거 펼치기</summary>
              <SourceFacts result={result} />
            </details>
          ) : (
            <SourceFacts result={result} />
          )}
        </>
      ) : (
        <StatePanel state="empty" title="저장된 재무 결과가 없습니다" />
      )}
    </main>
  )
}

function getFact(result: FinancialResult, key: string, period = 'current') {
  return result.facts.find((f) => f.key === key && f.period === period)
}
function SourceFacts({ result }: { result: FinancialResult }) {
  const periods = [...result.periods].reverse()
  const current = result.facts.filter((f) => f.period === 'current')
  return (
    <section className="panel analysis-section">
      <div className="panel-heading">
        <h2>공통 원천 재무 계정</h2>
        <span>억원 · 다른 분석 화면과 공유</span>
      </div>
      <div className="table-scroll">
        <table aria-label="공통 원천 재무 계정">
          <thead>
            <tr>
              <th>계정</th>
              {periods.map((p) => (
                <th key={p.key}>{p.label}</th>
              ))}
              <th>당기 상태·추출 근거</th>
            </tr>
          </thead>
          <tbody>
            {current.map((fact) => (
              <tr key={fact.key}>
                <td>{fact.label}</td>
                {periods.map((p) => (
                  <td key={p.key}>
                    <FinancialValue value={getFact(result, fact.key, p.key)} />
                  </td>
                ))}
                <td>
                  <details>
                    <summary>
                      <DataStatus value={fact} />
                    </summary>
                    <FinancialFactEvidence sources={fact.sources} />
                    <p>매핑: {fact.mapping_method ?? '미확정'}</p>
                    {fact.sources.map((s, i) => (
                      <p key={i}>
                        {String(s.account_name ?? '')} ·{' '}
                        {String(s.statement ?? '주석')} ·{' '}
                        {String(s.account_id ?? s.source_xpath ?? '')} · 원본값{' '}
                        {String(s.raw_amount ?? '미기재')}
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
