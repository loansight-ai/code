import { useEffect, useMemo, useRef, useState } from 'react'
import { sourceDocument } from './source-document'
import type { SourceView } from './live-api'

export function LiveSourceViewer({
  source,
  segmentId,
  onViewed,
}: {
  source: SourceView
  segmentId: string | null
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
    target?.classList.add('source-active')
    target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    if (target && segmentId && reported.current !== segmentId) {
      reported.current = segmentId
      onViewed?.(segmentId)
    }
  }, [anchor, loaded, segmentId, onViewed])
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
