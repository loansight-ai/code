import { useSyncExternalStore } from 'react'

const prefix = 'loansight.active-financial.v1.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const memory = new Map<string, string>()
const listeners = new Set<() => void>()

function read(workspace: string | undefined) {
  if (!workspace) return null
  try {
    const value = sessionStorage.getItem(`${prefix}${workspace}`)
    return value && uuid.test(value)
      ? value.toLowerCase()
      : (memory.get(workspace) ?? null)
  } catch {
    return memory.get(workspace) ?? null
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}
export function rememberFinancialRun(workspace: string, id: string | null) {
  if (id != null && !uuid.test(id)) return
  if (read(workspace) === id) return
  if (id) memory.set(workspace, id.toLowerCase())
  else memory.delete(workspace)
  try {
    if (id) sessionStorage.setItem(`${prefix}${workspace}`, id.toLowerCase())
    else sessionStorage.removeItem(`${prefix}${workspace}`)
  } catch {
    // Browsers that block storage still retain the selection during this visit.
  }
  listeners.forEach((listener) => listener())
}
export function useActiveFinancialRun(workspace: string | undefined) {
  return useSyncExternalStore(
    subscribe,
    () => read(workspace),
    () => null,
  )
}
