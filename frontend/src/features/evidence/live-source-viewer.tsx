import { useEffect, useMemo, useRef, useState } from 'react'
import { sourceDocument } from './source-document'
import type { SourceView } from './live-api'
import { findSourceCell } from './source-cell'

export function LiveSourceViewer({
  source,
  segmentId,
  focusCell,
  onViewed,
}: {
  source: SourceView
  segmentId: string | null
  focusCell?: { row: number; column: number }
  onViewed?: (segmentId: string) => void
}) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const reported = useRef<string | null>(null)
  const document = useMemo(() => sourceDocument(source.html), [source.html])
  const anchor = segmentId ? source.anchors[segmentId] : undefined
  useEffect(() => {
    if (!loaded) return
    const content = frame.current?.contentDocument
    content
      ?.querySelectorAll('.source-active')
      .forEach((element) => element.classList.remove('source-active'))
    if (!anchor) return
    const target = content?.getElementById(anchor)
    let focusTarget = target
    target?.classList.add('source-active')
    content?.querySelectorAll('.source-active-cell').forEach((element) => {
      element.classList.remove('source-active-cell')
      element.removeAttribute('style')
    })
    if (target && focusCell) {
      const table = target.matches('table')
        ? (target as HTMLTableElement)
        : target.querySelector('table')
      const cell = findSourceCell(table, focusCell.row, focusCell.column)
      if (cell) focusTarget = cell
      cell?.classList.add('source-active-cell')
      cell?.setAttribute(
        'style',
        'background:#fff3cc;outline:3px solid #b57a00;outline-offset:-3px',
      )
    }
    focusTarget?.scrollIntoView?.({
      block: 'center',
      inline: 'center',
      behavior: focusCell ? 'auto' : 'smooth',
    })
    if (target && segmentId && reported.current !== segmentId) {
      reported.current = segmentId
      onViewed?.(segmentId)
    }
  }, [anchor, loaded, segmentId, onViewed, focusCell])
  return (
    <>
      <p className="note-view-hint">
        열람용으로 서식을 정리한 원문입니다. 원본 파일은 별도로 보존됩니다.
      </p>
      <iframe
        ref={frame}
        title="저장된 주석 원문"
        className="note-source-frame"
        sandbox="allow-same-origin"
        referrerPolicy="no-referrer"
        srcDoc={document}
        onLoad={() => setLoaded(true)}
      />
      {segmentId && !anchor && (
        <p role="alert">선택한 구간의 원문 위치를 확인할 수 없습니다.</p>
      )}
    </>
  )
}
