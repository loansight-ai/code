import { useRef, useState } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '../../shared/components/button'
import { Modal } from '../../shared/components/modal'
import type { FinancialContext, FinancialResult } from './api'
import '../../financial-summary.css'

export function FinancialInformation({
  id,
  context,
  result,
}: {
  id: string
  context: FinancialContext
  result: FinancialResult | null
}) {
  const [informationOpen, setInformationOpen] = useState(false)
  const informationTrigger = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button
        ref={informationTrigger}
        variant="ghost"
        className="financial-information-trigger"
        aria-label="분석 추가 정보"
        title="분석 추가 정보"
        aria-haspopup="dialog"
        onClick={() => setInformationOpen(true)}
      >
        <CircleHelp size={18} aria-hidden="true" />
      </Button>
      <Modal
        title="분석 추가 정보"
        description="공시 원문과 재무 데이터의 수집·계산 기준을 확인합니다."
        open={informationOpen}
        onOpenChange={setInformationOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          informationTrigger.current?.focus()
        }}
      >
        <dl className="financial-information-list">
          {result && (
            <>
              <div>
                <dt>
                  {result.collection_source
                    ? '분석 입력 스냅샷 생성 시각'
                    : '재무 수집 시각'}
                </dt>
                <dd>
                  {new Date(result.collected_at).toLocaleString('ko-KR', {
                    timeZone: 'Asia/Seoul',
                  })}{' '}
                  (한국 시각)
                </dd>
              </div>
              <div>
                <dt>
                  {result.collection_source
                    ? '분석 입력 SHA-256'
                    : '원본 SHA-256'}
                </dt>
                <dd>
                  <code>{result.source_sha256}</code>
                </dd>
              </div>
              {result.collection_source && (
                <>
                  <div>
                    <dt>입력 원천</dt>
                    <dd>저장된 수집 데이터</dd>
                  </div>
                  <div>
                    <dt>원천 기준일</dt>
                    <dd>{result.collection_source.source_as_of}</dd>
                  </div>
                  <div>
                    <dt>내보낸 날짜</dt>
                    <dd>{result.collection_source.exported_on}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>계정 매핑 버전</dt>
                <dd>{result.mapping_version}</dd>
              </div>
              <div>
                <dt>산식 버전</dt>
                <dd>{result.formula_version}</dd>
              </div>
              <div>
                <dt>비교 기준</dt>
                <dd>{result.comparison_basis}</dd>
              </div>
              {result.bok_benchmark && (
                <div>
                  <dt>업종 평균</dt>
                  <dd>
                    {result.bok_benchmark.source_title} ·{' '}
                    {result.bok_benchmark.industry_name ?? '업종 미확정'} · 기업
                    규모 전체 · {result.bok_benchmark.scope_note}
                  </dd>
                </div>
              )}
            </>
          )}
        </dl>
        <div className="financial-information-links">
          <a
            href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${context.receipt_no}`}
            target="_blank"
            rel="noreferrer"
          >
            DART 원문
          </a>
          {result && (
            <a href={`/api/v1/me/financial-analyses/${id}/source`}>
              수집 원본 JSON
            </a>
          )}
          {result?.bok_benchmark?.source_url && (
            <a
              href={result.bok_benchmark.source_url}
              target="_blank"
              rel="noreferrer"
            >
              한국은행 통계 원문
            </a>
          )}
          {result?.bok_benchmark?.metrics.some((m) =>
            m.values.some((v) => v.source_kind === 'ECOS'),
          ) && (
            <a href="https://ecos.bok.or.kr/" target="_blank" rel="noreferrer">
              ECOS 보완 통계
            </a>
          )}
        </div>
        {result ? (
          <p className="financial-information-note">
            금액은 억원으로 표시합니다. 미확보와 실제 0은 구분하며, 미정 산식은
            보류합니다.
          </p>
        ) : (
          <p className="financial-information-note">
            수집·계산 정보는 재무 분석 결과가 저장되면 확인할 수 있습니다.
          </p>
        )}
      </Modal>
    </>
  )
}
