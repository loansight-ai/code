import {
  exposureMoney as money,
  type ExposureSource,
  type ExposureSummary,
} from './exposure-api'
import { ExposureSourceLinks } from './exposure-source-links'
import './litigation-panel.css'

export function LitigationPanel({
  data,
  loading,
  error,
  onOpen,
}: {
  data?: ExposureSummary['litigation']
  loading: boolean
  error: boolean
  onOpen: (source: ExposureSource) => void
}) {
  const detected = data?.detected ?? false
  const amount = (value: string | null | undefined) =>
    value == null ? '미확보' : `${money(value)}억`
  const cases = data?.top_cases ?? []
  return (
    <section className="panel exposure-litigation" aria-label="소송 현황 피고">
      <div className="litigation-layout">
        <div className="litigation-overview">
          <div className="litigation-heading">
            <h2>소송 현황</h2>
            <span
              className={`extraction-status ${detected ? 'is-found' : 'is-absent'}`}
            >
              {loading
                ? '확인 중'
                : error
                  ? '조회 실패'
                  : detected
                    ? '검출'
                    : '미확보'}
            </span>
            {detected && (
              <span className="litigation-availability">
                {data?.case_list_available
                  ? '건별 목록 있음'
                  : '건별 목록 미확보'}
              </span>
            )}
          </div>
          <dl className="litigation-stats">
            <div>
              <dt>피고 건수</dt>
              <dd>
                {data?.case_count == null ? '미확보' : `${data.case_count}건`}
              </dd>
            </div>
            <div>
              <dt>소송가액</dt>
              <dd>{amount(data?.claim)}</dd>
            </div>
            <div>
              <dt>소송충당부채</dt>
              <dd>{amount(data?.provision)}</dd>
            </div>
          </dl>
          <p className="litigation-plaintiff">
            원고 (참고):{' '}
            {data?.plaintiff?.case_count == null
              ? '건수 미확보'
              : `${data.plaintiff.case_count}건`}{' '}
            · {amount(data?.plaintiff?.claim)}
          </p>
          <ExposureSourceLinks sources={data?.sources ?? []} onOpen={onOpen} />
          {!!data?.plaintiff?.sources.length && (
            <div className="litigation-plaintiff-sources">
              <span>원고 원문</span>
              <ExposureSourceLinks
                sources={data.plaintiff.sources}
                onOpen={onOpen}
              />
            </div>
          )}
        </div>
        <div className="litigation-details">
          <h3>
            소송가액 상위 3건 <span>(피고)</span>
          </h3>
          <div className="litigation-table-scroll">
            <table
              className="litigation-case-table"
              aria-label="피고 소송가액 상위 사건"
            >
              <thead>
                <tr>
                  <th scope="col">소제기일</th>
                  <th scope="col">원고</th>
                  <th scope="col">소송 내용</th>
                  <th scope="col">소송가액</th>
                  <th scope="col">진행 상황</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.case_number}>
                    <td>{c.filing_date?.replaceAll('-', '.') ?? '미확보'}</td>
                    <td>{c.plaintiff ?? '미확보'}</td>
                    <th scope="row">
                      {c.sources[0] ? (
                        <button
                          title={`사건번호 ${c.case_number}`}
                          aria-label={`${c.label} 원문 열기`}
                          onClick={() => onOpen(c.sources[0])}
                        >
                          {c.label}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                    <td className="litigation-claim">{amount(c.claim)}</td>
                    <td>{c.status ?? '미확보'}</td>
                  </tr>
                ))}
                {!cases.length && (
                  <tr>
                    <td colSpan={5} className="litigation-empty">
                      {loading
                        ? '소송 자료를 불러오는 중입니다.'
                        : error
                          ? '소송 자료를 불러오지 못했습니다.'
                          : data?.case_list_available
                            ? '건별 소송가액이 미확보되어 순위를 표시할 수 없습니다.'
                            : '건별 목록이 미확보되어 공시된 합계만 표시합니다.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {data?.notes.length ? (
            data.notes.map((note, i) => (
              <blockquote className="litigation-quote" key={i}>
                <span>원문: </span>“{note.quote}”
                <ExposureSourceLinks sources={note.sources} onOpen={onOpen} />
              </blockquote>
            ))
          ) : (
            <p className="litigation-note-empty">
              소송 결과 관련 원문 인용 미확보
            </p>
          )}
        </div>
      </div>
      <p className="litigation-footnote">
        원고 사건은 피고 금액에 합산하지 않습니다. 소송가액은 확정 손실액이
        아닙니다.
      </p>
    </section>
  )
}
