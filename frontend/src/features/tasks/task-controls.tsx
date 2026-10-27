import { useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { errorMessage } from '../session/api'
import { useSession } from '../session/session-context'
import { useTasks } from './task-context'
import {
  isTerminal,
  stageLabels,
  statusLabels,
  type TaskDetail,
} from './task-state'

const connectionLabels = {
  idle: '접속 대기',
  loading: '작업 복원 중',
  connecting: '실시간 연결 중',
  live: '실시간 연결됨',
  reconnecting: '실시간 재연결 중',
  error: '작업 연결 확인 필요',
}

export function TaskControls() {
  const { session, phase } = useSession()
  return (
    <TaskPanel key={`${phase}:${session?.user_id}:${session?.workspace_id}`} />
  )
}

function TaskPanel() {
  const { session } = useSession()
  const {
    tasks,
    connection,
    message,
    refresh,
    diagnostic,
    acknowledge,
    detail,
  } = useTasks()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<TaskDetail | null>(null)
  const diagnosticKey = useRef<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const running = tasks.filter((task) => !isTerminal(task)).length
  const unread = tasks.length - running

  async function run(action: () => Promise<void>) {
    if (pending) return
    setPending(true)
    setError('')
    try {
      await action()
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure))
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Bell size={17} />내 분석 작업
        {session && (
          <span className="task-count">
            진행 {running} · 미확인 {unread}
          </span>
        )}
      </Button>
      <Modal
        title="내 분석 작업"
        description="현재 사용자에게 연결된 진행 중 작업과 미확인 종료 작업입니다."
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) setSelected(null)
        }}
      >
        {!session ? (
          <p>코드 발급 또는 재접속 후 내 작업을 확인할 수 있습니다.</p>
        ) : (
          <>
            <p role="status">{connectionLabels[connection]}</p>
            {message && <p role="alert">{message}</p>}
            <div className="session-buttons">
              <Button
                variant="outline"
                disabled={pending || connection === 'loading'}
                onClick={() => {
                  setSelected(null)
                  refresh()
                }}
              >
                목록 다시 불러오기
              </Button>
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  void run(async () => {
                    diagnosticKey.current ??= crypto.randomUUID()
                    await diagnostic(diagnosticKey.current)
                    diagnosticKey.current = null
                  })
                }
              >
                연결 점검 실행
              </Button>
            </div>
            <p className="notice">
              연결 점검은 작업 전달과 알림을 확인합니다. 실제 재무 분석은
              수행하지 않습니다.
            </p>
            {error && <p role="alert">{error}</p>}
            {!tasks.length && connection !== 'loading' && (
              <p>
                {connection === 'error'
                  ? '작업 목록을 확인할 수 없습니다.'
                  : '진행 중이거나 미확인인 작업이 없습니다.'}
              </p>
            )}
            <ul className="task-list" aria-label="내 작업 목록">
              {tasks.map((task) => (
                <li key={task.task_id}>
                  <div className="task-heading">
                    <strong>
                      {task.task_type === 'PIPELINE_CHECK'
                        ? '연결 점검'
                        : task.task_type === 'NOTE_STRUCTURE'
                          ? '주석 구조화'
                          : task.task_type}
                    </strong>
                    <span>{statusLabels[task.status] ?? task.status}</span>
                  </div>
                  <p>
                    단계: {stageLabels[task.stage] ?? task.stage} · 시도{' '}
                    {task.attempt}회
                  </p>
                  <p className="task-time">
                    갱신: {new Date(task.occurred_at).toLocaleString('ko-KR')}
                  </p>
                  {task.error_code && <p>오류: {task.error_code}</p>}
                  <div className="session-buttons">
                    <Button
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        void run(async () => {
                          const result = await detail(task.task_id)
                          if (mounted.current) setSelected(result)
                        })
                      }
                    >
                      작업 상세 보기
                    </Button>
                    {isTerminal(task) && (
                      <Button
                        variant="outline"
                        disabled={pending}
                        onClick={() =>
                          void run(async () => {
                            await acknowledge(task)
                            if (mounted.current) setSelected(null)
                          })
                        }
                      >
                        종료 알림 확인
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {selected && (
              <section className="task-detail" aria-label="작업 상세">
                <h3>작업 상세</h3>
                <p>
                  조회 시 상태:{' '}
                  {statusLabels[selected.status] ?? selected.status} · 버전{' '}
                  {selected.state_version}
                </p>
                <p>작업 ID: {selected.task_id}</p>
                {selected.task_type === 'PIPELINE_CHECK' && (
                  <p>연결 점검 결과이며 재무 분석 결과가 아닙니다.</p>
                )}
                <pre>
                  {JSON.stringify(selected.result, null, 2) ?? '결과 대기 중'}
                </pre>
              </section>
            )}
          </>
        )}
      </Modal>
    </>
  )
}
