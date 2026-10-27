import { useState } from 'react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { StatePanel } from '../../shared/components/state-panel'
import { StatusBadge } from '../../shared/components/status-badge'
import { evidenceRevision, findSource } from './demo-evidence'

export function SourceViewer({
  sourceId,
  onSourceChange,
  onClose,
  onViewed,
  returnFocus,
}: {
  sourceId: string
  onSourceChange: (id: string) => void
  onClose: () => void
  onViewed: (id: string) => string
  returnFocus?: () => void
}) {
  const source = findSource(sourceId)
  const [error, setError] = useState('')
  return (
    <Modal
      open
      title={source?.title ?? '원문을 표시할 수 없습니다'}
      description={`${evidenceRevision} · 가상 원문. 서버 열람 기록과 실제 검수는 미연동입니다.`}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      onCloseAutoFocus={(event) => {
        if (returnFocus) {
          event.preventDefault()
          returnFocus()
        }
      }}
    >
      {!source ? (
        <StatePanel
          state="error"
          title="해당 원문 구간을 찾지 못했습니다"
          description="표시 실패를 원문 열람으로 기록하지 않습니다."
        />
      ) : (
        <>
          <div className="source-meta">
            <StatusBadge>{source.detection} · 예시</StatusBadge>
            <span>{source.location}</span>
            <span>접수번호 미연동 · revision {evidenceRevision}</span>
          </div>
          <blockquote>{source.text}</blockquote>
          <p className="muted">구조화 사실: {source.fact}</p>
          {source.related.length > 0 && (
            <div className="source-related">
              <strong>연결된 예시 원문</strong>
              {source.related.map((id) => (
                <Button
                  key={id}
                  variant="ghost"
                  onClick={() => {
                    setError('')
                    onSourceChange(id)
                  }}
                >
                  {findSource(id)?.title}
                </Button>
              ))}
            </div>
          )}
          <p className="muted">
            현재 표시한 구간만 로컬 열람 상태로 기록합니다. 열람 기록은 내용을
            이해하거나 위험이 없음을 확인했다는 뜻이 아닙니다.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <Button
            onClick={() => {
              const result = onViewed(source.id)
              setError(result)
              if (!result) onClose()
            }}
          >
            예시 원문 확인 후 닫기
          </Button>
        </>
      )}
    </Modal>
  )
}
