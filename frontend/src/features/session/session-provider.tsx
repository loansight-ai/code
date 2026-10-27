import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  errorMessage,
  request,
  sessionSchema,
  type Session,
} from './api'
import { SessionContext, type SessionState } from './session-context'
import { TaskProvider } from '../tasks/task-provider'

// Only an invalidation signal crosses tabs. Codes and tokens are never persisted here.
const channelName = 'loansight-session'

export function SessionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [phase, setPhase] = useState<SessionState['phase']>('loading')
  const [message, setMessage] = useState('')
  const [epoch, setEpoch] = useState(0)
  const generation = useRef(0)
  const busy = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)

  const clear = useCallback(() => {
    controller.current?.abort()
    generation.current += 1
    setSession(null)
    setEpoch((value) => value + 1)
    void client.cancelQueries({ queryKey: ['server'] })
    client.removeQueries({ queryKey: ['server'] })
  }, [client])

  const expire = useCallback(() => {
    clear()
    setPhase('ready')
    setMessage(
      '세션이 만료되었거나 다른 탭에서 사용자가 변경되었습니다. 코드로 다시 접속해 주세요.',
    )
  }, [clear])

  const restore = useCallback(async () => {
    if (busy.current) return
    clear()
    const ownGeneration = generation.current
    const abort = new AbortController()
    controller.current = abort
    setPhase('loading')
    setMessage('')
    try {
      const current = sessionSchema.parse(
        await request('/session', { signal: abort.signal }),
      )
      if (generation.current === ownGeneration) {
        setSession(current)
        setPhase('ready')
      }
    } catch (error) {
      if (generation.current !== ownGeneration || abort.signal.aborted) return
      setPhase(
        error instanceof ApiError && error.status === 401
          ? 'ready'
          : 'unavailable',
      )
      if (!(error instanceof ApiError && error.status === 401))
        setMessage(errorMessage(error))
    }
  }, [clear])

  const change: SessionState['change'] = async (action, code) => {
    if (busy.current) return
    busy.current = true
    clear()
    const ownGeneration = generation.current
    setPhase('changing')
    setMessage('')
    try {
      const result = await request(
        action === 'create' ? '/users' : '/session',
        {
          method: action === 'logout' ? 'DELETE' : 'POST',
          body:
            action === 'login'
              ? JSON.stringify({ user_code: code })
              : undefined,
        },
      )
      if (generation.current !== ownGeneration) return
      setSession(action === 'logout' ? null : sessionSchema.parse(result))
      setPhase('ready')
    } catch (error) {
      // A failed login may leave the old cookie valid; a lost response may have changed it.
      // Reconcile with the server instead of guessing which user is active.
      if (generation.current !== ownGeneration) return
      try {
        const current = sessionSchema.parse(await request('/session'))
        if (generation.current === ownGeneration) setSession(current)
      } catch {
        // Keep all previous user's state cleared if reconciliation is unavailable.
      }
      if (generation.current === ownGeneration) {
        setPhase('ready')
        setMessage(errorMessage(error))
      }
    } finally {
      busy.current = false
      channel.current?.postMessage('changed')
    }
  }

  useEffect(() => {
    let mounted = true
    queueMicrotask(() => {
      if (mounted) void restore()
    })
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(channelName)
      channel.current.onmessage = () => {
        void restore()
      }
    }
    return () => {
      mounted = false
      controller.current?.abort()
      generation.current += 1
      channel.current?.close()
      channel.current = null
    }
  }, [restore])

  return (
    <SessionContext.Provider
      value={{ session, phase, message, change, restore, expire }}
    >
      <TaskProvider session={session} epoch={epoch}>
        {children}
      </TaskProvider>
    </SessionContext.Provider>
  )
}
