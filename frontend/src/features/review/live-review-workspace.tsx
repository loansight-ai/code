import { useContext, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { getAgentRun, type AgentSaved } from '../evidence/agent-api'
import type { NoteStructure } from '../evidence/live-api'
import { NoteSourceDrawer } from '../evidence/note-source-drawer'
import { SessionContext } from '../session/session-context'
import { ApiError } from '../session/api'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'

const storedSchema = z.object({
  draft: z.string(),
  opinion: z.string(),
  viewed: z.array(z.string().uuid()),
  confirmed: z.array(z.string()),
})
type Stored = z.infer<typeof storedSchema>
export function LiveReviewWorkspace({
  metadata,
  workspaceId,
}: {
  metadata: NoteStructure
  workspaceId: string
}) {
  const session = useContext(SessionContext)
  const saved = useQuery({
    queryKey: [
      'server',
      workspaceId,
      'note-agent',
      metadata.structure_id,
      metadata.source_sha256,
    ],
    queryFn: ({ signal }) =>
      getAgentRun(metadata.structure_id, metadata.source_sha256, signal),
    retry: false,
  })
  useEffect(() => {
    if (saved.error instanceof ApiError && saved.error.status === 401)
      session?.expire()
  }, [saved.error, session])
  if (saved.isPending)
    return (
      <StatePanel
        state="loading"
        title="저장된 근거 후보를 확인하고 있습니다"
      />
    )
  if (saved.isError)
    return (
      <StatePanel
        state="error"
        title="근거 후보를 확인하지 못했습니다"
        action={{
          label: '다시 조회',
          onClick: () => {
            void saved.refetch()
          },
        }}
      />
    )
  if (!saved.data.run?.result)
    return (
      <StatePanel
        state="pending"
        title="아직 보완 탐색 결과가 없습니다"
        description="주석 근거에서 보완 탐색을 실행하면 인용을 연결해 검토할 수 있습니다."
      >
        <Link to={`/notes/${metadata.structure_id}/evidence?tab=summary`}>
          AI 보완 탐색으로 이동
        </Link>
      </StatePanel>
    )
  return (
    <ReviewEditor
      key={saved.data.run.run_id}
      metadata={metadata}
      workspaceId={workspaceId}
      saved={saved.data}
    />
  )
}

function ReviewEditor({
  metadata,
  workspaceId,
  saved,
}: {
  metadata: NoteStructure
  workspaceId: string
  saved: AgentSaved
}) {
  const run = saved.run!
  const candidates = run.result!.items.flatMap((item) =>
    item.findings.map((finding, index) => ({
      id: `${item.key}:${index}`,
      key: item.key,
      ...finding,
    })),
  )
  const template = [
    `기업 ${metadata.corp_code} / ${metadata.period} / ${metadata.scope} / 접수번호 ${metadata.receipt_no}`,
    '검수 전 사실 후보 · 재무 분석·위험규칙·모델 예측 미연동',
    ...candidates.map(
      (c) =>
        `${c.statement}\n${c.citations.map((x) => `원문 ${x.segment_id}: ${x.quote}`).join('\n')}`,
    ),
    '추가 확인: 미확보 보고서 영역과 내부 자료를 대조해야 합니다.',
  ].join('\n\n')
  const key = `loansight:live-review:v1:${workspaceId}:${metadata.structure_id}:${metadata.source_sha256}:${run.run_id}`
  const [loaded] = useState(() => {
    try {
      const raw = localStorage.getItem(key)
      const value = raw ? storedSchema.parse(JSON.parse(raw)) : null
      if (
        value &&
        (value.confirmed.some((id) => !candidates.some((c) => c.id === id)) ||
          value.viewed.some(
            (id) =>
              !candidates.some((c) =>
                c.citations.some((x) => x.segment_id === id),
              ),
          ) ||
          value.confirmed.some(
            (id) =>
              !candidates
                .find((c) => c.id === id)!
                .citations.every((x) => value.viewed.includes(x.segment_id)),
          ))
      )
        throw new Error('source mismatch')
      return { raw, value, error: '' }
    } catch {
      return {
        raw: null,
        value: null,
        error:
          '저장 기록을 읽지 못했습니다. 기존 기록은 보존하며 저장을 중지합니다.',
      }
    }
  })
  const [value, setValue] = useState<Stored>(
    loaded.value ?? { draft: template, opinion: '', viewed: [], confirmed: [] },
  )
  const [base, setBase] = useState(loaded.raw)
  const [message, setMessage] = useState(loaded.error)
  const [segment, setSegment] = useState<string | null>(null)
  const [onlyUnchecked, setOnlyUnchecked] = useState(false)
  const [dirty, setDirty] = useState(false)
  function update(next: Stored) {
    setValue(next)
    setDirty(true)
    setMessage('')
  }
  function save() {
    if (loaded.error) return
    try {
      if (localStorage.getItem(key) !== base) throw new Error('conflict')
      const raw = JSON.stringify(value)
      localStorage.setItem(key, raw)
      setBase(raw)
      setDirty(false)
      setMessage(
        '이 브라우저에 검토 기록을 저장했습니다. 서버 검수·승인 기록은 아닙니다.',
      )
    } catch {
      setMessage(
        '저장 공간 또는 다른 탭의 변경으로 저장하지 못했습니다. 편집을 보존했으므로 복사한 뒤 최신 기록을 확인해 주세요.',
      )
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `${value.draft}\n\n담당자 의견\n${value.opinion}\n\n확인 ${value.confirmed.length}/${candidates.length} · 검수 전 · 원문 ${metadata.source_sha256}`,
      )
      setMessage('현재 편집과 원문 기준을 복사했습니다.')
    } catch {
      setMessage('복사하지 못했습니다. 편집 내용을 직접 선택해 복사해 주세요.')
    }
  }
  return (
    <>
      <p className="notice">
        시스템이 제안한 검수 전 사실 후보입니다. 체크는 담당자의 후보 대조
        표시이며, 위험 없음이나 승인된 사실로 전환하지 않습니다. 저장은 현재
        브라우저에만 적용됩니다.
      </p>
      <div className="review-columns">
        <div>
          <section className="panel">
            <div className="panel-heading">
              <h2>확인 항목</h2>
              <span>
                미확인 {candidates.length - value.confirmed.length} · 완료{' '}
                {value.confirmed.length}
              </span>
            </div>
            <label className="review-filter">
              <input
                type="checkbox"
                checked={onlyUnchecked}
                onChange={(e) => setOnlyUnchecked(e.target.checked)}
              />
              미확인만 보기
            </label>
            {!candidates.length && (
              <StatePanel
                state="empty"
                title="대조할 사실 후보가 없습니다"
                description="검색 미완료·미검출은 해당 사항이 없다는 뜻이 아닙니다."
              />
            )}
            <ul className="review-candidate-list">
              {candidates
                .filter(
                  (c) => !onlyUnchecked || !value.confirmed.includes(c.id),
                )
                .map((c) => {
                  const viewed = c.citations.every((x) =>
                    value.viewed.includes(x.segment_id),
                  )
                  return (
                    <li key={c.id}>
                      <span className="classification-tag">
                        검수 전 · {c.key}
                      </span>
                      <p>{c.statement}</p>
                      {c.citations.map((citation, i) => (
                        <Button
                          variant="outline"
                          key={i}
                          onClick={() => setSegment(citation.segment_id)}
                        >
                          근거 원문 {i + 1}
                        </Button>
                      ))}
                      <label>
                        <input
                          type="checkbox"
                          aria-label={`${c.statement} · 담당자 확인`}
                          checked={value.confirmed.includes(c.id)}
                          disabled={!viewed || !!loaded.error}
                          onChange={(e) =>
                            update({
                              ...value,
                              confirmed: e.target.checked
                                ? [...value.confirmed, c.id]
                                : value.confirmed.filter((id) => id !== c.id),
                            })
                          }
                        />
                        담당자 확인
                      </label>
                      {!viewed && (
                        <small>
                          모든 인용 구간의 원문이 표시된 뒤 확인할 수 있습니다.
                        </small>
                      )}
                    </li>
                  )
                })}
            </ul>
          </section>
          <section className="panel analysis-section">
            <div className="panel-heading">
              <h2>부실징후 점검표</h2>
            </div>
            <StatePanel
              state="pending"
              title="23개 RISK 후보 원자료 대조 대기"
              description="자동 판정·원문 확인·외부 확인 목록은 서버 규칙과 원자료 연결 후 제공합니다. 검색 후보 수를 점검표 판정 건수로 사용하지 않습니다."
            />
          </section>
        </div>
        <section className="panel review-editor-panel">
          <div className="panel-heading">
            <h2>검토 기록 초안</h2>
            <span>{dirty ? '저장하지 않은 편집' : '검수 전 초안'}</span>
          </div>
          <div className="review-editor">
            <label className="form-field">
              근거 기반 초안
              <textarea
                aria-label="근거 기반 초안"
                rows={16}
                value={value.draft}
                onChange={(e) => update({ ...value, draft: e.target.value })}
              />
            </label>
            <label className="form-field">
              담당자 의견
              <textarea
                aria-label="담당자 의견"
                rows={5}
                value={value.opinion}
                onChange={(e) => update({ ...value, opinion: e.target.value })}
              />
            </label>
            <div className="button-row">
              <Button onClick={save} disabled={!!loaded.error}>
                브라우저에 저장
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  void copy()
                }}
              >
                복사
              </Button>
              <Button variant="outline" disabled>
                PDF · 후순위
              </Button>
            </div>
            <p role="status">{message}</p>
            <small>
              원문 {metadata.source_sha256.slice(0, 12)} · 탐색 {run.run_id} ·{' '}
              {run.result!.execution_status === 'COMPLETED'
                ? '탐색 완료'
                : '탐색 미완료'}{' '}
              · 검수 전
            </small>
          </div>
        </section>
      </div>
      <NoteSourceDrawer
        id={metadata.structure_id}
        workspaceId={workspaceId}
        hash={metadata.source_sha256}
        segmentId={segment}
        onClose={() => setSegment(null)}
        onViewed={(id) => {
          if (!value.viewed.includes(id))
            update({ ...value, viewed: [...value.viewed, id] })
        }}
      />
    </>
  )
}
