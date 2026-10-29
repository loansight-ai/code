import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { DemoContext } from '../analysis/demo-context'
import { demoVersions } from '../analysis/demo-context'
import { Button } from '../../shared/components/button'
import { FormulaDialog } from './formula-dialog'
import { StatePanel } from '../../shared/components/state-panel'
import { StatusBadge } from '../../shared/components/status-badge'
import { borrowingRows, ratioGroups, ratiosForLease } from './financial-data'

export function RatioPanel({ context }: { context: DemoContext }) {
  const [params, setParams] = useSearchParams()
  const group =
    ratioGroups.find((item) => item === params.get('ratio')) ?? '유동성'
  const [formulaId, setFormulaId] = useState<string | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)
  const allRatios = ratiosForLease(context.lease)
  const formula = allRatios.find((ratio) => ratio.id === formulaId) ?? null
  const data = allRatios.filter((ratio) => ratio.group === group)
  return (
    <>
      <section className="panel analysis-section" aria-label="재무 비율">
        <div className="panel-heading">
          <h2>핵심 재무 비율</h2>
          <StatusBadge>2025 공통 예시 · 산식 검증 전</StatusBadge>
        </div>
        <div className="analysis-toolbar">
          <div className="filter-buttons" aria-label="재무 비율 묶음">
            {ratioGroups.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={group === item}
                onClick={() =>
                  setParams(
                    (previous) => {
                      previous.set('ratio', item)
                      return previous
                    },
                    { replace: true },
                  )
                }
              >
                {item}
              </button>
            ))}
          </div>
          <label className="option-check">
            <input
              type="checkbox"
              checked={context.lease === 'include'}
              onChange={(event) =>
                setParams(
                  (previous) => {
                    previous.set(
                      'lease',
                      event.target.checked ? 'include' : 'exclude',
                    )
                    return previous
                  },
                  { replace: true },
                )
              }
            />
            리스부채 포함 · 예시 옵션
          </label>
        </div>
        <div className="table-scroll">
          <table aria-label="핵심 재무 비율">
            <thead>
              <tr>
                <th>지표</th>
                <th>2024 예시</th>
                <th>2025 예시</th>
                <th>전기 대비 · 예시</th>
                <th>자료 상태</th>
                <th>계산 근거</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ratio) => (
                <tr key={ratio.id}>
                  <td>{ratio.name}</td>
                  <td>
                    {ratio.previous === null
                      ? '미확보'
                      : `${ratio.previous}${ratio.unit}`}
                  </td>
                  <td>
                    {ratio.current === null
                      ? '자료 없음'
                      : `${ratio.current}${ratio.unit}`}
                  </td>
                  <td>
                    {ratio.current === null || ratio.previous === null
                      ? '비교 보류'
                      : `${Number(ratio.current) - Number(ratio.previous) > 0 ? '+' : ''}${(Number(ratio.current) - Number(ratio.previous)).toFixed(1)}${ratio.unit === '%' ? '%p' : ratio.unit}`}
                  </td>
                  <td>
                    <StatusBadge
                      tone={ratio.current === null ? 'caution' : 'neutral'}
                    >
                      {ratio.current === null
                        ? '계산 불가'
                        : '예시값 · 검증 전'}
                    </StatusBadge>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={(event) => {
                        opener.current = event.currentTarget
                        setFormulaId(ratio.id)
                      }}
                      aria-label={`${ratio.name} 산식 보기`}
                    >
                      산식 보기
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="panel-footnote">
          실제 계산·최종 판정은 서버가 수행합니다. 예시 옵션은 로컬 검토 기준을
          분리하며, 임대보증금의 실질 차입 포함 정책을 확정하지 않습니다.
        </p>
      </section>
      <div className="financial-layout analysis-section">
        <section className="panel">
          <div className="panel-heading">
            <h2>차입 구성·상환능력</h2>
            <span className="muted">2025 공통 예시 · 억원</span>
          </div>
          <div className="table-scroll">
            <table aria-label="차입 구성">
              <thead>
                <tr>
                  <th>구성</th>
                  <th>예시 금액</th>
                </tr>
              </thead>
              <tbody>
                {borrowingRows.map(([name, value]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{value}</td>
                  </tr>
                ))}
                <tr>
                  <td>리스부채</td>
                  <td>40 · {context.lease === 'include' ? '포함' : '제외'}</td>
                </tr>
                <tr>
                  <td>총차입금 · 예시 옵션 적용</td>
                  <td>{context.lease === 'include' ? 340 : 300}</td>
                </tr>
                <tr>
                  <td>임대보증금 · 별도 부채</td>
                  <td>20 · 차입 포함 정책 미정</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="panel-footnote">
            현금성자산 120억원 · 영업CF 89억원 · 이자비용 25억원. 개별 차입의
            상환일정·담보를 함께 확인해야 합니다.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>동종·한국은행 참고 비교</h2>
            <StatusBadge>비교 보류</StatusBadge>
          </div>
          <StatePanel
            state="pending"
            title="비교 원천과 표본이 확보되지 않았습니다"
            description="동일 기간·회계 범위의 비교 스냅샷, 표본 수와 한국은행 통계의 모집단·연도·업종을 확인한 뒤 표시합니다. 최소 표본 수는 미정입니다."
          />
        </section>
      </div>
      {formula && (
        <FormulaDialog
          title={`${formula.name} · 예시 산식`}
          description={`${demoVersions.financial} · 실제 산식 정책 승인 또는 수집된 값이 아닙니다.`}
          formula={formula.formula}
          state="example"
          rows={[
            { label: '분자', value: formula.numerator },
            { label: '분모', value: formula.denominator },
            { label: '잔액 기준', value: formula.basis },
            { label: '단위', value: `${formula.unit} · 소수 첫째 자리 표시` },
            { label: '버전', value: demoVersions.financial },
            {
              label: '출처',
              value: `${formula.source} · 계정 매핑 demo-account-v1 · 실제 접수번호 미연동`,
            },
          ]}
          reason={formula.reason}
          onClose={() => setFormulaId(null)}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            opener.current?.focus()
          }}
        />
      )}
    </>
  )
}
