import { createContext, useContext } from 'react'
import type { Task, TaskDetail } from './task-state'

export type TasksState = {
  tasks: Task[]
  connection:
    'idle' | 'loading' | 'connecting' | 'live' | 'reconnecting' | 'error'
  message: string
  refresh: () => void
  diagnostic: (key: string) => Promise<void>
  acknowledge: (task: Task) => Promise<void>
  detail: (id: string) => Promise<TaskDetail>
}
export const TaskContext = createContext<TasksState | null>(null)
export function useTasks() {
  const value = useContext(TaskContext)
  if (!value) throw new Error('TaskProvider is required')
  return value
}
