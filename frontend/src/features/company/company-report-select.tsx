import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { getCompanyReports } from './api'
import { ApiError } from '../session/api'
import { StatePanel } from '../../shared/components/state-panel'

export function CompanyReportSelect({ corpCode }: { corpCode: string | null }) {
  const [params, setParams] = useSearchParams()
  const urlReport = params.get('report') ?? ''
  const identity = `${corpCode}:${urlReport}`
  const [selection, setSelection] = useState({ identity, value: urlReport })
  if (selection.identity !== identity)
    setSelection({ identity, value: urlReport })
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dart', 'annual-reports', corpCode],
    queryFn: ({ signal }) => getCompanyReports(corpCode!, signal),
    enabled: corpCode !== null,
    staleTime: 60_000,
    retry: false,
  })
  const available = data?.items.filter((report) => !report.withdrawn) ?? []
  // Old year-only links resolve to the latest filing for that fiscal year.
  const chosen = selection.value
    ? (available.find((report) => report.receipt_no === selection.value) ??
      available.find((report) => report.fiscal_year === selection.value))
    : available[0]
  const invalid = !isPending && !isError && available.length > 0 && !chosen
  const periods = available.map((report) => report.period).sort()
  const years = [...new Set(available.map((report) => report.fiscal_year))]
  const placeholder = !corpCode
    ? '기업을 먼저 선택하세요'
    : isPending
      ? '사업보고서 조회 중…'
      : isError
        ? '사업보고서 조회 실패'
        : available.length === 0
          ? '선택 가능한 사업보고서 없음'
          : '보고서를 선택하세요'

  return (
    <>
      <label className="form-field">
        보고서
        <select
          value={isError ? '' : (chosen?.receipt_no ?? '')}
          disabled={!corpCode || isPending || isError || available.length === 0}
          aria-describedby="company-report-range"
          onChange={(event) => {
            const value = event.target.value
            setSelection({ identity, value })
            setParams((previous) => {
              const next = new URLSearchParams(previous)
              next.set('report', value)
              return next
            })
          }}
        >
          {(!chosen || isError) && <option value="">{placeholder}</option>}
          {!isError &&
            data?.items.map((report) => (
              <option
                key={report.receipt_no}
                value={report.receipt_no}
                disabled={report.withdrawn}
              >
                {report.report_name}
                {report.withdrawn ? ' · 철회' : ''}
              </option>
            ))}
        </select>
      </label>
      <div
        className="selection-note"
        id="company-report-range"
        aria-live="polite"
      >
        {corpCode && !isPending && !isError && available.length > 0 && (
          <>
            <p>
              확인된 사업보고서: {periods[0]}–{periods[periods.length - 1]} 결산
              · {years.length}개 사업연도
            </p>
            <p>가장 오래된 보고서: {periods[0]} 결산</p>
            <p>
              조회일:{' '}
              {data &&
                new Date(data.checked_at).toLocaleString('ko-KR', {
                  timeZone: 'Asia/Seoul',
                })}{' '}
              · 연도 사이에 보고서가 없는 기간이 있을 수 있습니다.
            </p>
          </>
        )}
        {corpCode && !isPending && !isError && available.length === 0 && (
          <p>
            이 기업의 선택 가능한 사업보고서가 DART 조회 범위에서 확인되지
            않았습니다.
          </p>
        )}
      </div>
      {corpCode && isError && (
        <StatePanel
          state="error"
          title="사업보고서를 불러오지 못했습니다"
          description={
            error instanceof ApiError && error.detail === 'dart_api_key_missing'
              ? '사업보고서 목록을 조회하려면 서버에 DART API 키를 설정해 주세요.'
              : '목록을 조회하지 못했습니다. 보고서가 없는 상태와는 다릅니다. 잠시 후 다시 시도해 주세요.'
          }
          action={{
            label: '사업보고서 다시 조회',
            onClick: () => {
              void refetch()
            },
          }}
        />
      )}
      {invalid && (
        <StatePanel
          state="error"
          title="선택한 보고서를 확인해 주세요"
          description="선택한 보고서가 이 기업의 현재 목록에 없습니다."
          action={{
            label: '최신 보고서 선택',
            onClick: () => {
              setParams((previous) => {
                const next = new URLSearchParams(previous)
                next.delete('report')
                return next
              })
            },
          }}
        />
      )}
      {chosen && !isError && (
        <p className="selection-note">
          제출일 {chosen.receipt_date} · 접수번호 {chosen.receipt_no}{' '}
          <a
            href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${chosen.receipt_no}`}
            target="_blank"
            rel="noreferrer"
          >
            DART 원문 보기
          </a>
        </p>
      )}
    </>
  )
}
