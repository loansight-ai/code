import { useContext, useState } from 'react'
import { Link } from 'react-router'
import { z } from 'zod'
import { SessionContext } from '../session/session-context'
import { NoteSourceDrawer } from '../evidence/note-source-drawer'
import { Button } from '../../shared/components/button'
import { money, type FinancialNoteWorkflow, type FinancialResult } from './api'

const evidenceSchema = z.object({
  structure_id: z.string().uuid(),
  source_sha256: z.string(),
  citation: z.object({ segment_id: z.string().uuid(), quote: z.string() }),
  row_index: z.number().int().nonnegative(),
  amount_column: z.number().int().nonnegative(),
  account_name: z.string(),
  rationale: z.string(),
  status: z.string(),
})
const stages: Record<string, string> = {
  BASE_ANALYSIS: '기본 재무 분석 중',
  WAITING_STRUCTURE: '주석 구조화 중',
  ENRICHING: 'Codex 보완 탐색·검증 중',
  COMPLETED: 'Codex 보완 탐색 완료',
  PARTIAL: '주석 보완 일부 완료',
  FAILED: '주석 보완 실패',
}
const reasons: Record<string, string> = {
  note_agent_not_configured: '서버의 Codex 인증·실행 설정을 확인해야 합니다.',
  note_agent_timeout: 'Codex 탐색 시간이 초과되었습니다.',
  account_scope_requires_review: '계정명·포함 범위 확인 필요',
  amount_sign_requires_review: '금액 부호 확인 필요',
  unit_not_verified: '공시 단위 확인 필요',
  currency_not_verified: '통화 확인 필요',
  period_not_verified: '비교기간 확인 필요',
  period_column_not_verified: '기간·금액 열 대응 확인 필요',
  conflicting_amounts: '후보 금액 충돌 · 반영 보류',
  amount_cell_mismatch: '표의 금액과 불일치',
  account_cell_mismatch: '표의 계정명과 불일치',
  unread_citation: '조회하지 않은 구간 인용',
  citation_source_mismatch: '원문 인용 불일치',
  financial_agent_interrupted_no_auto_retry:
    '중단된 Codex 실행은 자동 재호출하지 않습니다. 다시 수집·분석으로 재시도할 수 있습니다.',
}

export function FinancialFactEvidence({
  sources,
}: {
  sources: Record<string, unknown>[]
}) {
  const session = useContext(SessionContext)
  const [selection, setSelection] = useState<z.infer<
    typeof evidenceSchema
  > | null>(null)
  const evidence = sources
    .map((s) => evidenceSchema.safeParse(s))
    .filter((s) => s.success)
    .map((s) => s.data)
  if (!evidence.length || !session?.session) return null
  return (
    <>
      {evidence.map((s, index) => (
        <span
          className="financial-note-evidence"
          key={`${s.citation.segment_id}:${index}`}
        >
          <Button variant="ghost" onClick={() => setSelection(s)}>
            주석 보완 · 근거 보기
          </Button>
          <span>
            {s.account_name} · {s.rationale}
          </span>
        </span>
      ))}
      {selection && (
        <NoteSourceDrawer
          id={selection.structure_id}
          workspaceId={session.session.workspace_id}
          hash={selection.source_sha256}
          segmentId={selection.citation.segment_id}
          onClose={() => setSelection(null)}
          focusCell={{
            row: selection.row_index,
            column: selection.amount_column,
          }}
        />
      )}
    </>
  )
}

export function FinancialNoteProgress({
  workflow,
  result,
}: {
  workflow: FinancialNoteWorkflow
  result: FinancialResult
}) {
  if (!workflow) return null
  const applied = new Set(
    workflow.candidates
      .filter((c) => c.status === 'APPLIED')
      .map((c) => `${c.key}:${c.period}`),
  ).size
  return (
    <section className="panel analysis-section" aria-label="주석 데이터 보완">
      <div className="panel-heading">
        <h2>주석 구조화·Codex 보완</h2>
        <span>{stages[workflow.stage]}</span>
      </div>
      {workflow.limitations && <p className="notice">{workflow.limitations}</p>}
      <p role="status">
        {['BASE_ANALYSIS', 'WAITING_STRUCTURE', 'ENRICHING'].includes(
          workflow.stage,
        )
          ? '기본 재무 결과를 먼저 표시합니다. 주석 보완은 화면을 닫아도 계속됩니다.'
          : `보완 반영 ${applied}건 · 검증된 후보만 재계산에 반영했습니다. 나머지 미확보 값은 기존 상태를 유지합니다.`}
      </p>
      {workflow.error_code && (
        <p className="notice">
          {reasons[workflow.error_code] ??
            `주석 보완을 완료하지 못했습니다. (${workflow.error_code})`}{' '}
          기본 재무 결과는 유지됩니다.
        </p>
      )}
      {workflow.structure_id && (
        <Link to={`/notes/${workflow.structure_id}`}>구조화된 주석 열기 →</Link>
      )}
      {!!workflow.candidates.length && (
        <div className="table-scroll">
          <table aria-label="주석 재무 보완 후보">
            <thead>
              <tr>
                <th>계정·기간</th>
                <th>금액 (억원)</th>
                <th>채택 상태</th>
                <th>구조화 주석 근거</th>
              </tr>
            </thead>
            <tbody>
              {workflow.candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    {result.facts.find((f) => f.key === c.key)?.label ?? c.key}{' '}
                    ·{' '}
                    {result.periods.find((p) => p.key === c.period)?.label ??
                      c.period}
                  </td>
                  <td>{c.value == null ? '반영 보류' : money(c.value)}</td>
                  <td>
                    {c.status === 'APPLIED'
                      ? '보완 반영 · 담당자 검수 전'
                      : '확인 필요 · 반영 보류'}
                    {c.reason && <p>{reasons[c.reason] ?? c.reason}</p>}
                  </td>
                  <td>
                    <p>{c.rationale}</p>
                    <blockquote>{c.citation.quote}</blockquote>
                    <small>
                      기간: {c.period_citation.quote} · 단위:{' '}
                      {c.unit_citation.quote}
                    </small>
                    {c.citations_valid && (
                      <FinancialFactEvidence sources={[c]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="panel-footnote">
        Codex 추출·원문 검증과 담당자 사실 검수는 별개입니다. 모호한 계정
        대응·기간·단위·충돌은 보류하며 미공시를 0으로 처리하지 않습니다.
      </p>
    </section>
  )
}
