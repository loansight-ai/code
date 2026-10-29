import { useContext, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Modal } from '../../shared/components/modal'
import { StatePanel } from '../../shared/components/state-panel'
import { SessionContext } from '../session/session-context'
import { ApiError } from '../session/api'
import { getNoteSource } from './live-api'
import { LiveSourceViewer } from './live-source-viewer'

export function NoteSourceDrawer({
  id,
  workspaceId,
  hash,
  segmentId,
  focusCell,
  onClose,
  onViewed,
}: {
  id: string
  workspaceId: string
  hash: string
  segmentId: string | null
  focusCell?: { row: number; column: number }
  onClose: () => void
  onViewed?: (id: string) => void
}) {
  const session = useContext(SessionContext)
  const source = useQuery({
    queryKey: ['server', workspaceId, 'note-source', id],
    queryFn: ({ signal }) => getNoteSource(id, signal),
    enabled: !!segmentId,
    retry: false,
  })
  useEffect(() => {
    if (source.error instanceof ApiError && source.error.status === 401)
      session?.expire()
  }, [source.error, session])
  return (
    <Modal
      title="원문 근거 확인"
      description={`접수 원문의 인용 구간 · 원문 ${hash.slice(0, 12)} · 검수 전`}
      open={!!segmentId}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      variant="drawer"
    >
      {source.isPending ? (
        <StatePanel state="loading" title="원문을 불러오는 중입니다" />
      ) : source.isError || source.data?.source_sha256 !== hash ? (
        <StatePanel
          state="error"
          title="원문을 확인하지 못했습니다"
          action={{
            label: '다시 조회',
            onClick: () => {
              void source.refetch()
            },
          }}
        />
      ) : (
        <LiveSourceViewer
          key={`${id}:${hash}`}
          source={source.data}
          segmentId={segmentId}
          focusCell={focusCell}
          onViewed={onViewed}
        />
      )}
    </Modal>
  )
}
