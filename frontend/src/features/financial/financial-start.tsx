import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router'
import { getCompanyReports } from '../company/api'
import { SessionContext } from '../session/session-context'
import { TaskContext } from '../tasks/task-context'
import { startFinancialRun, financialError } from './api'
import { Button } from '../../shared/components/button'

export function FinancialStart({
  corpCode,
  receiptNo,
  scope: suppliedScope,
}: {
  corpCode: string | null
  receiptNo?: string
  scope?: 'OFS' | 'CFS'
}) {
  const [params] = useSearchParams()
  const session = useContext(SessionContext)
  const tasks = useContext(TaskContext)
  const navigate = useNavigate()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const activeWorkspace = useRef<string | null>(null)
  const workspace =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  useEffect(() => {
    activeWorkspace.current = workspace ?? null
    return () => {
      activeWorkspace.current = null
    }
  }, [workspace])
  const { data } = useQuery({
    queryKey: ['dart', 'annual-reports', corpCode],
    queryFn: ({ signal }) => getCompanyReports(corpCode!, signal),
    enabled: false,
  })
  const reports = data?.items.filter((r) => !r.withdrawn) ?? []
  const selection = receiptNo ?? params.get('report')
  const report = selection
    ? reports.find(
        (r) => r.receipt_no === selection || r.fiscal_year === selection,
      )
    : reports[0]
  const receipt = receiptNo ?? report?.receipt_no
  const scope = suppliedScope ?? params.get('scope') ?? 'OFS'
  const ready =
    !!corpCode &&
    !!receipt &&
    ['OFS', 'CFS'].includes(scope) &&
    session?.phase === 'ready' &&
    !!session.session
  return (
    <div className="financial-start">
      <Button
        disabled={!ready || pending}
        onClick={async () => {
          const owner = activeWorkspace.current
          setPending(true)
          setError('')
          try {
            const run = await startFinancialRun({
              corp_code: corpCode!,
              receipt_no: receipt!,
              scope: scope as 'OFS' | 'CFS',
              lease: 'include',
            })
            if (owner !== activeWorkspace.current) return
            tasks?.refresh()
            navigate(
              `/financials/${run.analysis_run_id}/summary?corp=${corpCode}`,
            )
          } catch (failure) {
            setError(financialError(failure))
          } finally {
            setPending(false)
          }
        }}
      >
        {pending ? '재무 분석 요청 중…' : '핵심 재무 분석'}
      </Button>
      {!session?.session && (
        <p className="selection-note">
          사용자 코드로 접속하면 재무 분석을 시작할 수 있습니다.
        </p>
      )}
      <p className="selection-note">
        정형 재무와 주석을 수집해 분석합니다. 주석 보완에 실패해도 확보된 재무
        결과는 제공합니다.
      </p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  )
}
