import { FileText } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { CompanyReportSelect } from './company-report-select'
import { FinancialStart } from '../financial/financial-start'
import type { DartCompany } from './api'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'
import { StatusBadge } from '../../shared/components/status-badge'

export function CompanyCriteriaPanel({
  company,
  onClear,
}: {
  company: DartCompany | null
  onClear: () => void
}) {
  const [params, setParams] = useSearchParams()
  const url = params.toString()
  const [criteria, setCriteria] = useState({
    url,
    scope: params.get('scope') ?? 'OFS',
  })
  // Update controls immediately while the router commits the new URL asynchronously.
  // Navigation and search changes restore the criteria from the current URL.
  if (criteria.url !== url) {
    setCriteria({
      url,
      scope: params.get('scope') ?? 'OFS',
    })
  }
  const { scope } = criteria
  const invalidCriteria = !['OFS', 'CFS'].includes(scope)

  function changeCriteria(key: 'scope', value: string) {
    setCriteria((previous) => ({ ...previous, [key]: value }))
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set(key, value)
      return next
    })
  }

  const classification = !company
    ? '기업 선택 전'
    : company.ksic11_status === 'review_required'
      ? '재검토 필요'
      : company.ksic11_status === 'unmatched'
        ? '미분류'
        : company.industry
          ? '분류 확인'
          : '검토 업종 미확정'

  return (
    <section className="panel selection-panel" aria-label="분석 기준 선택">
      <div className="panel-heading">
        <h2>분석 기준 선택</h2>
        <FileText size={19} />
      </div>
      <div className={`selected-company ${company ? 'has-company' : ''}`}>
        <span className="field-label">선택한 기업</span>
        <strong>{company?.corp_name ?? '기업을 선택해 주세요'}</strong>
        {company ? (
          <>
            {company.corp_eng_name && <span>{company.corp_eng_name}</span>}
            <span>DART 고유번호: {company.corp_code}</span>
            <span>종목코드: {company.stock_code ?? '없음'}</span>
            <span>
              KSIC 11차:{' '}
              {company.ksic11_code
                ? `${company.ksic11_code} · ${company.ksic11_name}`
                : '미매칭'}
            </span>
            <span>DART 원본 업종코드: {company.induty_code ?? '미확보'}</span>
            <span>
              시장:{' '}
              {company.corp_cls
                ? { Y: '유가증권', K: '코스닥', N: '코넥스', E: '기타' }[
                    company.corp_cls
                  ]
                : '미확보'}
            </span>
            <span>
              결산월: {company.acc_mt ? `${company.acc_mt}월` : '미확보'}
            </span>
            <span>
              기업 목록 변경일:{' '}
              {company.modify_date.replace(
                /^(\d{4})(\d{2})(\d{2})$/,
                '$1.$2.$3',
              )}
            </span>
          </>
        ) : (
          <span>왼쪽 목록에서 기업을 선택하세요.</span>
        )}
      </div>
      {company && (
        <div className="selection-reset">
          <Button variant="ghost" onClick={onClear}>
            기업 선택 해제
          </Button>
        </div>
      )}
      <section className="classification-detail" aria-label="업종 판정 정보">
        <div>
          <strong>업종 판정</strong>
          <StatusBadge
            tone={classification === '분류 확인' ? 'neutral' : 'caution'}
          >
            {classification}
          </StatusBadge>
        </div>
        {!company ? (
          <p>기업을 선택하면 업종 분류와 확인 상태를 표시합니다.</p>
        ) : company.ksic11_status === 'review_required' ? (
          <p>기업정보 변경으로 기존 업종코드 재검토가 필요합니다.</p>
        ) : company.ksic11_status === 'unmatched' ? (
          <p>확인된 KSIC11 분류가 없어 업종을 판정할 수 없습니다.</p>
        ) : (
          <p>검토 업종: {company.industry ?? '미확정'}</p>
        )}
        {company && (
          <span>
            KSIC11 기준 분류이며 서비스 대상 여부의 최종 판정은 아닙니다.
          </span>
        )}
      </section>
      {invalidCriteria && (
        <StatePanel
          state="error"
          title="분석 기준을 확인해 주세요"
          description="선택 가능한 보고서 연도와 회계 범위를 다시 지정해 주세요."
          action={{
            label: '분석 기준 초기화',
            onClick: () => {
              setParams((previous) => {
                const next = new URLSearchParams(previous)
                next.delete('report')
                next.delete('scope')
                return next
              })
            },
          }}
        />
      )}
      <CompanyReportSelect corpCode={company?.corp_code ?? null} />
      <fieldset className="scope-field" disabled={!company}>
        <legend>회계 범위</legend>
        <div>
          {[
            ['OFS', '별도'],
            ['CFS', '연결'],
          ].map(([value, label]) => (
            <label key={value}>
              <input
                type="radio"
                name="live-accounting-scope"
                value={value}
                checked={scope === value}
                onChange={() => changeCriteria('scope', value)}
              />
              {label}
              <small>{value}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <FinancialStart
        key={`${company?.corp_code}:${params.get('report')}:${scope}`}
        corpCode={company?.corp_code ?? null}
      />
      <div className="criteria-extensions">
        <Button
          variant="outline"
          disabled
          aria-describedby="criteria-extension-status"
        >
          업종 수동 변경
        </Button>
        <Button
          variant="outline"
          disabled
          aria-describedby="criteria-extension-status"
        >
          공시 조회가 안 되나요? 직접 입력
        </Button>
        <p className="selection-note" id="criteria-extension-status">
          업종 변경 이력과 직접 입력 저장 기능은 준비 중입니다.
        </p>
      </div>
    </section>
  )
}
