import { ArrowUpRight } from 'lucide-react'
import type { ExposureSource } from './exposure-api'

export function ExposureSourceLinks({
  sources,
  onOpen,
}: {
  sources: ExposureSource[]
  onOpen: (source: ExposureSource) => void
}) {
  return (
    <span className="exposure-sources">
      {sources.map((source) => (
        <button
          key={source.segment_id}
          title={source.title}
          onClick={() => onOpen(source)}
        >
          {source.title}
          <ArrowUpRight size={11} aria-hidden="true" />
        </button>
      ))}
    </span>
  )
}
