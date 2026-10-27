import { useEffect, useState } from 'react'
import type { DemoContext } from '../analysis/demo-context'
import {
  readChecks,
  reviewKey,
  saveChecks,
  type CheckEntry,
  type ReviewChecks,
} from './review-store'

function load(context: DemoContext) {
  try {
    return { entries: readChecks(context), error: '' }
  } catch {
    return {
      entries: [] as CheckEntry[],
      error: '근거 확인 기록을 읽지 못했습니다. 기존 데이터는 보존합니다.',
    }
  }
}
export function useReviewChecks(context: DemoContext) {
  const [journal, setJournal] = useState(() => load(context))
  const [message, setMessage] = useState('')
  const key = reviewKey(context, 'checks')
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setJournal(load(context))
    }
    window.addEventListener('storage', update)
    return () => window.removeEventListener('storage', update)
  }, [context, key])
  const value: ReviewChecks = journal.entries.at(-1)?.value ?? {
    viewed: [],
    confirmed: [],
  }
  function commit(next: ReviewChecks) {
    if (journal.error) return journal.error
    try {
      saveChecks(context, journal.entries.at(-1)?.id ?? null, next)
      setJournal(load(context))
      setMessage(
        '로컬 예시 확인 기록을 저장했습니다. 위험 없음 판정이나 서버 기록이 아닙니다.',
      )
      return ''
    } catch {
      setJournal(load(context))
      const error =
        '확인 기록을 저장하지 못했습니다. 저장 공간 또는 다른 화면의 변경을 확인한 뒤 다시 시도해 주세요.'
      setMessage(error)
      return error
    }
  }
  return {
    value,
    error: journal.error,
    message,
    recordSource: (id: string) =>
      value.viewed.includes(id)
        ? ''
        : commit({ ...value, viewed: [...value.viewed, id] }),
    toggle: (id: string, checked: boolean) =>
      commit({
        ...value,
        confirmed: checked
          ? [...new Set([...value.confirmed, id])]
          : value.confirmed.filter((item) => item !== id),
      }),
  }
}
export type ReviewCheckController = ReturnType<typeof useReviewChecks>
