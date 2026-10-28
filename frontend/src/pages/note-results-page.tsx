import { useContext, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowLeft, FileText, Search } from 'lucide-react'
import {
  getNoteStructure,
  getNoteSegments,
  getNoteSegment,
  getNoteSource,
  type NoteNode,
  type NoteStructure,
} from '../features/evidence/live-api'
import { LiveSourceViewer } from '../features/evidence/live-source-viewer'
import { BaselineSearchPanel } from '../features/evidence/baseline-search-panel'
import { SessionContext } from '../features/session/session-context'
import { ApiError } from '../features/session/api'
import { Button } from '../shared/components/button'
import { StatePanel } from '../shared/components/state-panel'
import { StatusBadge } from '../shared/components/status-badge'

export function NoteResultsPage() {
  const { structureId: rawId = '' } = useParams()
  const structureId = rawId.toLowerCase()
  const session = useContext(SessionContext)
  if (!z.string().uuid().safeParse(structureId).success)
    return (
      <main id="main" className="page">
        <StatePanel state="error" title="주석 결과 주소를 확인해 주세요" />
        <Link to="/">기업 검색으로 돌아가기</Link>
      </main>
    )
  if (session?.phase === 'loading' || session?.phase === 'changing')
    return (
      <main id="main" className="page">
        <StatePanel state="loading" title="접속 상태를 확인하고 있습니다" />
      </main>
    )
  if (!session?.session)
    return (
      <main id="main" className="page">
        <h1>주석 구조화 결과</h1>
        <StatePanel
          state="pending"
          title="코드로 접속해 주세요"
          description="상단의 코드로 접속에서 작업을 요청한 사용자 코드로 접속하면 저장된 결과를 확인할 수 있습니다."
        />
      </main>
    )
  return (
    <NoteResults
      key={`${session.session.workspace_id}:${structureId}`}
      id={structureId}
      workspaceId={session.session.workspace_id}
    />
  )
}

function NoteResults({ id, workspaceId }: { id: string; workspaceId: string }) {
  const session = useContext(SessionContext)
  const structure = useQuery({
    queryKey: ['server', workspaceId, 'note-result', id],
    queryFn: ({ signal }) => getNoteStructure(id, signal),
    retry: false,
    refetchInterval: (query) =>
      query.state.data &&
      ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(query.state.data.status)
        ? 1000
        : false,
  })
  useEffect(() => {
    if (structure.error instanceof ApiError && structure.error.status === 401)
      session?.expire()
  }, [structure.error, session])
  if (structure.isPending)
    return (
      <main id="main" className="page">
        <StatePanel
          state="loading"
          title="저장된 주석 결과를 불러오는 중입니다"
        />
      </main>
    )
  if (structure.isError)
    return (
      <main id="main" className="page">
        <StatePanel
          state="error"
          title="주석 결과를 불러오지 못했습니다"
          description={
            structure.error instanceof ApiError &&
            structure.error.status === 404
              ? '결과가 없거나 현재 사용자에게 조회 권한이 없습니다.'
              : '서버 연결과 접속 상태를 확인해 주세요.'
          }
          action={{
            label: '다시 조회',
            onClick: () => {
              void structure.refetch()
            },
          }}
        />
        <Link to="/">기업 검색으로 돌아가기</Link>
      </main>
    )
  if (structure.data.status !== 'SUCCEEDED' || !structure.data.hierarchy)
    return (
      <main id="main" className="page">
        <h1>주석 구조화 결과</h1>
        <StatePanel
          state={structure.data.status === 'FAILED' ? 'error' : 'loading'}
          title={
            structure.data.status === 'FAILED'
              ? '주석 구조화 작업이 실패했습니다'
              : '주석을 구조화하고 있습니다'
          }
          description="내 분석 작업에서 처리 상태를 확인할 수 있습니다."
        />
        <Link to="/">기업 검색으로 돌아가기</Link>
      </main>
    )
  return (
    <ResultsContent
      id={id}
      workspaceId={workspaceId}
      metadata={structure.data}
    />
  )
}

function needsReview(node: NoteNode) {
  return (
    !!node.review_flags?.length ||
    !!node.status?.includes('unresolved') ||
    (node.id !== 'root' && node.parent_id === null)
  )
}

function ResultsContent({
  id,
  workspaceId,
  metadata,
}: {
  id: string
  workspaceId: string
  metadata: NoteStructure
}) {
  const session = useContext(SessionContext)
  const sourcePanel = useRef<HTMLElement>(null)
  const [params, setParams] = useSearchParams()
  const node = params.get('node') ?? ''
  const q = params.get('q') ?? ''
  const tables = params.get('tables') === '1'
  const [tableInput, setTableInput] = useState({ url: tables, checked: tables })
  if (tableInput.url !== tables) setTableInput({ url: tables, checked: tables })
  const segmentParam = params.get('segment')
  const [input, setInput] = useState({ q, value: q })
  if (input.q !== q) setInput({ q, value: q })
  const filters = { node, q, tables }
  const rows = useInfiniteQuery({
    queryKey: ['server', workspaceId, 'note-segments', id, filters],
    queryFn: ({ pageParam, signal }) =>
      getNoteSegments(id, pageParam, filters, signal),
    initialPageParam: -1,
    getNextPageParam: (page) => page.next_after ?? undefined,
    retry: false,
  })
  const selectedQuery = useQuery({
    queryKey: ['server', workspaceId, 'note-segment', id, segmentParam],
    queryFn: ({ signal }) => getNoteSegment(id, segmentParam!, signal),
    enabled:
      !!segmentParam && z.string().uuid().safeParse(segmentParam).success,
    retry: false,
  })
  const source = useQuery({
    queryKey: ['server', workspaceId, 'note-source', id],
    queryFn: ({ signal }) => getNoteSource(id, signal),
    retry: false,
  })
  useEffect(() => {
    if (
      [rows.error, selectedQuery.error, source.error].some(
        (error) => error instanceof ApiError && error.status === 401,
      )
    )
      session?.expire()
  }, [rows.error, selectedQuery.error, source.error, session])
  const segments = rows.data?.pages.flatMap((page) => page.segments) ?? []
  const selected = segmentParam ? selectedQuery.data : segments[0]
  const nodes = metadata.hierarchy!.nodes
  const nodeMap = new Map(nodes.map((item) => [item.id, item]))
  function depth(item: NoteNode) {
    let result = 0
    const seen = new Set([item.id])
    let parent = item.parent_id
    while (parent && parent !== 'root' && !seen.has(parent)) {
      seen.add(parent)
      result += 1
      parent = nodeMap.get(parent)?.parent_id ?? null
    }
    return Math.min(result, 5)
  }
  function filter(key: string, value: string) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        next.delete('segment')
        return next
      },
      { flushSync: true, preventScrollReset: true },
    )
  }
  function reset() {
    setInput({ q: '', value: '' })
    setTableInput({ url: tables, checked: false })
    setParams({})
  }
  const validSource = source.data?.source_sha256 === metadata.source_sha256
  const back =
    '/?' +
    new URLSearchParams({
      q: metadata.corp_code,
      report: metadata.receipt_no,
      scope: metadata.scope,
    })
  return (
    <main id="main" className="page note-results-page">
      <Link to={back} className="note-back">
        <ArrowLeft size={16} />
        기업 검색으로 돌아가기
      </Link>
      <div className="page-eyebrow">SAVED NOTES</div>
      <div className="note-results-heading">
        <div>
          <h1>주석 구조화 결과</h1>
          <p>
            {metadata.company_name ?? metadata.corp_code} · {metadata.period}{' '}
            결산 · {metadata.scope === 'OFS' ? '별도' : '연결'}({metadata.scope}
            )
          </p>
        </div>
        <StatusBadge tone="caution">내용 검수 전</StatusBadge>
      </div>
      <div className="note-source-meta">
        <span>기업 고유번호 {metadata.corp_code}</span>
        <span>접수번호 {metadata.receipt_no}</span>
        <span>{metadata.segment_count?.toLocaleString()}개 구간</span>
        <span>
          {metadata.input_origin === 'dart_viewer_note_html'
            ? 'DART 수집 원문'
            : '사용자 제출 HTML'}
        </span>
        {metadata.input_origin === 'dart_viewer_note_html' && (
          <a
            href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${metadata.receipt_no}`}
            target="_blank"
            rel="noreferrer"
          >
            DART 공시 열기
          </a>
        )}
      </div>
      <p className="notice">
        목차와 구간을 정리한 결과입니다. 미확정 구조를 포함하며 재무 분석·주석
        내용 검수가 완료된 상태는 아닙니다.
      </p>
      <BaselineSearchPanel
        id={id}
        workspaceId={workspaceId}
        hash={metadata.source_sha256}
        onSelect={(segmentId) => {
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous)
              next.set('segment', segmentId)
              return next
            },
            { preventScrollReset: true },
          )
          sourcePanel.current?.scrollIntoView({
            block: 'start',
            behavior: 'smooth',
          })
        }}
      />
      <div className="note-results-grid">
        <nav className="panel note-toc" aria-label="주석 목차">
          <div className="panel-heading">
            <h2>목차</h2>
            <span>{nodes.length - 1}개 항목</span>
          </div>
          <div className="note-toc-items">
            <button
              className={!node || node === 'root' ? 'active' : ''}
              aria-pressed={!node || node === 'root'}
              onClick={() => filter('node', '')}
            >
              전체 주석
            </button>
            {nodes
              .filter((item) => item.id !== 'root')
              .map((item) => (
                <button
                  key={item.id}
                  className={node === item.id ? 'active' : ''}
                  style={{ paddingLeft: `${14 + depth(item) * 12}px` }}
                  aria-pressed={node === item.id}
                  onClick={() => filter('node', item.id)}
                >
                  <span>{item.title}</span>
                  {needsReview(item) && <small>구조 확인 필요</small>}
                </button>
              ))}
          </div>
        </nav>
        <div className="note-workspace">
          <section className="panel note-segments" aria-label="주석 구간 목록">
            <div className="panel-heading">
              <h2>원문 구간</h2>
              <span>
                {rows.data?.pages[0]?.total.toLocaleString() ?? '조회 중'}
              </span>
            </div>
            <form
              className="note-segment-search"
              onSubmit={(event) => {
                event.preventDefault()
                filter('q', input.value)
              }}
            >
              <label>
                <Search size={16} />
                <input
                  aria-label="주석 구간 검색"
                  value={input.value}
                  maxLength={200}
                  onChange={(event) =>
                    setInput({ q, value: event.target.value })
                  }
                  placeholder="구간 내용 검색"
                />
              </label>
              <Button type="submit" variant="outline">
                검색
              </Button>
            </form>
            <div className="note-segment-filters">
              <label>
                <input
                  type="checkbox"
                  checked={tableInput.checked}
                  onChange={(event) => {
                    setTableInput({
                      url: tables,
                      checked: event.target.checked,
                    })
                    filter('tables', event.target.checked ? '1' : '')
                  }}
                />
                표만 보기
              </label>
              <Button variant="ghost" onClick={reset}>
                조건 초기화
              </Button>
            </div>
            {rows.isPending ? (
              <StatePanel state="loading" title="구간을 불러오는 중입니다" />
            ) : rows.isError ? (
              <StatePanel
                state="error"
                title="구간을 조회하지 못했습니다"
                action={{ label: '조건 초기화', onClick: reset }}
              />
            ) : !segments.length ? (
              <StatePanel
                state="empty"
                title="조건에 맞는 구간이 없습니다"
                action={{ label: '조건 초기화', onClick: reset }}
              />
            ) : (
              <div className="note-segment-items">
                {segments.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={selected?.id === item.id}
                    onClick={() =>
                      setParams((previous) => {
                        const next = new URLSearchParams(previous)
                        next.set('segment', item.id)
                        return next
                      })
                    }
                  >
                    <span className="note-segment-kind">
                      <FileText size={14} />
                      {item.kind === 'table' ? '표' : '본문'} · 구간{' '}
                      {item.ordinal + 1}
                    </span>
                    {item.kind === 'table' &&
                      item.table_data?.display_title && (
                        <strong>{item.table_data.display_title}</strong>
                      )}
                    <span className="note-segment-preview">
                      {item.text.replace(/\s+/g, ' ').trim()}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {rows.hasNextPage && (
              <Button
                variant="outline"
                disabled={rows.isFetchingNextPage}
                onClick={() => {
                  void rows.fetchNextPage()
                }}
              >
                {rows.isFetchingNextPage ? '불러오는 중…' : '구간 더 불러오기'}
              </Button>
            )}
            {segmentParam &&
              (selectedQuery.isError ||
                !z.string().uuid().safeParse(segmentParam).success) && (
                <StatePanel
                  state="error"
                  title="선택한 구간을 확인해 주세요"
                  action={{
                    label: '선택 초기화',
                    onClick: () => filter('segment', ''),
                  }}
                />
              )}
            {selected && (
              <section className="note-segment-detail" aria-label="선택한 구간">
                <h3>
                  {selected.kind === 'table' ? '표 구간' : '본문 구간'}{' '}
                  {selected.ordinal + 1}
                </h3>
                <p>{selected.text.trim().replace(/\n\s*\n/g, '\n')}</p>
                <span>
                  목차: {nodeMap.get(selected.owner_node_id)?.title ?? '미확정'}
                </span>
              </section>
            )}
          </section>
          <section
            ref={sourcePanel}
            className="panel note-original"
            aria-label="주석 원문"
          >
            <div className="panel-heading">
              <h2>저장된 원문</h2>
              <span>{metadata.scope}</span>
            </div>
            {source.isPending ? (
              <StatePanel state="loading" title="원문을 불러오는 중입니다" />
            ) : source.isError || !validSource ? (
              <StatePanel
                state="error"
                title="원문을 표시하지 못했습니다"
                description="저장 상태와 원본 일치를 확인하지 못했습니다."
                action={{
                  label: '다시 조회',
                  onClick: () => {
                    void source.refetch()
                  },
                }}
              />
            ) : (
              source.data && (
                <LiveSourceViewer
                  key={`${id}:${metadata.source_sha256}`}
                  source={source.data}
                  segmentId={selected?.id ?? null}
                />
              )
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
