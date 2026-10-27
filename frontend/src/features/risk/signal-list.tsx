import { useRef, useState } from 'react'
import { Button } from '../../shared/components/button'
import { StatusBadge } from '../../shared/components/status-badge'
import { StatePanel } from '../../shared/components/state-panel'
import { SourceViewer } from '../evidence/source-viewer'
import { findSource } from '../evidence/demo-evidence'
import type { ReviewCheckController } from '../review/use-review-checks'
import { severityTone, signals } from './demo-signals'

export function SignalList({
  items,
  checks,
}: {
  items: typeof signals
  checks: ReviewCheckController
}) {
  const [sourceId, setSourceId] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      {checks.error && (
        <p role="alert" className="form-error">
          {checks.error}
        </p>
      )}
      {items.length === 0 ? (
        <StatePanel
          state="empty"
          title="조건에 해당하는 예시 항목이 없습니다"
          description="필터 결과가 0건이어도 기업의 위험 없음 판정을 의미하지 않습니다."
        />
      ) : (
        <div className="signal-list">
          {items.map((signal) => {
            const viewed = checks.value.viewed.includes(signal.sourceId)
            const confirmed = checks.value.confirmed.includes(signal.id)
            return (
              <article
                key={signal.id}
                className="signal-card"
                aria-label={signal.title}
              >
                <div className="signal-heading">
                  <StatusBadge tone={severityTone(signal.severity)}>
                    {signal.severity} · 예시
                  </StatusBadge>
                  <h3>{signal.title}</h3>
                  <StatusBadge>
                    {confirmed ? '담당자 확인 완료' : '담당자 미확인'}
                  </StatusBadge>
                </div>
                <p>{signal.suggestion}</p>
                <p className="muted">
                  {signal.axis} · {signal.rule} · {signal.eventType}
                </p>
                <p className="muted">
                  근거: {findSource(signal.sourceId)!.location} · 검수 상태:
                  예시 대조 / 실제 승인 미연동
                </p>
                <div className="signal-actions">
                  <Button
                    variant="outline"
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setSourceId(signal.sourceId)
                    }}
                  >
                    {signal.severity === '경고'
                      ? '예시 원문 열기'
                      : `원문 열기: ${signal.title}`}
                  </Button>
                  <label className="option-check">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={
                        !!checks.error ||
                        (signal.severity === '경고' && !viewed && !confirmed)
                      }
                      onChange={(event) =>
                        checks.toggle(signal.id, event.target.checked)
                      }
                    />
                    {signal.title} · 담당자 확인
                  </label>
                </div>
                {signal.severity === '경고' && (
                  <p className="muted">
                    {viewed
                      ? '현재 예시 근거 revision 열람 완료 · 확인 체크는 별도입니다.'
                      : '현재 예시 원문을 먼저 확인해야 체크할 수 있습니다.'}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
      <p role="status" className="muted">
        {checks.message}
      </p>
      {sourceId && (
        <SourceViewer
          sourceId={sourceId}
          onSourceChange={setSourceId}
          onClose={() => setSourceId(null)}
          onViewed={checks.recordSource}
          returnFocus={() => opener.current?.focus()}
        />
      )}
    </>
  )
}
