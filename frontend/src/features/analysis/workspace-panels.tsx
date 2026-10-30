import { StatePanel } from '../../shared/components/state-panel'
import { ratiosForLease } from '../financial/financial-data'
import type { CollectedData } from '../company/collected-api'

export function FinancialOverview({
  demo = false,
  lease = 'include',
}: {
  demo?: boolean
  lease?: 'include' | 'exclude'
}) {
  const overviewRatios = ratiosForLease(lease).filter((r) =>
    ['current', 'debt', 'margin', 'roa', 'interest'].includes(r.id),
  )
  return (
    <>
      <div className="profit-overview">
        <section className="panel profit-primary">
          <span>
            영업이익 · {demo ? '2025 레이아웃 예시' : '재무 자료 미연동'}
          </span>
          <strong>
            {demo ? '100' : '—'}
            <small>억원</small>
          </strong>
          <p>
            {demo
              ? '전기 94억원 → 당기 100억원 · 공통 예시'
              : '계정·산식 검증 후 당기값과 전기 대비 변화를 제공합니다.'}
          </p>
          <div className="sparkline-placeholder">
            {demo && (
              <svg
                viewBox="0 0 240 54"
                width="240"
                height="54"
                role="img"
                aria-label="영업이익 3개년 예시: 87·94·100억원"
              >
                <polyline
                  points="6,47 120,26 234,8"
                  fill="none"
                  stroke="#60584c"
                  strokeWidth="2"
                />
                <circle cx="234" cy="8" r="3" fill="#ffbc00" />
              </svg>
            )}
            {demo
              ? '2023 · 87 → 2024 · 94 → 2025 · 100'
              : '3개년 추세 · 자료 없음'}
          </div>
        </section>
        <div className="profit-support">
          {[
            ['매출액', '1,250'],
            ['영업활동현금흐름', '89'],
            ['감가상각비', '20'],
          ].map(([title, value]) => (
            <section className="panel" key={title}>
              <span>{title}</span>
              <strong>
                {demo ? value : '—'} <small>억원</small>
              </strong>
              <p>
                {demo
                  ? '2025 공통 예시 · 검증 전'
                  : '미확보 · 0으로 계산하지 않습니다.'}
              </p>
            </section>
          ))}
        </div>
      </div>
      <div className="key-ratios">
        {overviewRatios.map((ratio) => (
          <section className="panel" key={ratio.id}>
            <span>{ratio.name}</span>
            <strong>
              {demo ? `${ratio.current}${ratio.unit}` : '자료 없음'}
            </strong>
            <small>
              {demo
                ? `전기 ${ratio.previous === null ? '자료 없음' : ratio.previous + ratio.unit} · 예시`
                : '산식·원천 미확보'}
            </small>
          </section>
        ))}
      </div>
    </>
  )
}

export function IndustryMetrics({
  industry = '업종 미확정',
}: {
  industry?: string
}) {
  const names =
    industry === '건설'
      ? [
          '계약자산 증가율 − 매출 증가율',
          '공사미수금 회수기간',
          '공사원가율',
          '제공 보증·조건부 의무 ÷ 자본',
          '영업CF ÷ 유동부채',
        ]
      : industry === '부동산 임대'
        ? [
            'EBITDA',
            'EBITDA 이자보상비율',
            '차입금 ÷ 투자부동산',
            '평균 조달금리',
            '임대율',
          ]
        : industry === '도소매'
          ? [
              '매출총이익률',
              '현금전환주기',
              '재고 회전일수',
              '매입채무 지급일수',
              '영업CF ÷ 유동부채',
            ]
          : industry === '제조'
            ? [
                '매출원가율',
                '재고 회전일수',
                '현금전환주기',
                'EBITDA',
                '영업CF ÷ 유동부채',
              ]
            : [
                '상환재원',
                '유동성·만기',
                '재무구조',
                '우발·부외 부담',
                '담보·회수여력',
              ]
  return (
    <section className="panel analysis-section">
      <div className="panel-heading">
        <h2>{industry} 핵심 지표 · 5개년 추세</h2>
        <span>원천 확보 후 제공</span>
      </div>
      <div className="industry-tiles">
        {names.map((name) => (
          <div key={name}>
            <span>{name}</span>
            <strong>자료 없음</strong>
            <small>전기·업종 중앙값 미확보</small>
            <div className="unavailable-trend">5개년 추세 미확보</div>
          </div>
        ))}
      </div>
    </section>
  )
}

export function RiskCharts() {
  return (
    <div className="financial-layout analysis-section">
      <section className="panel">
        <div className="panel-heading">
          <h2>차입·보증 만기 사다리</h2>
          <span>한도·금액·잔액 구분</span>
        </div>
        <div className="maturity-buckets">
          {['3개월', '6개월', '12개월', '1–2년', '2–3년', '3년 초과'].map(
            (v) => (
              <div key={v}>
                <span>—</span>
                <small>{v}</small>
              </div>
            ),
          )}
        </div>
        <p className="panel-footnote">
          만기일과 금액 역할을 확인한 자료가 없습니다. 1년 내 집중도는 계산하지
          않습니다.
        </p>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>업종 내 위치·상환 부담</h2>
          <span>비교 보류</span>
        </div>
        <StatePanel
          state="pending"
          title="비교 원천과 기준이 필요합니다"
          description="업종 분포·중앙값·비교 표본과 기준값 출처를 확보한 뒤 불릿 차트와 자사 위치를 표시합니다."
        />
      </section>
    </div>
  )
}

export function PredictionWorkspace({
  observations,
}: { observations?: CollectedData } = {}) {
  return (
    <>
      <div className="prediction-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>향후 12개월 복합 위험 사건</h2>
            <span className="classification-tag">예측 보류</span>
          </div>
          <div className="prediction-values">
            {[
              '재무 + 주석 결합 모델',
              '재무 기준 모델',
              '평가셋 사건 비율',
            ].map((title) => (
              <div key={title}>
                <span>{title}</span>
                <strong>— %</strong>
                <small>모델·입력·검증 결과 미연동</small>
              </div>
            ))}
          </div>
          <p className="panel-footnote">
            실제 대출 연체율·내부 등급이 아닙니다. 모델이 제공되지 않아 임의
            확률을 표시하지 않습니다.
          </p>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>
              {observations?.coverage ? '위험 사건 이력' : '대상 사건 정의'}
            </h2>
          </div>
          {observations?.coverage ? (
            <>
              <p className="panel-footnote">
                원천 기준일 {observations.source_as_of} · 회사 전체 조회 기간의
                사건 후보이며, 선택한 결산 당시의 사실이나 예측 확률을 뜻하지
                않습니다.
              </p>
              {observations.event_candidates.length > 0 ? (
                <div className="table-scroll">
                  <table aria-label="위험 사건 이력">
                    <thead>
                      <tr>
                        <th>날짜</th>
                        <th>사건</th>
                        <th>확인 상태·근거</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...observations.event_candidates]
                        .reverse()
                        .map((event) => (
                          <tr key={String(event.id)}>
                            <td>
                              {String(event.event_date)}
                              <small>{String(event.date_basis ?? '')}</small>
                            </td>
                            <td>{String(event.event_type)}</td>
                            <td>
                              {event.verified === true
                                ? '원문 대조됨'
                                : '원문 확인 전 후보'}
                              <details>
                                <summary>근거 확인</summary>
                                {event.detail && <p>{String(event.detail)}</p>}
                                <a
                                  href={`https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(String(event.rcept_no))}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  근거 공시 열기
                                </a>
                              </details>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p>
                  조회 범위에서 사건 후보가 발견되지 않았습니다. 위험 없음
                  판정은 아닙니다.
                </p>
              )}
              <p className="panel-footnote">
                공시 조회:{' '}
                {String(observations.coverage.filings_range ?? '범위 미확보')} ·
                주요사항 {String(observations.coverage.filings_b ?? '미확보')} ·
                거래소 {String(observations.coverage.filings_i ?? '미확보')} ·
                감사의견 원문{' '}
                {String(observations.coverage.audit_doc_ok ?? '미확보')}/
                {String(observations.coverage.audit_doc_reports ?? '미확보')}개
                확인
              </p>
            </>
          ) : (
            <StatePanel
              state="pending"
              title="모델 명세 확인 대기"
              description="사건 정의·기간·심각도·원천은 외부 제공 모델의 명세에 따라 표시합니다."
            />
          )}
        </section>
      </div>
      <div className="status-separation">
        {[
          '현재 징후 · 규칙 미평가',
          '미래 사건 확률 · 예측 보류',
          '담당자 확인 · 별도 기록',
        ].map((v) => (
          <div key={v}>{v}</div>
        ))}
      </div>
      <div className="financial-layout">
        <section className="panel">
          <div className="panel-heading">
            <h2>주요 입력 지표 영향</h2>
          </div>
          <StatePanel
            state="pending"
            title="설명 결과 미제공"
            description="변수 영향은 외부 모델 설명값을 사용합니다. 영향은 인과관계가 아닙니다."
          />
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>모델 비교·담당자 추가 확인</h2>
          </div>
          <StatePanel
            state="pending"
            title="검증 지표 미확보"
            description="PR-AUC·Brier·평가 사건 수와 내부 자료 확인 항목은 검증된 결과를 확보한 뒤 표시합니다."
          />
        </section>
      </div>
    </>
  )
}
