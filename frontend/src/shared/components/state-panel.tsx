import type { ReactNode } from 'react'
import { AlertCircle, FileSearch, LoaderCircle } from 'lucide-react'
import { Button } from './button'

type StatePanelProps = {
  state: 'loading' | 'empty' | 'error' | 'pending'
  title: string
  description?: string
  action?: { label: string; onClick: () => void; disabled?: boolean }
  children?: ReactNode
}

export function StatePanel({
  state,
  title,
  description,
  action,
  children,
}: StatePanelProps) {
  const Icon =
    state === 'loading'
      ? LoaderCircle
      : state === 'error'
        ? AlertCircle
        : FileSearch
  return (
    <div
      className={`state-panel state-panel-${state}`}
      role={state === 'error' ? 'alert' : 'status'}
      aria-busy={state === 'loading'}
    >
      <Icon
        size={26}
        aria-hidden="true"
        className={state === 'loading' ? 'loading-spinner' : undefined}
      />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && (
        <Button
          type="button"
          variant="outline"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      )}
      {children}
    </div>
  )
}
