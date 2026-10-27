import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  ArrowRight,
  Building2,
  Check,
  Database,
  FileText,
  Search,
} from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  companies,
  industries,
  isAnalysisReady,
  reports,
} from '../features/company/demo-data'
import { searchDemoCompanies } from '../features/company/company-search'
import { Button } from '../shared/components/button'
import { StatePanel } from '../shared/components/state-panel'
import { StatusBadge } from '../shared/components/status-badge'
import { CompanyPreparation } from '../features/company/company-preparation'

const selectionSchema = z.object({
  company: z
    .string()
    .refine(
      (id) =>
        companies.some(
          (company) => company.id === id && isAnalysisReady(company),
        ),
      '적용 업종이 확인된 대상 기업을 선택해 주세요.',
    ),
  report: z.enum(['2025', '2024', '2023']),
  scope: z.enum(['CFS', 'OFS']),
})
type Selection = z.infer<typeof selectionSchema>

export function CompanyPage() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const industry = params.get('industry') ?? '전체'
  const selected = params.get('company') ?? ''
  const report = params.get('report') ?? '2025'
  const scope = params.get('scope') ?? 'CFS'
  const lease = params.get('lease') ?? 'include'
  const invalidCriteria =
    !['include', 'exclude'].includes(lease) ||
    !['2025', '2024', '2023'].includes(report) ||
    !['CFS', 'OFS'].includes(scope) ||
    (selected !== '' &&
      !companies.some(
        (company) =>
          company.id === selected && company.classification !== '제외',
      ))
  const navigate = useNavigate()
  const form = useForm<Selection>({
    resolver: zodResolver(selectionSchema),
    values: {
      company: selected,
      report: selectionSchema.shape.report.safeParse(report).data ?? '2025',
      scope: selectionSchema.shape.scope.safeParse(scope).data ?? 'CFS',
    },
  })
  const {
    data = [],
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['demo', 'companies', query, industry],
    queryFn: () => searchDemoCompanies(query, industry),
    retry: false,
  })
  function filter(key: string, value: string) {
    setParams(
      (previous) => {
        previous.set(key, value)
        return previous
      },
      { replace: true },
    )
  }
  const company = companies.find((item) => item.id === selected)
  const canAnalyze = !!company && isAnalysisReady(company) && !invalidCriteria
  function resetCriteria() {
    setParams(
      (previous) => {
        for (const key of ['company', 'report', 'scope', 'lease'])
          previous.delete(key)
        return previous
      },
      { replace: true },
    )
  }
  return (
    <main id="main" className="page">
      <div className="page-eyebrow">COMPANY EXPLORER</div>
      <div className="page-title-row">
        <div>
          <h1>어떤 기업을 검토할까요?</h1>
          <p className="page-description">
            기업과 보고서를 선택하고, 공시 속 재무와 위험의 근거를 살펴보세요.
          </p>
        </div>
        <span className="step-label">
          <b>01</b> 기업 선택 <span>— 02 보고서 확인 — 03 분석 검토</span>
        </span>
      </div>
      <div className="notice">
        <Database size={16} />
        <span>
          <strong>예시 데이터로 둘러보기</strong> · 아래 기업과 수치는 모두
          가상입니다. 실제 공시 수집 및 분석은 실행되지 않습니다.
        </span>
      </div>
      <div className="search-layout">
        <section
          className="panel company-panel"
          aria-labelledby="company-heading"
        >
          <div className="panel-heading">
            <h2 id="company-heading">기업 검색</h2>
            <span className="muted">검토 대상 4개 업종</span>
          </div>
          <label className="search-field">
            <Search size={20} />
            <input
              aria-label="기업명 또는 종목코드"
              value={query}
              onChange={(event) => filter('q', event.target.value)}
              placeholder="기업명 또는 종목코드를 입력하세요"
            />
            <span>검색</span>
          </label>
          <div className="industry-filters" aria-label="업종 필터">
            {['전체', ...industries].map((item) => (
              <button
                key={item}
                aria-pressed={industry === item}
                onClick={() => filter('industry', item)}
              >
                {item}
              </button>
            ))}
          </div>
          <p className="excluded-industries">
            장비·물품 렌탈, 운수·창고, 금융·보험, 지주·스팩, 부동산 관리·중개는
            대상에서 제외됩니다.
          </p>
          <div className="results-heading">
            <span>
              기업 목록{' '}
              <b>
                {isPending ? '조회 중' : isError ? '조회 실패' : data.length}
              </b>
            </span>
            <span>가상 기업 · 화면 확인용</span>
          </div>
          {isPending ? (
            <StatePanel
              state="loading"
              title="기업을 불러오는 중입니다."
              description="선택한 검색 조건으로 조회합니다."
            />
          ) : isError ? (
            <StatePanel
              state="error"
              title="기업 목록을 불러오지 못했습니다."
              description="조회 실패는 검색 결과 없음과 다릅니다. 다시 시도해 주세요."
              action={{
                label: '다시 시도',
                onClick: () => {
                  void refetch()
                },
              }}
            />
          ) : data.length === 0 ? (
            <StatePanel
              state="empty"
              title="검색 결과가 없습니다"
              description="기업명이나 업종 조건을 바꿔 주세요."
              action={{
                label: '검색 조건 초기화',
                onClick: () =>
                  setParams(
                    (previous) => {
                      previous.delete('q')
                      previous.delete('industry')
                      return previous
                    },
                    { replace: true },
                  ),
              }}
            />
          ) : (
            <div className="company-list">
              {data.map((item) => (
                <button
                  key={item.id}
                  className={`company-row ${selected === item.id ? 'selected' : ''}`}
                  aria-pressed={selected === item.id}
                  disabled={item.classification === '제외'}
                  onClick={() => filter('company', item.id)}
                >
                  <span className="company-avatar">
                    <Building2 size={23} />
                  </span>
                  <span className="company-info">
                    <strong>
                      {item.name}
                      <span className="market-tag">{item.market}</span>
                    </strong>
                    <small>
                      {item.code} <span>·</span> {item.description}
                    </small>
                    {item.classification === '제외' && (
                      <small>{item.classificationReason}</small>
                    )}
                  </span>
                  <span className="company-classification">
                    <span className="industry-tag">
                      {item.industry ?? '업종 미확정'}
                    </span>
                    <StatusBadge
                      tone={
                        item.classification === '복합' ||
                        item.classification === '미분류'
                          ? 'caution'
                          : 'neutral'
                      }
                    >
                      {item.classification}
                    </StatusBadge>
                  </span>
                  <span className="selection-circle">
                    {selected === item.id && <Check size={14} />}
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="panel-footnote">
            실제 기업 검색은 OpenDART API 연동 후 제공됩니다.
          </div>
        </section>
        <form
          className="panel selection-panel"
          onSubmit={form.handleSubmit((value) =>
            navigate(
              `/analyses/${value.company}/summary?report=${value.report}&scope=${value.scope}${params.has('lease') ? `&lease=${lease}` : ''}`,
            ),
          )}
        >
          <div className="panel-heading">
            <h2>분석 기준 선택</h2>
            <FileText size={19} />
          </div>
          <div className={`selected-company ${company ? 'has-company' : ''}`}>
            <span className="field-label">선택한 기업</span>
            <strong>{company?.name ?? '기업을 선택해 주세요'}</strong>
            <span>
              {company
                ? `${company.industry ?? '업종 미확정'} · ${company.code}`
                : '왼쪽 목록에서 기업을 선택하세요.'}
            </span>
          </div>
          {selected && (
            <div className="selection-reset">
              <Button
                variant="ghost"
                type="button"
                onClick={() => filter('company', '')}
              >
                기업 선택 해제
              </Button>
            </div>
          )}
          {company &&
            !isPending &&
            !isError &&
            !data.some((item) => item.id === company.id) && (
              <p className="selection-note">
                선택한 기업이 현재 검색 조건에서는 숨겨져 있습니다. 선택은
                유지되며, 위에서 해제할 수 있습니다.
              </p>
            )}
          {invalidCriteria && (
            <StatePanel
              state="error"
              title="분석 기준을 확인해 주세요"
              description="주소의 기업·보고서 또는 회계 범위를 확인할 수 없습니다."
              action={{ label: '분석 기준 초기화', onClick: resetCriteria }}
            />
          )}
          {company && !invalidCriteria && (
            <section
              className="classification-detail"
              aria-label="업종 판정 정보"
            >
              <div>
                <strong>업종 판정</strong>
                <StatusBadge
                  tone={isAnalysisReady(company) ? 'neutral' : 'caution'}
                >
                  {company.classification}
                </StatusBadge>
              </div>
              <p>{company.classificationReason}</p>
              <span>판정 근거·매핑 버전: 예시 데이터 / 실제 규칙 미연동</span>
              {!isAnalysisReady(company) && (
                <p>적용 업종 확인 전에는 이 예시 분석을 열 수 없습니다.</p>
              )}
            </section>
          )}
          <input type="hidden" {...form.register('company')} />
          {form.formState.errors.company && (
            <p role="alert" className="error-text">
              {form.formState.errors.company.message}
            </p>
          )}
          <label className="form-field">
            보고서
            <select
              {...form.register('report', {
                onChange: (event) => filter('report', event.target.value),
              })}
            >
              {reports.map((report, index) => (
                <option key={report} value={String(2025 - index)}>
                  {report} · 예시
                </option>
              ))}
            </select>
          </label>
          <fieldset className="scope-field">
            <legend>회계 범위</legend>
            <div>
              {[
                ['CFS', '연결'],
                ['OFS', '별도'],
              ].map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    value={value}
                    {...form.register('scope', {
                      onChange: (event) => filter('scope', event.target.value),
                    })}
                  />
                  {label}
                  <small>{value}</small>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="selection-note">
            선택한 기준은 분석 화면 전체에 동일하게 적용됩니다. 보고서와 회계
            범위별 실제 데이터는 아직 연결되지 않았습니다.
          </p>
          <Button type="submit" className="w-full" disabled={!canAnalyze}>
            예시 분석 열기
            <ArrowRight size={17} />
          </Button>
          <span className="secure-note">수집 요청 없이 화면만 확인합니다.</span>
        </form>
      </div>
      {company && !invalidCriteria && (
        <CompanyPreparation
          key={`${company.id}.${report}.${scope}`}
          company={company}
          report={report}
          scope={scope}
        />
      )}
      <section className="how-it-works">
        <div>
          <span className="page-eyebrow">YOUR REVIEW, CONNECTED</span>
          <h2>숫자를 넘어, 판단의 근거까지.</h2>
        </div>
        <div>
          <span>01 / 재무 파악</span>
          <p>
            핵심 지표와 현금흐름을
            <br />
            동일한 분석 기준으로 확인
          </p>
        </div>
        <div>
          <span>02 / 근거 확인</span>
          <p>
            위험징후에서 공시 원문까지
            <br />
            연결되는 검토 흐름
          </p>
        </div>
        <div>
          <span>03 / 검토 기록</span>
          <p>
            담당자의 확인과 의견을
            <br />
            근거와 함께 정리
          </p>
        </div>
      </section>
      <footer className="page-footer">
        <span>
          LoanSight AI는 담당자의 검토를 지원하며, 최종 여신 판단을 대신하지
          않습니다.
        </span>
        <span>FRONTEND PREVIEW · v0.1</span>
      </footer>
    </main>
  )
}
