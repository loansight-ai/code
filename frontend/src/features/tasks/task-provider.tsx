import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  errorMessage,
  request,
  sessionSchema,
  type Session,
} from '../session/api'
import { useSession } from '../session/session-context'
import { TaskContext, type TasksState } from './task-context'
import {
  cursorSequence,
  detailSchema,
  isTerminal,
  mergeTask,
  snapshotSchema,
  taskSchema,
  type Task,
} from './task-state'

const events = [
  'task.created',
  'task.updated',
  'task.completed',
  'task.failed',
  'task.acknowledged',
]

export function TaskProvider({
  session,
  epoch,
  children,
}: {
  session: Session | null
  epoch: number
  children: ReactNode
}) {
  const client = useQueryClient()
  const { expire } = useSession()
  const [connection, setConnection] = useState<TasksState['connection']>('idle')
  const [message, setMessage] = useState('')
  const [revision, setRevision] = useState(0)
  const scope = ['server', session?.user_id, session?.workspace_id, epoch]
  const queryKey = [...scope, 'tasks']
  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey,
    enabled: false,
    queryFn: () => [],
  })
  const lifecycle = useRef<AbortController | null>(null)

  useEffect(() => {
    const abort = new AbortController()
    lifecycle.current = abort
    if (!session) return () => abort.abort()
    const key = [
      'server',
      session.user_id,
      session.workspace_id,
      epoch,
      'tasks',
    ]
    let source: EventSource | null = null
    let syncing = false
    let verifying = false

    async function verifySession() {
      if (verifying || abort.signal.aborted) return
      verifying = true
      try {
        const current = sessionSchema.parse(
          await request('/session', { signal: abort.signal }),
        )
        if (
          !abort.signal.aborted &&
          (current.user_id !== session!.user_id ||
            current.workspace_id !== session!.workspace_id)
        )
          expire()
      } catch (error) {
        if (
          !abort.signal.aborted &&
          error instanceof ApiError &&
          error.status === 401
        )
          expire()
      } finally {
        verifying = false
      }
    }

    async function sync() {
      if (syncing || abort.signal.aborted) return
      syncing = true
      source?.close()
      source = null
      setConnection('loading')
      setMessage('')
      try {
        const snapshot = snapshotSchema.parse(
          await request('/me/tasks', { signal: abort.signal }),
        )
        if (abort.signal.aborted) return
        const stream = snapshot.event_cursor.split(':')[0]
        let sequence = cursorSequence(snapshot.event_cursor, stream)
        if (sequence === null) throw new Error('invalid_snapshot_cursor')
        client.setQueryData(key, snapshot.tasks)
        setConnection('connecting')
        const current = new EventSource(
          `/api/v1/me/task-events?after=${encodeURIComponent(snapshot.event_cursor)}`,
        )
        source = current
        const active = () => !abort.signal.aborted && source === current
        current.onopen = () => {
          if (active()) {
            setConnection('live')
            setMessage('')
          }
        }
        current.onerror = () => {
          if (!active()) return
          setConnection(
            current.readyState === EventSource.CLOSED
              ? 'error'
              : 'reconnecting',
          )
          setMessage(
            '실시간 연결이 끊겼습니다. 표시된 상태가 최신이 아닐 수 있습니다.',
          )
          void verifySession()
        }
        for (const event of events)
          current.addEventListener(event, (raw) => {
            if (!active()) return
            try {
              const update = raw as MessageEvent<string>
              const next = cursorSequence(update.lastEventId, stream)
              if (next === null) throw new Error('invalid_event_cursor')
              if (next <= sequence!) return
              const task = taskSchema.parse(JSON.parse(update.data))
              sequence = next
              client.setQueryData<Task[]>(key, (previous = []) =>
                mergeTask(previous, task),
              )
            } catch {
              void sync()
            }
          })
        current.addEventListener('reset', () => {
          if (active()) void sync()
        })
        current.addEventListener('session.expired', () => {
          if (active()) {
            current.close()
            expire()
          }
        })
      } catch (error) {
        if (abort.signal.aborted) return
        if (error instanceof ApiError && error.status === 401) expire()
        else {
          setConnection('error')
          setMessage(errorMessage(error))
        }
      } finally {
        syncing = false
      }
    }
    void sync()
    const focus = () => {
      void verifySession()
    }
    window.addEventListener('focus', focus)
    return () => {
      abort.abort()
      source?.close()
      window.removeEventListener('focus', focus)
    }
  }, [session, epoch, revision, client, expire])

  async function scopedRequest(path: string, init: RequestInit = {}) {
    const abort = lifecycle.current
    if (!session || !abort || abort.signal.aborted)
      throw new Error('session_required')
    try {
      const result = await request(path, { ...init, signal: abort.signal })
      if (abort.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      return result
    } catch (error) {
      if (
        !abort.signal.aborted &&
        error instanceof ApiError &&
        error.status === 401
      )
        expire()
      throw error
    }
  }
  return (
    <TaskContext.Provider
      value={{
        tasks: session
          ? tasks.filter((task) => !isTerminal(task) || !task.acknowledged)
          : [],
        connection: session ? connection : 'idle',
        message: session ? message : '',
        refresh: () => setRevision((value) => value + 1),
        diagnostic: async (key) => {
          taskSchema.parse(
            await scopedRequest('/me/tasks/diagnostics', {
              method: 'POST',
              body: JSON.stringify({ check_key: key, shared: false }),
            }),
          )
          // REST payloads have no stream cursor. Reconcile instead of inserting
          // a delayed reply after a newer snapshot omitted an acknowledged task.
          setRevision((value) => value + 1)
        },
        acknowledge: async (task) => {
          try {
            taskSchema.parse(
              await scopedRequest(`/me/tasks/${task.task_id}/acknowledgement`, {
                method: 'PUT',
                body: JSON.stringify({ state_version: task.state_version }),
              }),
            )
            setRevision((value) => value + 1)
          } catch (error) {
            if (error instanceof ApiError && error.status === 409)
              setRevision((value) => value + 1)
            throw error
          }
        },
        detail: async (id) =>
          detailSchema.parse(await scopedRequest(`/me/tasks/${id}`)),
      }}
    >
      {children}
    </TaskContext.Provider>
  )
}
