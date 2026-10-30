import { act, renderHook } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import {
  rememberFinancialRun,
  useActiveFinancialRun,
} from '../features/financial/active-financial-run'

const run = '11111111-1111-4111-8111-111111111111'
it('retains the active run, isolates workspaces, and hides it without an active session', () => {
  const { result, rerender } = renderHook(
    ({ workspace }: { workspace: string | undefined }) =>
      useActiveFinancialRun(workspace),
    { initialProps: { workspace: 'active-run-a' as string | undefined } },
  )
  expect(result.current).toBeNull()
  act(() => rememberFinancialRun('active-run-a', run))
  expect(result.current).toBe(run)
  rerender({ workspace: 'active-run-b' })
  expect(result.current).toBeNull()
  rerender({ workspace: undefined })
  expect(result.current).toBeNull()
  rerender({ workspace: 'active-run-a' })
  expect(result.current).toBe(run)
  act(() => rememberFinancialRun('active-run-a', null))
  expect(result.current).toBeNull()
})

it('restores only valid stored identifiers and rejects invalid updates', () => {
  sessionStorage.setItem('loansight.active-financial.v1.active-run-c', run)
  const { result } = renderHook(() => useActiveFinancialRun('active-run-c'))
  expect(result.current).toBe(run)
  act(() => rememberFinancialRun('active-run-c', '/untrusted-path'))
  expect(result.current).toBe(run)
  act(() => rememberFinancialRun('active-run-c', null))
  expect(result.current).toBeNull()
})

it('keeps navigation usable when browser storage is blocked', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  const { result } = renderHook(() => useActiveFinancialRun('active-run-d'))
  act(() => rememberFinancialRun('active-run-d', run))
  expect(result.current).toBe(run)
  act(() => rememberFinancialRun('active-run-d', null))
  expect(result.current).toBeNull()
})
