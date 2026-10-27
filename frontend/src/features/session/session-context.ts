import { createContext, useContext } from 'react'
import type { Session } from './api'

export type SessionState = {
  session: Session | null
  phase: 'loading' | 'ready' | 'changing' | 'unavailable'
  message: string
  change: (
    action: 'create' | 'login' | 'logout',
    code?: string,
  ) => Promise<void>
  restore: () => Promise<void>
  expire: () => void
}

export const SessionContext = createContext<SessionState | null>(null)
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('SessionProvider is required')
  return value
}
