import type { ReactNode } from 'react'

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode
  tone?: 'neutral' | 'warning' | 'caution' | 'observation'
}) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>
}
