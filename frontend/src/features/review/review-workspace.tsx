import { useEffect, useRef, useState } from 'react'
import { Copy, RefreshCw, Save } from 'lucide-react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { StatusBadge } from '../../shared/components/status-badge'
import {
  contextLabel,
  demoVersions,
  type DemoContext,
} from '../analysis/demo-context'
import { SignalList } from '../risk/signal-list'
import { signals } from '../risk/demo-signals'
import { useReviewChecks } from './use-review-checks'
import {
  copyReview,
  initialDraft,
  paragraphIds,
  paragraphLabels,
  readDrafts,
  regenerateDemoDraft,
  ReviewConflictError,
  saveDraft,
  type DraftEntry,
  type ReviewDraft,
} from './review-store'

function load(context: DemoContext) {
  try {
    const history = readDrafts(context)
    const latest = history.at(-1)
    // Preserve pre-existing simple memos without rewriting or deleting their keys.
    const legacy =
      !latest && context.lease === 'include'
        ? (localStorage.getItem(
            `loansight.demo.memo.${context.companyId}.${context.report}.${context.scope}`,
          ) ?? '')
        : ''
    return {
      history,
      value: latest?.value ?? initialDraft(context, legacy),
      id: latest?.id ?? null,
      error: '',
    }
  } catch {
    return {
      history: [] as DraftEntry[],
      value: initialDraft(context),
      id: null,
      error:
        '저장된 검토 초안을 읽지 못했습니다. 기존 데이터는 보존하며 저장을 차단합니다.',
    }
  }
}

const actionLabels = {
  save: '직접 저장',
  'regenerate-keep': '수정 문단 유지 재적용',
  'regenerate-all': '전체 재적용',
  merge: '병합 저장',
}

export function ReviewWorkspace({ context }: { context: DemoContext }) {
  const [loaded] = useState(() => load(context))
  const [draft, setDraft] = useState(loaded.value)
  const [saved, setSaved] = useState(loaded.value)
  const [baseId, setBaseId] = useState<string | null>(loaded.id)
  const [history, setHistory] = useState(loaded.history)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(loaded.error)
  const [onlyUnchecked, setOnlyUnchecked] = useState(false)
  const [regenOpen, setRegenOpen] = useState(false)
  const [mode, setMode] = useState<'keep' | 'all'>('keep')
  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [remote, setRemote] = useState<DraftEntry | null>(null)
  const [choices, setChoices] = useState<Record<string, 'local' | 'remote'>>({})
  const editSequence = useRef(0)
  const requestSequence = useRef(0)
  const regenOpener = useRef<HTMLButtonElement | null>(null)
  const checks = useReviewChecks(context)
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  useEffect(
    () => () => {
      requestSequence.current += 1
    },
    [],
  )

  function edit(next: ReviewDraft) {
    editSequence.current += 1
    setDraft(next)
    setMessage('')
  }
  function persist(
    next: ReviewDraft,
    expectedId = baseId,
    action: DraftEntry['action'] = 'save',
  ) {
    if (loaded.error) return false
    try {
      const entry = saveDraft(context, expectedId, next, action)
      setDraft(next)
      setSaved(next)
      setBaseId(entry.id)
      setHistory(readDrafts(context))
      setError('')
      setConflict(false)
      setRemote(null)
      setMessage(
        '이 브라우저에 검토 초안을 저장했습니다. 서버 검토 기록은 미연동입니다.',
      )
      return true
    } catch (reason) {
      setError(
        reason instanceof ReviewConflictError
          ? '최신 저장본과 충돌했습니다. 현재 편집을 보존했습니다. 최신 저장본과 비교·병합해 주세요.'
          : '저장하지 못했습니다. 편집 내용을 유지했습니다. 저장 공간과 기존 데이터 형식을 확인해 주세요.',
      )
      setConflict(reason instanceof ReviewConflictError)
      setRemote(null)
      return false
    }
  }
  async function regenerate() {
    setRegenOpen(false)
    setBusy(true)
    setError('')
    setMessage('')
    const sequence = editSequence.current
    const request = ++requestSequence.current
    const basis = baseId
    try {
      const next = await regenerateDemoDraft(context, draft, mode)
      if (request !== requestSequence.current) return
      if (sequence !== editSequence.current) {
        setError(
          '템플릿 재적용 중 새 편집이 생겼습니다. 결과를 적용하지 않고 최신 편집을 유지했습니다.',
        )
        return
      }
      persist(
        next,
        basis,
        mode === 'keep' ? 'regenerate-keep' : 'regenerate-all',
      )
    } catch {
      if (request === requestSequence.current)
        setError(
          '예시 템플릿을 재적용하지 못했습니다. 현재 편집을 유지했습니다.',
        )
    } finally {
      if (request === requestSequence.current) setBusy(false)
    }
  }
  function compareLatest() {
    try {
      const latest = readDrafts(context).at(-1)
      if (!latest) {
        setError(
          '최신 저장본이 없습니다. 현재 편집을 복사해 보존한 뒤 화면을 다시 열어 주세요.',
        )
        return
      }
      setRemote(latest)
      setChoices({})
    } catch {
      setError('최신 저장본을 읽지 못했습니다. 현재 편집은 유지됩니다.')
    }
  }
  function merge() {
    if (!remote) return
    const next: ReviewDraft = {
      ...remote.value,
      opinion:
        choices.opinion === 'remote' ? remote.value.opinion : draft.opinion,
      paragraphs: remote.value.paragraphs.map((paragraph) => {
        const local = draft.paragraphs.find((item) => item.id === paragraph.id)!
        const text =
          choices[paragraph.id] === 'remote' ? paragraph.text : local.text
        return { ...paragraph, text, edited: text !== paragraph.generatedText }
      }),
    }
    persist(next, remote.id, 'merge')
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        copyReview(context, draft, checks.error ? null : checks.value),
      )
      setMessage('예시 표시·기준·원문 위치와 현재 편집을 포함해 복사했습니다.')
    } catch {
      setError('복사하지 못했습니다. 입력 내용을 직접 선택해 복사해 주세요.')
    }
  }
  return (
    <div className="demo-review-workspace">
      <div className="notice">
        아래 확인 항목 3개와 검토 초안은 가상 예시입니다. 23개 RISK 후보 원자료,
        실제 AI 생성·서버 검토 저장·재생성 작업은 미연동입니다.
      </div>
      <section className="panel analysis-section" aria-label="담당자 확인 항목">
        <div className="panel-heading">
          <h2>담당자 확인 · 예시 3항목</h2>
          <span className="muted">
            {checks.error
              ? '확인 기록 조회 실패'
              : `미확인 ${signals.length - checks.value.confirmed.length} · 확인 완료 ${checks.value.confirmed.length}`}
          </span>
        </div>
        <div className="analysis-toolbar">
          <label className="option-check">
            <input
              type="checkbox"
              checked={onlyUnchecked}
              onChange={(event) => setOnlyUnchecked(event.target.checked)}
            />
            미확인만 보기
          </label>
          <StatusBadge>시스템 제안 ≠ 담당자 확인 ≠ 위험 없음</StatusBadge>
        </div>
        <SignalList
          items={signals.filter(
            (signal) =>
              !onlyUnchecked || !checks.value.confirmed.includes(signal.id),
          )}
          checks={checks}
        />
      </section>
      <div className="review-layout">
        <section className="panel" aria-label="검토 기록 초안">
          <div className="panel-heading">
            <h2>검토 기록 초안</h2>
            <StatusBadge tone={dirty ? 'caution' : 'neutral'}>
              {dirty ? '저장하지 않은 편집' : '예시 템플릿'} · 재적용 #
              {draft.generation}
            </StatusBadge>
          </div>
          <div className="review-editor">
            <p className="muted">
              {contextLabel(context)}
              <br />
              산식 {demoVersions.financial} · 규칙 {demoVersions.rule} · 모델
              미연동
              <br />
              담당자 의견과 수정 문단을 구분해 저장합니다. 페이지를 벗어나기 전
              저장해 주세요.
            </p>
            {draft.paragraphs.map((paragraph) => (
              <div key={paragraph.id} className="review-paragraph">
                <div className="form-field">
                  <label htmlFor={`review-paragraph-${paragraph.id}`}>
                    {paragraphLabels[paragraph.id]}
                  </label>
                  <textarea
                    id={`review-paragraph-${paragraph.id}`}
                    rows={4}
                    value={paragraph.text}
                    onChange={(event) =>
                      edit({
                        ...draft,
                        paragraphs: draft.paragraphs.map((item) =>
                          item.id === paragraph.id
                            ? {
                                ...item,
                                text: event.target.value,
                                edited:
                                  event.target.value !== item.generatedText,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
                <span className="muted">
                  {paragraph.edited ? '사용자 수정 문단' : '예시 생성 원본'} ·{' '}
                  {demoVersions.source}
                </span>
              </div>
            ))}
            <div className="form-field">
              <label htmlFor="review-opinion">검토 메모</label>
              <textarea
                id="review-opinion"
                rows={5}
                value={draft.opinion}
                onChange={(event) =>
                  edit({ ...draft, opinion: event.target.value })
                }
                placeholder="담당자 의견과 내부 자료 확인 사항을 작성하세요."
              />
            </div>
            <div className="button-row">
              <Button
                disabled={!!loaded.error || busy}
                onClick={() => persist(draft)}
              >
                <Save size={16} />
                브라우저에 저장
              </Button>
              <Button
                variant="outline"
                disabled={!!loaded.error || busy}
                onClick={(event) => {
                  regenOpener.current = event.currentTarget
                  setMode('keep')
                  setRegenOpen(true)
                }}
              >
                <RefreshCw size={16} />
                초안 재생성 미리보기
              </Button>
              <Button variant="outline" onClick={copy}>
                <Copy size={16} />
                복사
              </Button>
              <Button variant="outline" disabled>
                PDF · 후순위
              </Button>
            </div>
            {busy && (
              <p role="status">
                예시 템플릿을 재적용하고 있습니다. AI 호출이 아닙니다.
              </p>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            {conflict && (
              <Button variant="outline" onClick={compareLatest}>
                최신 저장본 비교·병합
              </Button>
            )}
            <p role="status" className="muted">
              {message}
            </p>
          </div>
        </section>
        <aside>
          <section className="panel evidence-body">
            <h2>23개 RISK 후보 점검표</h2>
            <p>
              원자료와 승인 기준이 확정되지 않았습니다. 예시 확인 3항목을 전체
              점검표로 간주하지 않습니다.
            </p>
            <StatusBadge>원자료 연결 대기</StatusBadge>
            <hr />
            <h3>기반 revision</h3>
            <p className="muted">
              {baseId ?? '아직 저장하지 않음'}
              <br />
              근거 {demoVersions.evidence}
            </p>
          </section>
          {!loaded.error && (
            <section className="panel evidence-body analysis-section">
              <h2>검토 초안 이력</h2>
              <p className="muted">
                저장된 버전 {history.length}개 · 이전 내용은 보존합니다.
              </p>
              {history.map((entry, index) => (
                <details key={entry.id} className="revision-entry">
                  <summary>
                    버전 {index + 1} · {actionLabels[entry.action]}
                  </summary>
                  <p className="muted">
                    {new Date(entry.savedAt).toLocaleString('ko-KR', {
                      timeZone: 'Asia/Seoul',
                    })}{' '}
                    · 한국 시간
                    <br />
                    부모: {entry.parentId ?? '없음'}
                  </p>
                  {entry.value.paragraphs.map((paragraph) => (
                    <p key={paragraph.id}>
                      <strong>{paragraphLabels[paragraph.id]}</strong>
                      <br />
                      {paragraph.text}
                    </p>
                  ))}
                  <p>
                    <strong>담당자 의견</strong>
                    <br />
                    {entry.value.opinion || '미작성'}
                  </p>
                </details>
              ))}
            </section>
          )}
        </aside>
      </div>
      {regenOpen && (
        <Modal
          open
          title="초안 재생성 미리보기"
          description="AI 호출 없이 고정된 예시 템플릿을 재적용합니다. 담당자 의견과 이전 이력은 두 모드 모두 보존합니다."
          onOpenChange={setRegenOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            regenOpener.current?.focus()
          }}
        >
          <fieldset className="regeneration-options">
            <legend>문단 처리 방식</legend>
            <label>
              <input
                type="radio"
                name="regeneration-mode"
                checked={mode === 'keep'}
                onChange={() => setMode('keep')}
              />
              수정한 문단 유지
            </label>
            <label>
              <input
                type="radio"
                name="regeneration-mode"
                checked={mode === 'all'}
                onChange={() => setMode('all')}
              />
              자동 초안 영역 전체 재생성
            </label>
          </fieldset>
          <p className="notice">
            전체 재생성은 현재 자동 초안 영역의 미저장 편집도 교체합니다. 담당자
            의견은 유지됩니다.
          </p>
          <Button onClick={regenerate}>예시 템플릿 재적용</Button>
        </Modal>
      )}
      {remote && (
        <Modal
          open
          title="최신 저장본과 병합"
          description="각 영역에 사용할 내용을 선택합니다. 현재 편집 유지가 기본이며, 선택 결과를 최신 저장본 다음 revision으로 저장합니다."
          onOpenChange={(open) => {
            if (!open) setRemote(null)
          }}
        >
          <div className="merge-fields">
            {[...paragraphIds, 'opinion' as const].map((id) => {
              const local =
                id === 'opinion'
                  ? draft.opinion
                  : draft.paragraphs.find((paragraph) => paragraph.id === id)!
                      .text
              const latest =
                id === 'opinion'
                  ? remote.value.opinion
                  : remote.value.paragraphs.find(
                      (paragraph) => paragraph.id === id,
                    )!.text
              return (
                <fieldset key={id}>
                  <legend>
                    {id === 'opinion' ? '담당자 의견' : paragraphLabels[id]}
                  </legend>
                  <label>
                    <input
                      type="radio"
                      name={`merge-${id}`}
                      checked={choices[id] !== 'remote'}
                      onChange={() => setChoices({ ...choices, [id]: 'local' })}
                    />
                    현재 편집 유지
                  </label>
                  <p>{local || '미작성'}</p>
                  <label>
                    <input
                      type="radio"
                      name={`merge-${id}`}
                      checked={choices[id] === 'remote'}
                      onChange={() =>
                        setChoices({ ...choices, [id]: 'remote' })
                      }
                    />
                    최신 저장본 사용
                  </label>
                  <p>{latest || '미작성'}</p>
                </fieldset>
              )
            })}
          </div>
          <Button onClick={merge}>선택한 내용으로 병합·저장</Button>
        </Modal>
      )}
    </div>
  )
}
