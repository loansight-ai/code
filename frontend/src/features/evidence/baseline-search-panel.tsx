import { useContext, useEffect, useState } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { SessionContext } from '../session/session-context'
import { ApiError, errorMessage } from '../session/api'
import { Button } from '../../shared/components/button'
import {
  getBaseline,
  startBaseline,
  searchMore,
  type BaselineItem,
} from './search-api'

export function BaselineSearchPanel({
  id,
  workspaceId,
  hash,
  onSelect,
}: {
  id: string
  workspaceId: string
  hash: string
  onSelect: (id: string) => void
}) {
  const session = useContext(SessionContext)
  const cache = useQueryClient()
  const key = ['server', workspaceId, 'note-baseline', id, hash]
  const saved = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getBaseline(id, hash, signal),
    retry: false,
  })
  const run = useMutation({
    mutationFn: () => startBaseline(id, hash),
    onSuccess: (data) => cache.setQueryData(key, data),
  })
  useEffect(() => {
    if (
      [saved.error, run.error].some(
        (error) => error instanceof ApiError && error.status === 401,
      )
    )
      session?.expire()
  }, [saved.error, run.error, session])
  const [active, setActive] = useState('audit')
  const item = saved.data?.items.find((item) => item.key === active)
  return (
    <section className="panel baseline-search" aria-label="공통 주석 근거 검색">
      <div className="panel-heading">
        <h2>공통 주석 6항목 · 근거 검색</h2>
        <span>검수 전</span>
      </div>
      <div className="baseline-body">
        <p>
          저장된 재무제표 주석에서 관련 문단·표를 찾습니다. 검색 결과는 위험
          발생 판정이 아닙니다.
        </p>
        <p className="note-view-hint">
          사업보고서 전체를 검색한 결과가 아닙니다. 감사보고서·신용평가 등 다른
          영역은 추가 확인이 필요합니다.
        </p>
        {saved.isPending ? (
          <p role="status">저장된 검색 결과를 확인하고 있습니다.</p>
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
          !saved.data && (
            <Button disabled={run.isPending} onClick={() => run.mutate()}>
              {run.isPending ? '6항목 검색 중…' : '6항목 기본 검색'}
            </Button>
          )
        )}
        {run.isError && <p role="alert">{errorMessage(run.error)}</p>}
        {saved.data && (
          <>
            <p className="note-view-hint">
              기본 검색 완료 ·{' '}
              {new Date(saved.data.created_at).toLocaleString('ko-KR', {
                timeZone: 'Asia/Seoul',
              })}{' '}
              (한국 시각) · AI 보완 검색 미실행
            </p>
            <div
              className="baseline-categories"
              role="group"
              aria-label="검색 항목"
            >
              {saved.data.items.map((value) => (
                <button
                  key={value.key}
                  aria-pressed={value.key === active}
                  onClick={() => setActive(value.key)}
                >
                  {value.title}
                  <span>{value.total}개 후보</span>
                </button>
              ))}
            </div>
            {item && (
              <CategoryResults
                key={`${saved.data.run_id}:${item.key}`}
                item={item}
                runId={saved.data.run_id}
                id={id}
                workspaceId={workspaceId}
                hash={hash}
                onSelect={onSelect}
              />
            )}
          </>
        )}
      </div>
    </section>
  )
}

function CategoryResults({
  item,
  runId,
  id,
  workspaceId,
  hash,
  onSelect,
}: {
  item: BaselineItem
  runId: string
  id: string
  workspaceId: string
  hash: string
  onSelect: (id: string) => void
}) {
  const session = useContext(SessionContext)
  const more = useInfiniteQuery({
    queryKey: [
      'server',
      workspaceId,
      'note-baseline-more',
      runId,
      id,
      item.key,
      hash,
    ],
    queryFn: ({ signal, pageParam }) =>
      searchMore(id, hash, item.terms, pageParam, signal),
    initialPageParam: item.next_offset ?? 0,
    getNextPageParam: (page) => page.next_offset ?? undefined,
    enabled: false,
    retry: false,
  })
  useEffect(() => {
    if (more.error instanceof ApiError && more.error.status === 401)
      session?.expire()
  }, [more.error, session])
  const extra = more.data?.pages.flatMap((page) => page.candidates) ?? []
  const next = more.data
    ? more.data.pages.at(-1)!.next_offset
    : item.next_offset
  return (
    <div className="baseline-category">
      <h3>{item.title}</h3>
      <p className="note-view-hint">검색어: {item.terms.join(' · ')}</p>
      {item.unavailable_regions.length > 0 && (
        <p className="notice">
          추가 확인이 필요한 영역: {item.unavailable_regions.join(' · ')}
        </p>
      )}
      {item.total === 0 && (
        <p role="status">
          검색 범위에서 일치하는 후보를 찾지 못했습니다. 해당 사항이 없다는 뜻은
          아닙니다.
        </p>
      )}
      <ul className="baseline-candidates">
        {[...item.candidates, ...extra].map((candidate) => (
          <li key={candidate.segment_id}>
            <div>
              <strong>
                {candidate.table_title ||
                  candidate.section_path.at(-1)?.title ||
                  '목차 미확정'}
              </strong>
              <span>
                {candidate.kind === 'table' ? '표' : '본문'} · 구간{' '}
                {candidate.ordinal + 1}
              </span>
            </div>
            <p>{candidate.excerpt.text.trim().replace(/\s+/g, ' ')}</p>
            <small>
              일치: {candidate.matches.map((match) => match.term).join(' · ')}
              {candidate.excerpt.truncated ? ' · 일부 발췌' : ''}
            </small>
            <Button
              variant="outline"
              onClick={() => onSelect(candidate.segment_id)}
            >
              원문에서 확인
            </Button>
          </li>
        ))}
      </ul>
      {more.isError && (
        <div role="alert">
          <p>{errorMessage(more.error)}</p>
          <Button
            variant="outline"
            onClick={() => {
              void more.fetchNextPage()
            }}
          >
            다시 조회
          </Button>
        </div>
      )}
      {next !== null && !more.isError && (
        <Button
          variant="outline"
          disabled={more.isFetching}
          onClick={() => {
            void more.fetchNextPage()
          }}
        >
          {more.isFetching ? '불러오는 중…' : '후보 더 보기'}
        </Button>
      )}
    </div>
  )
}
