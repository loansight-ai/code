import { useContext, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Button } from '../../shared/components/button'
import { ApiError, errorMessage, request } from '../session/api'
import { SessionContext } from '../session/session-context'
import { TaskContext } from '../tasks/task-context'

const resultSchema = z.object({
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  execution_status: z.enum(['COMPLETED', 'INCOMPLETE']),
  evidence_verified: z.literal(false),
  stop_reason: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        key: z.string(),
        search_status: z.enum(['COMPLETED', 'INCOMPLETE']),
        limitations: z.string(),
        findings: z.array(
          z.object({
            statement: z.string(),
            citations: z.array(
              z.object({ segment_id: z.string().uuid(), quote: z.string() }),
            ),
          }),
        ),
      }),
    )
    .length(6),
})
const savedSchema = z.object({
  available: z.boolean(),
  provider: z.string().default('codex'),
  run: z
    .object({
      run_id: z.string().uuid(),
      structure_id: z.string().uuid(),
      status: z.string(),
      error_code: z.string().nullable(),
      result: resultSchema.nullable(),
    })
    .nullable(),
})
const titles: Record<string, string> = {
  audit: '감사의견·계속기업',
  borrowing: '차입 만기·재무약정',
  credit: '신용등급',
  collateral: '담보',
  litigation: '소송·제재',
  off_balance: '부외·후속사건',
}
const terminal = ['SUCCEEDED', 'PARTIAL_SUCCEEDED', 'FAILED']
const stopLabels: Record<string, string> = {
  codex_auth_required: '서버의 Codex 로그인이 필요합니다.',
  codex_start_failed: '서버에서 Codex를 실행하지 못했습니다.',
  note_agent_timeout: '실행 시간 제한에 도달했습니다.',
  note_agent_tool_budget_exhausted: '검색 도구 호출 제한에 도달했습니다.',
  note_agent_output_invalid: '원문 인용이나 응답 형식을 검증하지 못했습니다.',
}

export function AgentSearchPanel({
  id,
  hash,
  workspaceId,
  onSelect,
}: {
  id: string
  hash: string
  workspaceId: string
  onSelect: (id: string) => void
}) {
  const session = useContext(SessionContext)
  const tasks = useContext(TaskContext)
  const cache = useQueryClient()
  const key = ['server', workspaceId, 'note-agent', id, hash]
  const saved = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const data = savedSchema.parse(
        await request(`/me/note-imports/${id}/search/agent`, { signal }),
      )
      if (
        data.run &&
        (data.run.structure_id !== id ||
          (data.run.result &&
            (data.run.result.structure_id !== id ||
              data.run.result.source_sha256 !== hash)))
      )
        throw new Error('Agent source mismatch')
      return data
    },
    refetchInterval: (query) =>
      query.state.data?.run && !terminal.includes(query.state.data.run.status)
        ? 1500
        : false,
    retry: false,
  })
  const start = useMutation({
    mutationFn: () =>
      request(`/me/note-imports/${id}/search/agent`, { method: 'POST' }),
    onSuccess: async () => {
      tasks?.refresh()
      await cache.invalidateQueries({ queryKey: key })
    },
  })
  useEffect(() => {
    if (
      [saved.error, start.error].some(
        (e) => e instanceof ApiError && e.status === 401,
      )
    )
      session?.expire()
  }, [saved.error, start.error, session])
  const run = saved.data?.run
  const provider = saved.data?.provider ?? 'codex'
  const providerName =
    provider === 'codex' ? 'Codex' : provider === 'openai' ? 'OpenAI' : 'AI'
  const running = !!run && !terminal.includes(run.status)
  const completed = run?.status === 'SUCCEEDED'
  return (
    <section aria-label="AI 보완 탐색" className="baseline-category">
      <h3>{providerName} 보완 탐색</h3>
      <p className="note-view-hint">
        검색어를 확장하고 문맥을 읽어 근거 후보를 정리합니다. 결과는 검수
        전이며, 미확보 영역은 추가 확인이 필요합니다.
      </p>
      {saved.isPending ? (
        <p role="status">보완 탐색 상태 확인 중…</p>
      ) : saved.isError ? (
        <div role="alert">
          <p>{errorMessage(saved.error)}</p>
          <Button
            variant="outline"
            onClick={() => {
              void saved.refetch()
            }}
          >
            다시 조회
          </Button>
        </div>
      ) : (
        !saved.data?.available && (
          <p role="status">서버의 에이전트 실행 설정이 필요합니다.</p>
        )
      )}
      {!completed && (
        <Button
          disabled={!saved.data?.available || running || start.isPending}
          onClick={() => start.mutate()}
        >
          {running || start.isPending
            ? `${providerName} 탐색 진행 중…`
            : run
              ? '보완 탐색 다시 실행'
              : `${providerName}로 보완 탐색`}
        </Button>
      )}
      {start.isError && <p role="alert">{errorMessage(start.error)}</p>}
      {run?.status === 'FAILED' && (
        <p role="alert">
          보완 탐색에 실패했습니다. 기본 검색 결과는 계속 확인할 수 있습니다.
        </p>
      )}
      {run?.result && (
        <>
          {run.result.stop_reason && stopLabels[run.result.stop_reason] && (
            <p>{stopLabels[run.result.stop_reason]}</p>
          )}
          <p role="status">
            {run.result.execution_status === 'COMPLETED'
              ? '보완 탐색 완료 · 검수 전'
              : '보완 탐색 미완료 · 기본 검색과 추가 확인 필요'}
          </p>
          {run.result.items.map((item) => (
            <div key={item.key}>
              <h4>
                {titles[item.key] ?? item.key}
                {item.search_status === 'INCOMPLETE' ? ' · 미완료' : ''}
              </h4>
              <p>{item.limitations}</p>
              {item.findings.map((finding, index) => (
                <div key={index}>
                  <p>{finding.statement}</p>
                  {finding.citations.map((citation, n) => (
                    <div key={`${citation.segment_id}:${n}`}>
                      <blockquote>{citation.quote}</blockquote>
                      <Button
                        variant="outline"
                        onClick={() => onSelect(citation.segment_id)}
                      >
                        인용 원문에서 확인
                      </Button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </section>
  )
}
