import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Modal } from '../../shared/components/modal'
import './formula-dialog.css'

export function FormulaDialog({
  title,
  description,
  formula,
  state,
  rows,
  reason,
  sourceUrl,
  onClose,
  onCloseAutoFocus,
}: {
  title: string
  description: string
  formula: string
  state: 'confirmed' | 'pending' | 'example'
  rows: { label: string; value: ReactNode }[]
  reason: string
  sourceUrl?: string
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const label =
    state === 'confirmed' ? '확정' : state === 'pending' ? '계산 보류' : '예시'
  return (
    <Modal
      open
      title={title}
      description={description}
      className="formula-dialog"
      headerAside={
        <span className={`formula-state formula-state-${state}`}>{label}</span>
      }
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <div className="formula-expression">
        <span>계산식</span>
        <strong>{formula}</strong>
      </div>
      <table className="formula-definition" aria-label="산식 정의">
        <thead>
          <tr>
            <th scope="col">항목</th>
            <th scope="col">정의</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label: rowLabel, value }) => (
            <tr key={rowLabel}>
              <th scope="row">{rowLabel}</th>
              <td>{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div
        className={`formula-explanation ${state === 'pending' ? 'is-pending' : ''}`}
      >
        <strong>
          {state === 'pending'
            ? '계산을 보류한 이유'
            : state === 'example'
              ? '예시 자료 안내'
              : '자료 확인'}
        </strong>
        <p>{reason}</p>
      </div>
      {sourceUrl && (
        <a
          className="formula-source"
          href={sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          해당 공시 원문 확인
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      )}
    </Modal>
  )
}
