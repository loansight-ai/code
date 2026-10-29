import { useContext, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { getNoteStructure } from '../evidence/live-api'
import { SessionContext } from '../session/session-context'
import { ApiError } from '../session/api'

export function useNoteWorkspace(id?: string) {
  const session = useContext(SessionContext)
  const workspaceId = session?.session?.workspace_id
  const valid = !!id && z.string().uuid().safeParse(id).success
  const query = useQuery({
    queryKey: ['server', workspaceId, 'note-result', id],
    queryFn: ({ signal }) => getNoteStructure(id!, signal),
    enabled: valid && !!workspaceId && session?.phase === 'ready',
    retry: false,
    refetchInterval: (q) =>
      q.state.data &&
      ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(q.state.data.status)
        ? 1000
        : false,
  })
  useEffect(() => {
    if (query.error instanceof ApiError && query.error.status === 401)
      session?.expire()
  }, [query.error, session])
  return {
    ...query,
    data: session?.phase === 'ready' ? query.data : undefined,
    workspaceId,
    session,
    valid,
  }
}
