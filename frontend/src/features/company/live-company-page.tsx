import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { Search } from 'lucide-react'
import { COMPANY_PAGE_SIZE, searchCompanies, type DartCompany } from './api'
import { Button } from '../../shared/components/button'
import { StatePanel } from '../../shared/components/state-panel'
import { ApiError } from '../session/api'
import { industries } from './industries'
import { CompanyCriteriaPanel } from './company-criteria-panel'

export function LiveCompanyPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const industry = industries.find((item) => item === params.get('industry'))
  const rawOffset = Number(params.get('offset') ?? '0')
  const offset =
    Number.isSafeInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0
  const [input, setInput] = useState({ query, value: query })
  const [composing, setComposing] = useState(false)
  const [selection, setSelected] = useState<DartCompany | null>(null)
  const marketValue = params.get('market')
  const market = ['Y', 'K', 'N', 'E'].includes(marketValue ?? '')
    ? (marketValue as 'Y' | 'K' | 'N' | 'E')
    : undefined
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
    queryKey: ['dart', 'companies', query, offset, industry, market],
    queryFn: ({ signal }) =>
      searchCompanies(query, offset, signal, industry, market),
    retry: false,
  })
  const restored = useQuery({
    queryKey: ['dart', 'workspace-company', params.get('corp')],
    queryFn: ({ signal }) => searchCompanies(params.get('corp')!, 0, signal),
    enabled: !!params.get('corp') && !selection,
    staleTime: 60_000,
    retry: false,
  })
  const selected =
    selection ??
    restored.data?.items.find(
      (item) => item.corp_code === params.get('corp'),
    ) ??
    null
  function page(nextOffset: number) {
    setParams((previous) => {
      const next = new URLSearchParams(previous)
      next.set('offset', String(nextOffset))
      return next
    })
  }
  return (
    <main id="main" className="page">
      <h1>기업 검색</h1>
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
          <div className="company-search-toolbar">
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
            <label className="market-select">
              시장
              <select
                aria-label="시장"
                value={market ?? ''}
                onChange={(event) => {
                  setParams((previous) => {
                    const next = new URLSearchParams(previous)
                    if (event.target.value)
                      next.set('market', event.target.value)
                    else next.delete('market')
                    next.delete('offset')
                    return next
                  })
                }}
              >
                <option value="">전체</option>
                <option value="Y">유가증권</option>
                <option value="K">코스닥</option>
                <option value="N">코넥스</option>
                <option value="E">기타</option>
              </select>
            </label>
          </div>
          <div className="industry-filters" aria-label="업종 필터">
            {['전체', ...industries].map((item) => (
              <button
                key={item}
                aria-pressed={(industry ?? '전체') === item}
                onClick={() => {
                  setSelected(null)
                  setParams((previous) => {
                    const next = new URLSearchParams(previous)
                    if (item === '전체') next.delete('industry')
                    else next.set('industry', item)
                    next.delete('offset')
                    next.delete('corp')
                    return next
                  })
                }}
              >
                {item}
              </button>
            ))}
          </div>
          <p className="search-scope-note">
            대상 업종: 제조·건설·도소매·부동산 임대.
            렌탈·운수창고·금융보험·지주·스팩·부동산 관리중개는 대상 범위에서
            제외합니다. 업종 분류만으로 최종 대상 여부를 확정하지 않습니다.
          </p>
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
              description="기업명·코드나 업종 조건을 확인해 주세요."
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
            <div className="table-scroll company-list">
              <table
                className="company-results-table"
                aria-label="기업 검색 결과"
              >
                <thead>
                  <tr>
                    <th>회사명</th>
                    <th>종목코드</th>
                    <th>시장</th>
                    <th>업종·코드</th>
                    <th>세부분류</th>
                    <th>결산</th>
                    <th>확인 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((company) => (
                    <tr
                      key={company.corp_code}
                      className={
                        selected?.corp_code === company.corp_code
                          ? 'selected'
                          : ''
                      }
                    >
                      <td>
                        <button
                          className="company-name-button"
                          aria-pressed={
                            selected?.corp_code === company.corp_code
                          }
                          onClick={() => {
                            setSelected(company)
                            setParams(
                              (previous) => {
                                const next = new URLSearchParams(previous)
                                next.set('corp', company.corp_code)
                                if (
                                  (selected &&
                                    selected.corp_code !== company.corp_code) ||
                                  (previous.get('corp') &&
                                    previous.get('corp') !== company.corp_code)
                                )
                                  next.delete('report')
                                return next
                              },
                              { replace: true },
                            )
                          }}
                        >
                          <strong>{company.corp_name}</strong>
                          <small>DART {company.corp_code}</small>
                        </button>
                      </td>
                      <td>{company.stock_code ?? '—'}</td>
                      <td>
                        {company.corp_cls
                          ? {
                              Y: '유가증권',
                              K: '코스닥',
                              N: '코넥스',
                              E: '기타',
                            }[company.corp_cls]
                          : '미확보'}
                      </td>
                      <td>
                        {company.industry ?? '미분류'}
                        <small>{company.ksic11_code ?? '코드 미매칭'}</small>
                      </td>
                      <td>{company.ksic11_name ?? '미확보'}</td>
                      <td>{company.acc_mt ? `${company.acc_mt}월` : '—'}</td>
                      <td>
                        <span className="classification-tag">
                          {company.ksic11_status === 'review_required'
                            ? '재검토'
                            : company.industry
                              ? '분류 확인'
                              : '미분류'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && !isError && (
            <div className="panel-heading" aria-label="검색 결과 페이지">
              <Button
                variant="ghost"
                disabled={offset === 0}
                onClick={() => page(Math.max(0, offset - COMPANY_PAGE_SIZE))}
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
                onClick={() => page(offset + COMPANY_PAGE_SIZE)}
              >
                다음
              </Button>
            </div>
          )}
          <p className="panel-footnote">
            업종 필터는 확인된 KSIC11 분류 기준입니다. 미매칭·재검토 기업은
            전체에서 확인할 수 있으며, 서비스 대상 최종 판정과는 다릅니다.
          </p>
        </section>
        <CompanyCriteriaPanel
          company={selected}
          onClear={() => {
            setSelected(null)
            setParams((previous) => {
              const next = new URLSearchParams(previous)
              next.delete('corp')
              return next
            })
          }}
        />
      </div>
    </main>
  )
}
