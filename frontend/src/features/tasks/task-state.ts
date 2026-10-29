import { z } from 'zod'

export const taskSchema = z.object({
  task_id: z.string().uuid(),
  job_id: z.string().uuid(),
  task_type: z.string(),
  analysis_run_id: z.string().nullable(),
  status: z.string(),
  stage: z.string(),
  state_version: z.number().int().positive(),
  attempt: z.number().int().nonnegative(),
  error_code: z.string().nullable(),
  occurred_at: z.string(),
  acknowledged: z.boolean(),
})
export type Task = z.infer<typeof taskSchema>
export const snapshotSchema = z.object({
  tasks: z.array(taskSchema),
  event_cursor: z.string(),
})
export const detailSchema = taskSchema.extend({ result: z.unknown() })
export type TaskDetail = z.infer<typeof detailSchema>
export const isTerminal = (task: Task) =>
  ['SUCCEEDED', 'PARTIAL_SUCCEEDED', 'FAILED'].includes(task.status)

// Retain acknowledged entries until the next snapshot so an older state cannot
// resurrect a dismissed completion at the same version.
export function mergeTask(tasks: Task[], incoming: Task): Task[] {
  const previous = tasks.find((task) => task.task_id === incoming.task_id)
  if (
    previous &&
    (previous.state_version > incoming.state_version ||
      (previous.state_version === incoming.state_version &&
        previous.acknowledged &&
        !incoming.acknowledged))
  )
    return tasks
  return previous
    ? tasks.map((task) => (task.task_id === incoming.task_id ? incoming : task))
    : [...tasks, incoming]
}

export function cursorSequence(cursor: string, stream: string): bigint | null {
  const [prefix, sequence, extra] = cursor.split(':')
  return prefix === stream && sequence && /^\d+$/.test(sequence) && !extra
    ? BigInt(sequence)
    : null
}

export const statusLabels: Record<string, string> = {
  QUEUED: '대기',
  RUNNING: '실행 중',
  RETRY_WAIT: '재시도 대기',
  SUCCEEDED: '완료',
  PARTIAL_SUCCEEDED: '부분 완료',
  FAILED: '실패',
}
export const stageLabels: Record<string, string> = {
  QUEUED: '전달 대기',
  DISPATCH: '연결 점검 중',
  NOTE_STRUCTURE: '주석 구조화 중',
  NOTE_AGENT: '주석 근거 보완 탐색 중',
  DART_COLLECT: 'DART 원문·주석 HTML 수집 중',
  FINANCIAL_ANALYSIS: '공시 재무 수집·계산 중',
  RETRY_WAIT: '재시도 대기',
  COMPLETED: '처리 완료',
  FAILED: '처리 실패',
}
