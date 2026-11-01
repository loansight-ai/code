import { useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { SessionContext } from '../session/session-context'
import { request } from '../session/api'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'
import { FactPanel } from './fact-panel'
import { FactForm } from './fact-form'
import { LiveSignals } from '../risk/live-signals'
import { StatusBadge } from '../../shared/components/status-badge'
import { Search, FileSearch, ChevronDown } from 'lucide-react'
import {
  agentSchema,
  baselineBundle,
  bundleContext,
  bundleSections,
  getBundleCandidate,
  searchBundle,
  type BundleCandidate,
  type EvidenceBundle,
} from './bundle-api'

const regions: Record<string, string> = {
  notes: '재무제표 주석',
  business_report: '사업보고서',
  audit: '감사 자료',
}
export function BundlePanel({ bundle }: { bundle: EvidenceBundle }) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  // Unmount the whole panel on owner/revision changes (the parent supplies its key).
  const [selected, setSelected] = useState<BundleCandidate | null>(null)
  const [input, setInput] = useState('')
  const [origin, setOrigin] = useState<'' | 'html' | 'dump'>('')
  const [query, setQuery] = useState<{
    terms: string[]
    offset: number
    node?: string
  } | null>(null)
  const [sectionOffset, setSectionOffset] = useState(0)
  const baseline = useMutation({ mutationFn: () => baselineBundle(bundle) })
  const results = useQuery({
    queryKey: ['server', owner, bundle.bundle_id, 'search', query, origin],
    queryFn: () =>
      searchBundle(
        bundle,
        query!.terms,
        query!.offset,
        query!.node,
        origin || undefined,
      ),
    enabled: !!owner && !!query,
    retry: false,
  })
  const sections = useQuery({
    queryKey: ['server', owner, bundle.bundle_id, 'sections', sectionOffset],
    queryFn: ({ signal }) => bundleSections(bundle, sectionOffset, signal),
    enabled: !!owner,
    retry: false,
  })
  const cached = baseline.data ?? bundle.baseline
  return (
    <div className="evidence-columns">
      <section
        className="panel bundle-search-panel"
        aria-label="보고서 통합 근거"
      >
        <div className="panel-heading">
          <h2>
            <FileSearch size={18} aria-hidden="true" />
            주석·공시 근거
          </h2>
          <StatusBadge>근거 탐색</StatusBadge>
        </div>
        <div className="bundle-panel-body">
          <p className="bundle-intro">
            주석과 공시에서 필요한 근거를 검색하고 원문을 대조하세요.
          </p>
          <details className="bundle-disclosure bundle-coverage">
            <summary>
              검색 범위와 자료 상태
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="bundle-disclosure-content">
              {bundle.coverage.map((c) => (
                <p key={`${c.region}:${c.scope}`}>
                  {regions[c.region]} ·{' '}
                  {c.scope === 'UNKNOWN' ? '회계 범위 미확인' : c.scope} · 내용
                  있는 구간 {c.nonempty}/{c.segments}
                </p>
              ))}
              {bundle.limitations.map((v) => (
                <p key={v}>{v}</p>
              ))}
            </div>
          </details>
          <div className="bundle-search-heading">
            <div>
              <h3>공통 확인 항목</h3>
              <p>항목별 후보를 찾고 근거를 확인합니다.</p>
            </div>
            <Button
              variant="outline"
              disabled={baseline.isPending}
              onClick={() => baseline.mutate()}
            >
              <Search size={15} aria-hidden="true" />
              {baseline.isPending ? '검색 중…' : '공통 6항목 검색'}
            </Button>
          </div>
          {baseline.isError && (
            <p role="alert">기본 검색을 완료하지 못했습니다.</p>
          )}
          {!cached && (
            <div className="bundle-search-empty">
              감사의견·차입 약정·신용등급·담보·소송·부외 항목을 한 번에 검색할
              수 있습니다.
            </div>
          )}
          <div className="bundle-categories">
            {cached?.items.map((item) => (
              <details className="bundle-disclosure" key={item.key}>
                <summary>
                  <span>
                    {item.title} · {item.total}개 후보 · 검수 전
                  </span>
                  <ChevronDown size={16} aria-hidden="true" />
                </summary>
                <div className="bundle-disclosure-content">
                  {item.unavailable_regions.length > 0 && (
                    <p>
                      미확보 영역:{' '}
                      {item.unavailable_regions
                        .map((r) => regions[r] ?? r)
                        .join(', ')}
                    </p>
                  )}
                  {!item.total && (
                    <p>
                      검색어에 맞는 후보가 없습니다. 공시상 없음 판정은
                      아닙니다.
                    </p>
                  )}
                  <CandidateList
                    candidates={item.candidates}
                    onSelect={setSelected}
                  />
                  {item.next_offset !== null && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        setQuery({
                          terms: item.terms,
                          offset: item.next_offset!,
                        })
                      }
                    >
                      추가 후보 조회
                    </Button>
                  )}
                </div>
              </details>
            ))}
          </div>
          <details className="bundle-disclosure bundle-toc">
            <summary>
              목차 펼치기
              <ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="bundle-disclosure-content">
              {sections.data?.sections.map((s) => (
                <p key={s.id}>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setInput(s.title)
                      setQuery({ terms: [s.title], offset: 0, node: s.id })
                    }}
                  >
                    {s.title}
                  </Button>{' '}
                  · {s.origin === 'html' ? 'HTML' : '덤프'}
                  {s.body_skipped ? ' · 본문 생략' : ''}
                </p>
              ))}
              {sections.isError && (
                <p role="alert">목차를 불러오지 못했습니다.</p>
              )}
              {sectionOffset > 0 && (
                <Button
                  onClick={() =>
                    setSectionOffset(Math.max(0, sectionOffset - 30))
                  }
                >
                  이전 목차
                </Button>
              )}
              {sections.data?.next_offset != null && (
                <Button
                  onClick={() => setSectionOffset(sections.data!.next_offset!)}
                >
                  다음 목차
                </Button>
              )}
            </div>
          </details>
          <form
            className="bundle-search-form"
            onSubmit={(event) => {
              event.preventDefault()
              const terms = input
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
              if (terms.length) setQuery({ terms, offset: 0 })
            }}
          >
            <label className="bundle-search-input">
              근거 검색{' '}
              <input
                value={input}
                maxLength={200}
                onChange={(e) => setInput(e.target.value)}
                placeholder="차입금, 담보"
              />
            </label>
            <label>
              검색 출처{' '}
              <select
                value={origin}
                onChange={(e) => {
                  setOrigin(e.target.value as '' | 'html' | 'dump')
                  setQuery((previous) =>
                    previous ? { terms: previous.terms, offset: 0 } : null,
                  )
                }}
              >
                <option value="">전체 자료</option>
                <option value="html">기존 구조화 HTML</option>
                <option value="dump">덤프 추출 자료</option>
              </select>
            </label>
            <Button disabled={!input.trim() || results.isFetching}>
              <Search size={16} aria-hidden="true" />
              검색
            </Button>
          </form>
          {results.isError && <p role="alert">근거 검색에 실패했습니다.</p>}
          {results.data && (
            <>
              <p>{results.data.total}개 후보</p>
              <CandidateList
                candidates={results.data.candidates}
                onSelect={setSelected}
              />
              {query && query.offset > 0 && (
                <Button
                  onClick={() =>
                    setQuery({
                      ...query,
                      offset: Math.max(0, query.offset - 10),
                    })
                  }
                >
                  이전 후보
                </Button>
              )}
              {results.data.next_offset !== null && (
                <Button
                  onClick={() =>
                    setQuery({ ...query!, offset: results.data!.next_offset! })
                  }
                >
                  다음 후보
                </Button>
              )}
            </>
          )}
          {selected && (
            <BundleContext
              key={`${owner}:${bundle.bundle_revision}:${selected.segment_id}`}
              bundle={bundle}
              candidate={selected}
              onClose={() => setSelected(null)}
            />
          )}
          <BundleAgent bundle={bundle} onSelect={setSelected} />
          <p className="bundle-footnote">
            검색 일치는 검수 전 후보이며, 위험 사건 발생을 의미하지 않습니다.
          </p>
        </div>
      </section>
      <aside
        className="bundle-review-column"
        aria-label="사실 검수와 규칙 입력"
      >
        <FactPanel bundle={bundle} />
        <LiveSignals bundle={bundle} />
      </aside>
    </div>
  )
}

function CandidateList({
  candidates,
  onSelect,
}: {
  candidates: BundleCandidate[]
  onSelect: (candidate: BundleCandidate) => void
}) {
  return (
    <ul className="bundle-candidate-list">
      {candidates.map((c) => (
        <li className="bundle-candidate" key={c.segment_id}>
          <Button variant="ghost" onClick={() => onSelect(c)}>
            {c.section_path.map((n) => n.title).join(' / ')} ·{' '}
            {c.kind === 'table' ? '표' : '본문'}
          </Button>
          <small>
            {c.origin === 'html' ? '구조화 HTML' : '덤프 추출 자료'} ·{' '}
            {regions[c.region]} · {c.scope}
          </small>
          <p>{c.excerpt.text}</p>
          {(c.body_skipped || c.content_available === false) && (
            <p>본문 미확보 · 제목만 확인된 후보입니다.</p>
          )}
        </li>
      ))}
    </ul>
  )
}

export function BundleContext({
  bundle,
  candidate,
  onClose,
}: {
  bundle: EvidenceBundle
  candidate: BundleCandidate
  onClose: () => void
}) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'start' })
    panel.current?.focus({ preventScroll: true })
  }, [])
  const session = useContext(SessionContext)
  const [row, setRow] = useState(0)
  const [text, setText] = useState(0)
  const [editing, setEditing] = useState(false)
  const owner = session?.session?.workspace_id
  const context = useQuery({
    queryKey: [
      'server',
      owner,
      bundle.bundle_id,
      candidate.segment_id,
      row,
      text,
    ],
    queryFn: ({ signal }) =>
      bundleContext(bundle, candidate, row, text, signal),
    retry: false,
  })
  const cells =
    context.data?.table?.cells ??
    context.data?.table?.rows?.map((r) => r.map((c) => c.text.text))
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="bundle-context"
      aria-label="선택 근거 문맥"
    >
      <div className="bundle-search-heading">
        <div>
          <h3>
            {candidate.origin === 'html'
              ? '구조화 HTML 문맥'
              : '덤프 추출 본문·표'}
          </h3>
          <p>선택한 근거의 본문과 표</p>
        </div>
        <Button variant="ghost" onClick={onClose}>
          근거 닫기
        </Button>
      </div>
      <Button variant="outline" onClick={() => setEditing((v) => !v)}>
        사실 후보 작성
      </Button>
      {editing && (
        <FactForm
          bundle={bundle}
          sourceId={candidate.segment_id}
          onClose={() => setEditing(false)}
        />
      )}
      {candidate.origin === 'html' && candidate.source_url && (
        <Link to={candidate.source_url}>기존 원문 강조 열기 →</Link>
      )}
      {context.isError ? (
        <StatePanel state="error" title="근거 문맥을 불러오지 못했습니다" />
      ) : context.isPending ? (
        <p>근거를 불러오는 중입니다.</p>
      ) : (
        <>
          {context.data.table?.caption && <p>{context.data.table.caption}</p>}
          {context.data.table?.unit && <p>{context.data.table.unit}</p>}
          {cells && (
            <div className="table-scroll">
              <table aria-label="저장된 근거 표">
                <tbody>
                  {cells.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {row > 0 && (
            <Button onClick={() => setRow(Math.max(0, row - 20))}>
              이전 표 행
            </Button>
          )}
          {context.data.table?.next_row_offset != null && (
            <Button
              onClick={() => setRow(context.data!.table!.next_row_offset!)}
            >
              다음 표 행
            </Button>
          )}
          {context.data.segments.map((s) => (
            <div key={s.segment_id}>
              <strong>{s.section_path.map((n) => n.title).join(' / ')}</strong>
              <p style={{ whiteSpace: 'pre-wrap' }}>{s.excerpt.text}</p>
            </div>
          ))}
          {text > 0 && (
            <Button onClick={() => setText(Math.max(0, text - 4000))}>
              이전 본문
            </Button>
          )}
          {context.data.next_text_offset !== null && (
            <Button onClick={() => setText(context.data!.next_text_offset!)}>
              다음 본문
            </Button>
          )}
        </>
      )}
    </section>
  )
}

function BundleAgent({
  bundle,
  onSelect,
}: {
  bundle: EvidenceBundle
  onSelect: (candidate: BundleCandidate) => void
}) {
  const session = useContext(SessionContext)
  const client = useQueryClient()
  const key = [
    'server',
    session?.session?.workspace_id,
    bundle.bundle_id,
    'agent',
  ]
  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      agentSchema.parse(
        await request(`/me/evidence-bundles/${bundle.bundle_id}/agent`),
      ),
    refetchInterval: (q) =>
      q.state.data?.run &&
      ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(q.state.data.run.status)
        ? 1000
        : false,
  })
  const start = useMutation({
    mutationFn: () =>
      request(`/me/evidence-bundles/${bundle.bundle_id}/agent`, {
        method: 'POST',
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const citation = useMutation({
    mutationFn: (segment: string) => getBundleCandidate(bundle, segment),
    onSuccess: onSelect,
  })
  return (
    <details className="bundle-disclosure bundle-agent">
      <summary>
        Codex 보완 탐색
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="bundle-disclosure-content">
        <Button
          disabled={
            !query.data?.available ||
            start.isPending ||
            ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(
              query.data?.run?.status ?? '',
            )
          }
          onClick={() => start.mutate()}
        >
          고정된 자료에서 보완 탐색
        </Button>
        {!query.data?.available && (
          <p>서버 인증·실행 제한 설정 후 사용할 수 있습니다.</p>
        )}
        {(query.isError || start.isError) && (
          <p role="alert">보완 탐색 요청을 처리하지 못했습니다.</p>
        )}
        {query.data?.run && (
          <p>작업 상태: {query.data.run.status} · 결과는 검수 전 후보입니다.</p>
        )}
        {query.data?.run?.result?.items.map((item) => (
          <div key={item.key}>
            <h3>
              {item.key} · {item.search_status}
            </h3>
            <p>{item.limitations}</p>
            {item.findings.map((f, i) => (
              <div key={i}>
                <p>{f.statement}</p>
                {f.citations.map((c, j) => (
                  <blockquote key={j}>
                    {c.quote}{' '}
                    <Button
                      variant="ghost"
                      disabled={citation.isPending}
                      onClick={() => citation.mutate(c.segment_id)}
                    >
                      인용 근거 열기
                    </Button>
                  </blockquote>
                ))}
              </div>
            ))}
          </div>
        ))}
        {query.data?.run?.result?.stop_reason && (
          <p>중단 사유: {query.data.run.result.stop_reason}</p>
        )}
        {citation.isError && (
          <p role="alert">인용 근거를 불러오지 못했습니다.</p>
        )}
      </div>
    </details>
  )
}
