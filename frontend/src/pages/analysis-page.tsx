import { Suspense, lazy, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Copy, FileText, Save, ShieldAlert } from 'lucide-react'
import { findCompany } from '../features/company/demo-data'
import { Button } from '../shared/components/button'
import { Modal } from '../shared/components/modal'

const FinancialView = lazy(() =>
  import('../features/financial/financial-view').then((module) => ({
    default: module.FinancialView,
  })),
)
const titles: Record<string, string> = {
  summary: '핵심 재무 요약',
  cashflow: '실적 변동·현금흐름',
  evidence: '주석·위험징후',
  prediction: '12개월 위험 예측',
  review: '담당자 검토',
}

export function AnalysisPage() {
  const { analysisId, section = 'summary' } = useParams()
  const [params] = useSearchParams()
  const company = findCompany(analysisId)
  const report = params.get('report') ?? '2025'
  const scope = params.get('scope') ?? 'CFS'
  if (
    !company ||
    !titles[section] ||
    !['2025', '2024', '2023'].includes(report) ||
    !['CFS', 'OFS'].includes(scope)
  )
    return (
      <main id="main" className="page">
        <h1>분석 기준을 확인해 주세요</h1>
        <p>해당 예시 분석 또는 조회 조건을 찾을 수 없습니다.</p>
        <Link to="/">기업 다시 선택</Link>
      </main>
    )
  return (
    <main id="main" className="page">
      <Link to="/" className="back-link">
        <ArrowLeft size={14} />
        기업 다시 선택
      </Link>
      <div className="page-title-row">
        <div>
          <div className="page-eyebrow">COMPANY ANALYSIS</div>
          <h1>{titles[section]}</h1>
          <p className="page-description">
            {company.name}의 재무와 검토 근거를 한곳에서 확인합니다.
          </p>
        </div>
        <span className="demo-label">예시 분석</span>
      </div>
      <div className="source-strip">
        <strong>{company.name}</strong>
        {[
          company.code,
          company.market,
          company.industry,
          `${report} 사업보고서`,
          scope === 'CFS' ? '연결 CFS' : '별도 OFS',
        ].map((text) => (
          <span key={text}>{text}</span>
        ))}
        <span>출처 revision: demo-v1</span>
        <span>접수번호·수집일: 미연동</span>
        <span>재무 기준일·결산월: 미연동</span>
      </div>
      <div className="notice">
        <ShieldAlert size={17} />
        <span>
          화면 확인용 가상 데이터입니다. 실제 재무 결과·위험 판정·모델 확률을
          의미하지 않습니다.
        </span>
      </div>
      {section === 'summary' && (
        <>
          <div className="metric-grid">
            {[
              ['매출액', '1,250', '억원'],
              ['영업이익', '100', '억원'],
              ['영업활동현금흐름', '89', '억원'],
              ['위험징후', '판정 전', '규칙 미연동'],
            ].map(([label, value, unit]) => (
              <section className="panel metric" key={label}>
                <span>{label}</span>
                <strong>
                  {value}
                  <small>{unit}</small>
                </strong>
                <p>2025년 레이아웃 예시 · 검증 전</p>
              </section>
            ))}
          </div>
          <Suspense
            fallback={<p role="status">재무 화면을 불러오는 중입니다.</p>}
          >
            <FinancialView />
          </Suspense>
        </>
      )}
      {section === 'cashflow' && (
        <>
          <Suspense fallback={<p role="status">추세를 불러오는 중입니다.</p>}>
            <FinancialView />
          </Suspense>
          <div className="notice">
            운전자본·상환능력·산식·업종 비교는 검증된 서버 결과 연결 후
            표시합니다.
          </div>
        </>
      )}
      {section === 'evidence' && <EvidencePreview />}
      {section === 'prediction' && (
        <section className="panel empty-state">
          <ShieldAlert size={32} />
          <span className="status-tag">예측 보류</span>
          <h2>외부 모델과 검증 결과가 연결되지 않았습니다</h2>
          <p>
            모델·입력 계약·검증 보고서 확인 후 확률을 표시합니다.
            <br />
            현재 위험징후와 미래 12개월 위험 사건 예측은 별도로 확인합니다.
          </p>
          <div className="pending-grid">
            <div>
              기준 모델<strong>미연동</strong>
            </div>
            <div>
              결합 모델<strong>미연동</strong>
            </div>
            <div>
              예측 공시일<strong>미확보</strong>
            </div>
          </div>
        </section>
      )}
      {section === 'review' && (
        <ReviewPreview
          key={`${analysisId}-${report}-${scope}`}
          storageKey={`loansight.demo.memo.${analysisId}.${report}.${scope}`}
          context={`${company.name} / ${report} 사업보고서 / ${scope} / demo-v1`}
        />
      )}
    </main>
  )
}

function EvidencePreview() {
  const [open, setOpen] = useState(false)
  const [displayed, setDisplayed] = useState(false)
  const [checked, setChecked] = useState(false)
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>주석 근거 확인 흐름</h2>
        <span className="status-tag">검수 전 · 예시</span>
      </div>
      <div className="evidence-body">
        <h3>차입 약정 관련 문구 · 가상 예시</h3>
        <p>
          약정의 존재만으로 위반이나 위험 발생을 판정하지 않습니다. 아래 예시
          원문을 열어 확인 흐름을 살펴볼 수 있습니다.
        </p>
        <Button variant="outline" onClick={() => setOpen(true)}>
          <FileText size={16} />
          예시 원문 열기
        </Button>
        <label className="check-row">
          <input
            type="checkbox"
            checked={checked}
            disabled={!displayed}
            onChange={(event) => setChecked(event.target.checked)}
          />
          예시 내용 확인{' '}
          {displayed ? '(데모 화면 내 상태)' : '(원문을 먼저 열어 주세요)'}
        </label>
        <p className="muted">
          서버 열람 기록·근거 revision 검증·업무 확인 저장은 미연동입니다.
        </p>
      </div>
      <Modal
        title="주석 예시 원문"
        description="가상 문구 · demo-v1 · 실제 공시 또는 열람 기록이 아닙니다."
        open={open}
        onOpenChange={setOpen}
      >
        <blockquote>
          회사는 금융기관과 차입 약정을 체결하고 있습니다. 약정 조건의 충족 여부
          및 관련 금액은 이 예시에서 제공하지 않습니다.
        </blockquote>
        <Button
          onClick={() => {
            setDisplayed(true)
            setOpen(false)
          }}
        >
          예시 원문 확인 후 닫기
        </Button>
      </Modal>
    </section>
  )
}

function ReviewPreview({
  storageKey,
  context,
}: {
  storageKey: string
  context: string
}) {
  const [memo, setMemo] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? ''
    } catch {
      return ''
    }
  })
  const [status, setStatus] = useState('')
  const [dirty, setDirty] = useState(false)
  function save() {
    try {
      localStorage.setItem(storageKey, memo)
      setDirty(false)
      setStatus('이 브라우저에 예시 메모를 저장했습니다.')
    } catch {
      setStatus('저장하지 못했습니다. 브라우저 저장 공간 설정을 확인해 주세요.')
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `[가상 예시 검토 메모 · 실제 분석 아님]\n${context}\n출처·접수번호·원문 위치: 미연동\n모델·규칙·산식 버전: 미연동\n\n담당자 의견\n${memo}`,
      )
      setStatus('예시 표시와 분석 기준을 포함하여 복사했습니다.')
    } catch {
      setStatus('복사하지 못했습니다. 내용을 직접 선택해 복사해 주세요.')
    }
  }
  return (
    <div className="review-layout">
      <section className="panel">
        <div className="panel-heading">
          <h2>담당자 의견</h2>
          <span className="muted">
            {dirty ? '저장하지 않은 변경' : '브라우저 임시 메모'}
          </span>
        </div>
        <div className="evidence-body">
          <label className="form-field">
            검토 메모
            <textarea
              rows={10}
              value={memo}
              onChange={(event) => {
                setMemo(event.target.value)
                setDirty(true)
                setStatus('')
              }}
              placeholder="추가 확인할 사항과 담당자 의견을 입력하세요."
            />
          </label>
          <p className="muted">
            이 기기의 브라우저에만 저장됩니다. 서버 세션과 사용자별 메모 복원은
            미연동입니다.
          </p>
          <div className="button-row">
            <Button onClick={save}>
              <Save size={16} />
              브라우저에 저장
            </Button>
            <Button variant="outline" onClick={copy}>
              <Copy size={16} />
              복사
            </Button>
            <Button variant="outline" disabled>
              PDF · 후순위
            </Button>
          </div>
          <p role="status">{status}</p>
        </div>
      </section>
      <section className="panel evidence-body">
        <h2>담당자 체크리스트</h2>
        <p>
          17항목의 원자료와 승인 기준이 확정되지 않았습니다. 연결 후 시스템
          제안과 담당자 확인 상태를 구분해 표시합니다.
        </p>
        <span className="status-tag">원자료 연결 대기</span>
        <hr />
        <h3>검토 기준</h3>
        <p>{context}</p>
        <p className="muted">
          AI 초안 생성·재생성·서버 저장은 백엔드 연동 이후 제공됩니다.
        </p>
      </section>
    </div>
  )
}
