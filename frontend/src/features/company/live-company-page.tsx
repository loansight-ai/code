import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Building2, Search } from 'lucide-react'
import { searchCompanies, type DartCompany } from './api'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'
import { ApiError } from '../session/api'

export function LiveCompanyPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const rawOffset = Number(params.get('offset') ?? '0')
  const offset =
    Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const [input, setInput] = useState({ query, value: query })
  const [composing, setComposing] = useState(false)
  const [selected, setSelected] = useState<DartCompany | null>(null)
  if (input.query !== query) setInput({ query, value: query })
  useEffect(() => {
    if (composing || input.value === query) return
    const timeout = window.setTimeout(() => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (input.value) next.set('q', input.value)
          else next.delete('q')
          next.delete('offset')
          return next
        },
        { replace: true },
      )
    }, 300)
    return () => window.clearTimeout(timeout)
  }, [composing, input.value, query, setParams])
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ['dart', 'companies', query, offset],
    queryFn: ({ signal }) => searchCompanies(query, offset, signal),
    retry: false,
  })
  function page(nextOffset: number) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('offset', String(nextOffset))
      return next
    })
  }
  return (
    <main id="main" className="page">
      <div className="page-eyebrow">COMPANY EXPLORER</div>
      <h1>어떤 기업을 검토할까요?</h1>
      <p className="page-description">
        DART 공시 대상 기업을 기업명·종목코드·고유번호로 검색하세요.
      </p>
      <div className="notice">
        <span>
          DART 기업 목록은 매주 갱신하며, 업종코드는 KSIC 11차 기업정보 스냅샷을
          연결합니다. <a href="/?data=demo">예시 분석 둘러보기</a>
        </span>
      </div>
      <div className="search-layout">
        <section
          className="panel company-panel"
          aria-labelledby="company-heading"
        >
          <div className="panel-heading">
            <h2 id="company-heading">기업 검색</h2>
            <span>OpenDART</span>
          </div>
          <label className="search-field">
            <Search size={20} />
            <input
              aria-label="기업명 또는 종목코드"
              placeholder="기업명, 종목코드 또는 DART 고유번호"
              value={input.value}
              maxLength={200}
              onChange={(event) =>
                setInput({ query, value: event.target.value })
              }
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={(event) => {
                setInput({ query, value: event.currentTarget.value })
                setComposing(false)
              }}
            />
          </label>
          <div className="results-heading">
            <span>
              기업 목록{' '}
              <b>
                {isPending
                  ? '조회 중'
                  : isError
                    ? '조회 실패'
                    : `${data?.total.toLocaleString()}건`}
              </b>
            </span>
          </div>
          {isPending ? (
            <StatePanel
              state="loading"
              title="기업을 불러오는 중입니다."
              description="처음 조회할 때는 기업 목록 다운로드에 시간이 걸릴 수 있습니다."
            />
          ) : isError ? (
            <StatePanel
              state="error"
              title="기업 목록을 불러오지 못했습니다."
              description={
                error instanceof ApiError &&
                error.detail === 'dart_api_key_missing'
                  ? '기업 목록을 준비하려면 서버에 DART API 키를 설정해 주세요.'
                  : '기업 목록을 조회하지 못했습니다. 잠시 후 다시 시도해 주세요.'
              }
              action={{
                label: '다시 시도',
                onClick: () => {
                  void refetch()
                },
              }}
            />
          ) : data?.items.length === 0 ? (
            <StatePanel
              state="empty"
              title="검색 결과가 없습니다"
              description="기업명이나 코드를 확인해 주세요."
              action={{
                label: '검색 조건 초기화',
                onClick: () => {
                  setInput({ query: '', value: '' })
                  setComposing(false)
                  setParams({})
                },
              }}
            />
          ) : (
            <div className="company-list">
              {data?.items.map((company) => (
                <button
                  key={company.corp_code}
                  className={`company-row ${selected?.corp_code === company.corp_code ? 'selected' : ''}`}
                  aria-pressed={selected?.corp_code === company.corp_code}
                  onClick={() => setSelected(company)}
                >
                  <span className="company-avatar">
                    <Building2 size={23} />
                  </span>
                  <span className="company-info">
                    <strong>{company.corp_name}</strong>
                    <small>
                      DART {company.corp_code} ·{' '}
                      {company.stock_code
                        ? `종목 ${company.stock_code}`
                        : '종목코드 없음'}
                    </small>
                    <small>
                      {company.ksic11_code
                        ? `KSIC11 ${company.ksic11_code} · ${company.ksic11_name}`
                        : 'KSIC11 미매칭'}
                      {company.ksic11_status === 'review_required' &&
                        ' · 재검토 필요'}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {data && !isError && (
            <div className="panel-heading" aria-label="검색 결과 페이지">
              <Button
                variant="ghost"
                disabled={offset === 0}
                onClick={() => page(Math.max(0, offset - 30))}
              >
                이전
              </Button>
              <span>
                {data.total === 0 ? 0 : Math.min(offset + 1, data.total)}–
                {Math.min(offset + data.items.length, data.total)} /{' '}
                {data.total.toLocaleString()}
              </span>
              <Button
                variant="ghost"
                disabled={offset + data.items.length >= data.total}
                onClick={() => page(offset + 30)}
              >
                다음
              </Button>
            </div>
          )}
          <p className="panel-footnote">
            KSIC11 매칭이 없는 기업의 업종을 임의로 추정하지 않습니다.
          </p>
        </section>
        <section
          className="panel selection-panel"
          aria-label="선택한 기업 정보"
        >
          <div className="panel-heading">
            <h2>선택한 기업</h2>
          </div>
          {selected ? (
            <>
              <div className="selected-company has-company">
                <strong>{selected.corp_name}</strong>
                <span>{selected.corp_eng_name}</span>
                <span>DART 고유번호: {selected.corp_code}</span>
                <span>종목코드: {selected.stock_code ?? '없음'}</span>
                <span>
                  KSIC 11차:{' '}
                  {selected.ksic11_code
                    ? `${selected.ksic11_code} · ${selected.ksic11_name}`
                    : '미매칭'}
                </span>
                {selected.ksic11_status === 'review_required' && (
                  <span>
                    기업정보 변경으로 기존 업종코드 재검토가 필요합니다.
                  </span>
                )}
                <span>
                  DART 원본 업종코드: {selected.induty_code ?? '미확보'}
                </span>
                <span>
                  시장:{' '}
                  {selected.corp_cls
                    ? { Y: '유가증권', K: '코스닥', N: '코넥스', E: '기타' }[
                        selected.corp_cls
                      ]
                    : '미확보'}
                </span>
                <span>
                  결산월: {selected.acc_mt ? `${selected.acc_mt}월` : '미확보'}
                </span>
                <span>
                  기업 목록 변경일:{' '}
                  {selected.modify_date.replace(
                    /^(\d{4})(\d{2})(\d{2})$/,
                    '$1.$2.$3',
                  )}
                </span>
              </div>
              <p className="selection-note">
                기업정보는 제공된 스냅샷 기준입니다. KSIC11과 DART 원본
                업종코드는 서로 구분합니다. 서비스 대상 업종 판정·보고서
                선택·실제 분석은 후속 연결 후 제공됩니다.
              </p>
              <Button variant="ghost" onClick={() => setSelected(null)}>
                기업 선택 해제
              </Button>
            </>
          ) : (
            <p>왼쪽 목록에서 기업을 선택하세요.</p>
          )}
        </section>
      </div>
    </main>
  )
}
