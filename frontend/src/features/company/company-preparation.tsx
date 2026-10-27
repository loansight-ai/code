import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { Company } from './demo-data'
import { industries } from './demo-data'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import { StatusBadge } from '../../shared/components/status-badge'
import {
  appendPreparation,
  canonicalAmount,
  DraftConflictError,
  manualAccounts,
  manualSchema,
  overrideSchema,
  preparationKey,
  readPreparation,
  type ManualDraft,
  type OverrideDraft,
  type PreparationEntry,
  type NewPreparationEntry,
} from './preparation-model'

function load(key: string) {
  try {
    return { entries: readPreparation(key), error: '' }
  } catch {
    return {
      entries: [] as PreparationEntry[],
      error:
        '로컬 초안을 읽지 못했습니다. 저장 공간 설정 또는 기존 데이터 형식을 확인해 주세요. 기존 데이터는 덮어쓰지 않습니다.',
    }
  }
}

export function CompanyPreparation({
  company,
  report,
  scope,
}: {
  company: Company
  report: string
  scope: string
}) {
  const key = preparationKey(company.id, report, scope)
  const [journal, setJournal] = useState(() => load(key))
  const [editor, setEditor] = useState<'manual' | 'industry' | null>(null)
  const [baseId, setBaseId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const opener = useRef<HTMLButtonElement | null>(null)
  const latestFirst = [...journal.entries].reverse()
  const manualEntry = latestFirst.find((entry) => entry.kind === 'manual')
  const overrideEntry = latestFirst.find((entry) => entry.kind === 'industry')
  function openEditor(kind: 'manual' | 'industry', button: HTMLButtonElement) {
    const latest = load(key)
    setJournal(latest)
    if (latest.error) return
    opener.current = button
    setBaseId(latest.entries.at(-1)?.id ?? null)
    setMessage('')
    setEditor(kind)
  }
  function save(draft: NewPreparationEntry) {
    try {
      const entries = appendPreparation(key, baseId, draft)
      setJournal({ entries, error: '' })
      setMessage(
        '이 브라우저에 초안을 저장했습니다. 분석 결과에는 적용하지 않았습니다.',
      )
      setEditor(null)
      return ''
    } catch (error) {
      const latest = load(key)
      setJournal(latest)
      return error instanceof DraftConflictError
        ? '다른 화면에서 초안이 변경되었습니다. 입력 내용은 유지했습니다. 창을 닫고 최신 이력을 확인한 뒤 다시 열어 주세요.'
        : '초안을 저장하지 못했습니다. 입력 내용은 유지했습니다. 저장 공간과 기존 초안 형식을 확인해 주세요.'
    }
  }
  return (
    <section
      className="panel preparation-panel"
      aria-label="직접 입력·업종 변경 초안"
    >
      <div className="panel-heading">
        <h2>직접 입력·업종 변경</h2>
        <StatusBadge>브라우저 초안</StatusBadge>
      </div>
      <div className="preparation-content">
        <p className="muted">
          {company.name} · {report} 사업보고서 · {scope} · 서버 저장·권한
          확인·재분석 미연동
        </p>
        <p className="preparation-note">
          현재 분석 예시와 별도로 입력 내용을 기록합니다. 저장한 초안은 이
          브라우저에만 남으며 실제 분석 기준이나 원본 값을 바꾸지 않습니다.
        </p>
        <div className="button-row">
          <Button
            variant="outline"
            type="button"
            disabled={!!journal.error}
            onClick={(event) => openEditor('manual', event.currentTarget)}
          >
            직접 입력 초안
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={!!journal.error}
            onClick={(event) => openEditor('industry', event.currentTarget)}
          >
            업종 변경 초안
          </Button>
          <Button
            variant="ghost"
            type="button"
            onClick={() => setJournal(load(key))}
          >
            초안 이력 새로고침
          </Button>
        </div>
        {journal.error && (
          <p role="alert" className="form-error">
            {journal.error}
          </p>
        )}
        <p role="status" className="muted">
          {message}
        </p>
        {manualEntry?.kind === 'manual' && (
          <ManualComparison draft={manualEntry.value} />
        )}
        {overrideEntry?.kind === 'industry' && (
          <div className="draft-industry">
            <StatusBadge tone="caution">업종 변경 초안 · 미적용</StatusBadge>
            <p>
              {overrideEntry.value.previousIndustry ?? '업종 미확정'} →{' '}
              <strong>{overrideEntry.value.industry}</strong>
            </p>
            <p>사유: {overrideEntry.value.reason}</p>
            <p>근거: {overrideEntry.value.evidence}</p>
          </div>
        )}
        {!journal.error && (
          <details className="draft-history">
            <summary>로컬 초안 이력 ({journal.entries.length})</summary>
            {journal.entries.length === 0 ? (
              <p>저장된 초안이 없습니다.</p>
            ) : (
              <ol>
                {journal.entries.map((entry, index) => (
                  <li key={entry.id}>
                    <strong>
                      초안 #{index + 1} ·{' '}
                      {entry.kind === 'manual' ? '직접 입력' : '업종 변경'}
                    </strong>
                    <span>
                      {new Date(entry.savedAt).toLocaleString('ko-KR', {
                        timeZone: 'Asia/Seoul',
                      })}{' '}
                      (한국 시간) · {entry.actor}
                    </span>
                    {entry.kind === 'manual' ? (
                      <>
                        <p>
                          출처: {entry.value.source} · 기준일:{' '}
                          {entry.value.asOf} · 단위: 억원 (KRW)
                        </p>
                        <p>
                          {manualAccounts
                            .map(
                              ({ key: account, label }) =>
                                `${label}: ${entry.value[account] || '미입력'}`,
                            )
                            .join(' / ')}
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          {entry.value.previousIndustry ?? '업종 미확정'} →{' '}
                          {entry.value.industry}
                        </p>
                        <p>사유: {entry.value.reason}</p>
                        <p>근거: {entry.value.evidence}</p>
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </details>
        )}
      </div>
      {editor && (
        <Modal
          open
          title={editor === 'manual' ? '직접 입력 초안' : '업종 변경 초안'}
          description={`${company.name} · ${report} 사업보고서 · ${scope}. 취소하거나 닫으면 저장하지 않은 변경은 버려집니다.`}
          onOpenChange={(open) => {
            if (!open) setEditor(null)
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        >
          {editor === 'manual' ? (
            <ManualEditor
              initial={
                manualEntry?.kind === 'manual' ? manualEntry.value : undefined
              }
              onSave={(value) => save({ kind: 'manual', value })}
              onCancel={() => setEditor(null)}
            />
          ) : (
            <IndustryEditor
              currentIndustry={
                overrideEntry?.kind === 'industry'
                  ? overrideEntry.value.industry
                  : company.industry
              }
              onSave={(value) => save({ kind: 'industry', value })}
              onCancel={() => setEditor(null)}
            />
          )}
        </Modal>
      )}
    </section>
  )
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span id={id} className="form-error" role="alert">
      {message}
    </span>
  ) : null
}

function ManualEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: ManualDraft
  onSave: (value: ManualDraft) => string
  onCancel: () => void
}) {
  const form = useForm<ManualDraft>({
    resolver: zodResolver(manualSchema),
    defaultValues: initial
      ? { ...initial, disclosureUnavailable: false }
      : {
          disclosureUnavailable: false,
          source: '',
          asOf: '',
          revenue: '',
          operatingProfit: '',
          operatingCashflow: '',
        },
  })
  const [error, setError] = useState('')
  const errors = form.formState.errors
  return (
    <form
      className="preparation-form"
      noValidate
      onSubmit={form.handleSubmit((value) => setError(onSave(value)))}
    >
      <div className="notice">
        실제 공시 조회 가능성은 아직 확인하지 않았습니다. 아래 확인은 가상
        상황을 사용하는 데모 절차입니다.
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          {...form.register('disclosureUnavailable')}
          aria-invalid={!!errors.disclosureUnavailable}
          aria-describedby="manual-disclosure-error"
        />
        공시 조회 불가 상황을 가정한 예시 입력임을 확인합니다.
      </label>
      <FieldError
        id="manual-disclosure-error"
        message={errors.disclosureUnavailable?.message}
      />
      <p className="muted">
        입력 항목은 화면 검토용입니다. 최종 입력 규격과 적용 기준은 미정입니다.
        금액 단위는 억원 (KRW)이며 빈칸은 미입력으로 유지합니다.
      </p>
      <div className="preparation-fields">
        {manualAccounts.map(({ key, label }) => (
          <label className="form-field" key={key}>
            {label} (억원)
            <input
              type="text"
              inputMode="decimal"
              {...form.register(key)}
              aria-invalid={!!errors[key]}
              aria-describedby={`manual-${key}-error`}
              placeholder="미입력"
            />
            <FieldError
              id={`manual-${key}-error`}
              message={errors[key]?.message}
            />
          </label>
        ))}
      </div>
      <label className="form-field">
        출처 *
        <input
          {...form.register('source')}
          aria-invalid={!!errors.source}
          aria-describedby="manual-source-error"
          placeholder="예: 회사 제출 감사보고서 · 페이지"
        />
        <FieldError id="manual-source-error" message={errors.source?.message} />
      </label>
      <label className="form-field">
        재무 기준일 *
        <input
          type="date"
          {...form.register('asOf')}
          aria-invalid={!!errors.asOf}
          aria-describedby="manual-date-error"
        />
        <FieldError id="manual-date-error" message={errors.asOf?.message} />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button type="submit">브라우저에 초안 저장</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  )
}

function IndustryEditor({
  currentIndustry,
  onSave,
  onCancel,
}: {
  currentIndustry: Company['industry']
  onSave: (value: OverrideDraft) => string
  onCancel: () => void
}) {
  const form = useForm<OverrideDraft>({
    resolver: zodResolver(overrideSchema),
    defaultValues: {
      previousIndustry: currentIndustry,
      reason: '',
      evidence: '',
    },
  })
  const [error, setError] = useState('')
  const errors = form.formState.errors
  return (
    <form
      className="preparation-form"
      noValidate
      onSubmit={form.handleSubmit((value) => setError(onSave(value)))}
    >
      <div className="notice">
        업종 변경 초안만 기록합니다. 변경 권한·서버 이력·새 분석 생성은 연결되지
        않았습니다.
      </div>
      <p>
        변경 전 업종:{' '}
        <strong>
          {form.formState.defaultValues?.previousIndustry ?? '업종 미확정'}
        </strong>
      </p>
      <label className="form-field">
        변경할 업종 *
        <select
          defaultValue=""
          {...form.register('industry')}
          aria-invalid={!!errors.industry}
          aria-describedby="override-industry-error"
        >
          <option value="" disabled>
            업종 선택
          </option>
          {industries.map((industry) => (
            <option key={industry} value={industry}>
              {industry}
            </option>
          ))}
        </select>
        <FieldError
          id="override-industry-error"
          message={errors.industry?.message}
        />
      </label>
      <label className="form-field">
        변경 사유 *
        <textarea
          rows={2}
          {...form.register('reason')}
          aria-invalid={!!errors.reason}
          aria-describedby="override-reason-error"
          placeholder="적용 업종을 변경하려는 이유"
        />
        <FieldError
          id="override-reason-error"
          message={errors.reason?.message}
        />
      </label>
      <label className="form-field">
        변경 근거 *
        <textarea
          rows={2}
          {...form.register('evidence')}
          aria-invalid={!!errors.evidence}
          aria-describedby="override-evidence-error"
          placeholder="보고서·부문 매출 등 근거 위치"
        />
        <FieldError
          id="override-evidence-error"
          message={errors.evidence?.message}
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="button-row">
        <Button type="submit">브라우저에 초안 저장</Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
      </div>
    </form>
  )
}

function ManualComparison({ draft }: { draft: ManualDraft }) {
  return (
    <section
      className="manual-comparison"
      aria-label="예시 원본과 직접 입력 비교"
    >
      <h3>예시 원본과 직접 입력 비교</h3>
      <p className="muted">
        출처: {draft.source} · 기준일: {draft.asOf} · 직접 입력 단위: 억원 (KRW)
      </p>
      <p className="muted">
        원본 열은 모든 조건에서 사용하는 2025년 공통 레이아웃 예시입니다. 선택한
        보고서의 자동 수집 결과가 아닙니다.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>계정</th>
              <th>2025 예시 원본 (억원)</th>
              <th>직접 입력 초안 (억원)</th>
              <th>비교 상태</th>
            </tr>
          </thead>
          <tbody>
            {manualAccounts.map(({ key, label, fixture }) => {
              const amount = canonicalAmount(draft[key])
              const different =
                amount !== null && amount !== canonicalAmount(fixture)
              return (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{Number(fixture).toLocaleString('ko-KR')}</td>
                  <td>{draft[key] || '미입력'}</td>
                  <td>
                    <StatusBadge tone={different ? 'caution' : 'neutral'}>
                      {amount === null
                        ? '비교 보류'
                        : different
                          ? '값 다름 · 미적용'
                          : '예시와 동일 · 미적용'}
                    </StatusBadge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
