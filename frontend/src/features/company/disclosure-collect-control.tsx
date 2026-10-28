import { useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'
import { getCompanyReports } from './api'
import { Button } from '../../shared/components/button'
import { ApiError, errorMessage, request } from '../session/api'
import { SessionContext } from '../session/session-context'
import { TaskContext } from '../tasks/task-context'
import { detailSchema, stageLabels, isTerminal } from '../tasks/task-state'

const collectionSchema = z.object({
  kind: z.literal('DART_COLLECT'),
  note_task_id: z.string().uuid(),
  archive_bytes: z.number(),
  note_bytes: z.number(),
  structure_id: z.string().uuid(),
})
const noteResultSchema = z.object({
  segment_count: z.number().int().nonnegative(),
})
const failureLabels: Record<string, string> = {
  dart_note_scope_missing:
    '선택한 회계 범위의 주석 목차가 확인되지 않았습니다.',
  dart_note_locator_ambiguous:
    '주석 목차가 여러 개여서 자동 선택하지 않았습니다.',
  dart_note_html_invalid: '주석 HTML의 제목과 표를 확인하지 못했습니다.',
  dart_api_key_missing: '원문 수집에 필요한 DART API 키가 설정되지 않았습니다.',
  dart_download_failed: 'DART 원문을 내려받지 못했습니다.',
  dart_archive_invalid: '유효한 원문 ZIP/XML을 확보하지 못했습니다.',
  handler_failed:
    '자료 처리에 실패했습니다. 내 분석 작업에서 상태를 확인해 주세요.',
}

export function DisclosureCollectControl({
  corpCode,
}: {
  corpCode: string | null
}) {
  const session = useContext(SessionContext)
  const [params] = useSearchParams()
  const scope = params.get('scope') ?? 'OFS'
  const { data } = useQuery({
    queryKey: ['dart', 'annual-reports', corpCode],
    queryFn: ({ signal }) => getCompanyReports(corpCode!, signal),
    enabled: false,
  })
  const reports = data?.items.filter((item) => !item.withdrawn) ?? []
  const requested = params.get('report')
  const report = requested
    ? (reports.find((item) => item.receipt_no === requested) ??
      reports.find((item) => item.fiscal_year === requested))
    : reports[0]
  return (
    <CollectButton
      key={`${session?.session?.workspace_id}:${corpCode}:${report?.receipt_no}:${scope}`}
      corpCode={corpCode}
      receiptNo={report?.receipt_no ?? null}
      scope={scope}
    />
  )
}

function CollectButton({
  corpCode,
  receiptNo,
  scope,
}: {
  corpCode: string | null
  receiptNo: string | null
  scope: string
}) {
  const session = useContext(SessionContext)
  const taskContext = useContext(TaskContext)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const user = session?.session
  const valid =
    !!user &&
    session?.phase === 'ready' &&
    !!corpCode &&
    !!receiptNo &&
    ['OFS', 'CFS'].includes(scope)
  const parent = useQuery({
    queryKey: ['server', user?.workspace_id, 'collection', taskId],
    queryFn: async ({ signal }) =>
      detailSchema.parse(await request(`/me/tasks/${taskId}`, { signal })),
    enabled: !!taskId && !!user,
    refetchInterval: (query) =>
      query.state.data && isTerminal(query.state.data) ? false : 1000,
    retry: false,
  })
  const collected = collectionSchema.safeParse(parent.data?.result)
  const noteTaskId = collected.success ? collected.data.note_task_id : null
  const note = useQuery({
    queryKey: ['server', user?.workspace_id, 'collected-note', noteTaskId],
    queryFn: async ({ signal }) =>
      detailSchema.parse(await request(`/me/tasks/${noteTaskId}`, { signal })),
    enabled: !!noteTaskId && !!user,
    refetchInterval: (query) =>
      query.state.data && isTerminal(query.state.data) ? false : 1000,
    retry: false,
  })
  const current = note.data ?? parent.data
  const completed = note.data?.status === 'SUCCEEDED'
  const noteResult = noteResultSchema.safeParse(note.data?.result)
  const running =
    !!taskId &&
    !(current && isTerminal(current) && (!collected.success || !!note.data))

  async function collect() {
    if (!valid || pending) return
    setPending(true)
    setError('')
    try {
      const submitted = detailSchema.omit({ result: true }).parse(
        await request('/me/disclosure-collections', {
          method: 'POST',
          body: JSON.stringify({
            corp_code: corpCode,
            receipt_no: receiptNo,
            scope,
          }),
        }),
      )
      setTaskId(submitted.task_id)
      taskContext?.refresh()
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401)
        session?.expire()
      setError(errorMessage(failure))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <p className="selection-note" id="live-analysis-availability">
        원본 ZIP/XML과 선택한 회계 범위의 주석 HTML을 저장하고 주석을
        구조화합니다. 실제 재무 분석과 주석 내용 검수는 별도로 진행됩니다.
        {!user && ' 코드로 접속한 뒤 수집할 수 있습니다.'}
      </p>
      <Button
        disabled={!valid || pending || running}
        onClick={() => {
          void collect()
        }}
        aria-describedby="live-analysis-availability"
      >
        {pending
          ? '수집 요청 중…'
          : running
            ? '원문 수집·구조화 진행 중'
            : '원문 수집·주석 구조화'}
      </Button>
      {error && (
        <p className="selection-note" role="alert">
          {error}
        </p>
      )}
      {parent.isError || note.isError ? (
        <p className="selection-note" role="alert">
          작업 상태를 확인하지 못했습니다. 내 분석 작업에서 다시 확인해 주세요.
        </p>
      ) : null}
      {current && (
        <div className="selection-note" role="status">
          {completed ? (
            <p>
              원문 저장·주석 구조화 완료
              {noteResult.success
                ? ` · ${noteResult.data.segment_count.toLocaleString()}개 구간`
                : ''}
            </p>
          ) : current.status === 'FAILED' ? (
            <p>
              {failureLabels[current.error_code ?? ''] ??
                '자료 수집 또는 구조화에 실패했습니다.'}
            </p>
          ) : (
            <p>{stageLabels[current.stage] ?? '작업 처리 중'}</p>
          )}
          {collected.success && (
            <p>
              원문 ZIP {(collected.data.archive_bytes / 1024).toFixed(0)} KB ·
              주석 HTML {(collected.data.note_bytes / 1024).toFixed(0)} KB 보존
            </p>
          )}
        </div>
      )}
      {completed && collected.success && (
        <Button asChild variant="outline">
          <Link to={`/notes/${collected.data.structure_id}`}>
            주석 결과 보기
          </Link>
        </Button>
      )}
    </>
  )
}
