import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { DemoContext } from '../analysis/demo-context'
import { demoVersions } from '../analysis/demo-context'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'
import { StatusBadge } from '../../shared/components/status-badge'
import { noteCategories } from '../evidence/demo-evidence'
import { SourceViewer } from '../evidence/source-viewer'
import { useReviewChecks } from '../review/use-review-checks'
import { axes, severityTone, signals } from './demo-signals'
import { SignalList } from './signal-list'

export function RiskEvidenceView({ context }: { context: DemoContext }) {
  const [params, setParams] = useSearchParams()
  const tab = ['signals', 'notes', 'summary'].includes(params.get('tab') ?? '')
    ? params.get('tab')!
    : 'signals'
  const severity = params.get('severity') ?? '전체'
  const axis = params.get('axis') ?? '전체'
  const checks = useReviewChecks(context)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  function filter(key: string, value: string) {
    setParams(
      (previous) => {
        previous.set(key, value)
        return previous
      },
      { replace: true },
    )
  }
  return (
    <>
      <div className="notice">
        경고·주의·관찰은 화면 확인용 고정 예시입니다. 실제 규칙 평가나 승인
        기준이 아닙니다. 조건 존재와 사건 발생, 원문 열람과 담당자 확인을
        구분합니다.
      </div>
      <div
        className="filter-buttons section-tabs"
        aria-label="주석·위험징후 화면"
      >
        {[
          ['signals', '위험징후'],
          ['notes', '주석 추출 근거'],
          ['summary', 'AI 요약'],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => filter('tab', value)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'signals' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>현재 위험징후 · 예시</h2>
            <span className="muted">
              {demoVersions.rule} · 운영 임계값 미정
            </span>
          </div>
          <div className="signal-summary">
            {(['경고', '주의', '관찰'] as const).map((level) => (
              <button
                key={level}
                aria-pressed={severity === level}
                onClick={() =>
                  filter('severity', severity === level ? '전체' : level)
                }
              >
                <StatusBadge tone={severityTone(level)}>{level}</StatusBadge>
                <strong>
                  {signals.filter((signal) => signal.severity === level).length}
                  건
                </strong>
                <span>고정 예시</span>
              </button>
            ))}
          </div>
          <div className="analysis-toolbar">
            <label className="form-field">
              징후 단계
              <select
                value={severity}
                onChange={(event) => filter('severity', event.target.value)}
              >
                {['전체', '경고', '주의', '관찰'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              판단 축
              <select
                value={axis}
                onChange={(event) => filter('axis', event.target.value)}
              >
                {['전체', ...axes].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <Button
              variant="ghost"
              onClick={() =>
                setParams(
                  (previous) => {
                    previous.delete('severity')
                    previous.delete('axis')
                    return previous
                  },
                  { replace: true },
                )
              }
            >
              징후 필터 초기화
            </Button>
          </div>
          <SignalList
            items={signals.filter(
              (signal) =>
                (severity === '전체' || signal.severity === severity) &&
                (axis === '전체' || signal.axis === axis),
            )}
            checks={checks}
          />
          <p className="panel-footnote">
            업종 핵심 지표·5개년 추세·만기 사다리는 검증된 원천과 구간별 금액
            역할 확보 후 표시합니다. 현재 자료 없음이며 0으로 계산하지 않습니다.
          </p>
        </section>
      )}
      {tab === 'notes' && (
        <section className="panel">
          <div className="panel-heading">
            <h2>공통 주석 6항목</h2>
            <StatusBadge>검출·검수 상태 분리</StatusBadge>
          </div>
          <div className="note-grid">
            {noteCategories.map((note) => (
              <article className="note-card" key={note.name}>
                <h3>{note.name}</h3>
                <div className="note-status">
                  <StatusBadge
                    tone={
                      note.detection === '추출 실패' ? 'warning' : 'neutral'
                    }
                  >
                    {note.detection} · 예시
                  </StatusBadge>
                  <StatusBadge>실제 검수 미연동</StatusBadge>
                </div>
                <p>{note.reason}</p>
                {note.sourceId ? (
                  <Button
                    variant="outline"
                    onClick={(event) => {
                      opener.current = event.currentTarget
                      setSourceId(note.sourceId)
                    }}
                  >
                    {note.name} 근거 원문
                  </Button>
                ) : (
                  <p className="muted">연결된 원문 구간 미확보</p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === 'summary' && (
        <section className="panel">
          <StatePanel
            state="pending"
            title="AI 요약은 연결 대기 중입니다"
            description="검증된 근거와 LLM 응답이 연결되면 재무·주석·위험징후·추가 확인을 구분해 제공합니다. 미검출·추출 실패 자료를 요약 사실로 만들지 않습니다."
          />
        </section>
      )}
      {sourceId && (
        <SourceViewer
          sourceId={sourceId}
          onSourceChange={setSourceId}
          onClose={() => setSourceId(null)}
          onViewed={checks.recordSource}
          returnFocus={() => opener.current?.focus()}
        />
      )}
    </>
  )
}
