import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request, errorMessage } from '../session/api'
import { Button } from '../../shared/components/button'
import {
  factPath,
  fields,
  kinds,
  postFact,
  sourceSchema,
  type Fact,
  type FactData,
} from './fact-api'
import { searchBundle, type EvidenceBundle } from './bundle-api'

export function FactForm({
  bundle,
  sourceId,
  initial,
  onClose,
}: {
  bundle: EvidenceBundle
  sourceId: string
  initial?: Fact
  onClose: () => void
}) {
  const client = useQueryClient()
  const [data, setData] = useState<FactData>(
    initial?.data ?? {
      category: 'collateral',
      kind: 'collateral',
      statement: '',
      subject: bundle.company_name ?? '',
      direction: 'UNKNOWN',
      period: null,
      counterparty: null,
      amount_role: 'UNKNOWN',
      amount: null,
      maturity: null,
      status: null,
      detection: 'DETECTED',
      citations: [{ segment_id: sourceId, field: 'statement', quote: '' }],
    },
  )
  const [extraSources, setExtraSources] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const searchSources = useMutation({
    mutationFn: () =>
      searchBundle(
        bundle,
        search
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
        0,
      ),
  })
  const ids = Array.from(
    new Set([
      sourceId,
      ...extraSources,
      ...data.citations.map((c) => c.segment_id),
    ]),
  )
  const [selectedSource, setSource] = useState(sourceId)
  const [row, setRow] = useState(0)
  const [text, setText] = useState(0)
  const [reason, setReason] = useState('')
  const source = useQuery({
    queryKey: [
      'server',
      bundle.bundle_id,
      'fact-form-source',
      selectedSource,
      row,
      text,
    ],
    queryFn: async () =>
      sourceSchema.parse(
        await request(
          `${factPath(bundle.bundle_id)}/fact-sources?segment_id=${selectedSource}&row_offset=${row}&text_offset=${text}`,
        ),
      ),
    retry: false,
  })
  const save = useMutation({
    mutationFn: () =>
      postFact(
        bundle.bundle_id,
        initial ? `/facts/${initial.id}/revisions` : '/facts',
        initial
          ? { expected_version: initial.version, reason, fact: data }
          : data,
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['server'] })
      onClose()
    },
  })
  function patch(values: Partial<FactData>) {
    setData((old) => ({ ...old, ...values }))
  }
  return (
    <section className="bundle-fact-form" aria-label="사실 후보 편집">
      <h3>{initial ? '수정본 작성' : '사실 후보 작성'}</h3>
      <p>
        채운 항목마다 원문의 정확한 발췌를 연결하세요. 저장 후 검수 대기 상태가
        됩니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <label>
          사실 종류{' '}
          <select
            value={data.kind}
            onChange={(e) => {
              const kind = e.target.value as FactData['kind']
              patch({
                kind,
                category: kinds[kind][0],
                obligation_type: null,
                project_count: null,
                case_number: null,
                case_count: null,
                filing_date: null,
                case_note: null,
              })
            }}
          >
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {v[1]}
              </option>
            ))}
          </select>
        </label>
        <label>
          사실 설명{' '}
          <textarea
            required
            maxLength={2000}
            value={data.statement}
            onChange={(e) => patch({ statement: e.target.value })}
          />
        </label>
        <label>
          대상{' '}
          <input
            required
            maxLength={200}
            value={data.subject}
            onChange={(e) => patch({ subject: e.target.value })}
          />
        </label>
        <label>
          방향{' '}
          <select
            value={data.direction}
            onChange={(e) => patch({ direction: e.target.value })}
          >
            {[
              ['UNKNOWN', '미확인'],
              ['PROVIDED', '제공'],
              ['RECEIVED', '수취'],
              ['PLAINTIFF', '원고'],
              ['DEFENDANT', '피고'],
              ['ISSUER', '발행'],
            ].map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          기준 기간{' '}
          <input
            placeholder="2025.12"
            pattern="[0-9]{4}\.(0[1-9]|1[0-2])"
            value={data.period ?? ''}
            onChange={(e) => patch({ period: e.target.value || null })}
          />
        </label>
        {(['counterparty', 'maturity', 'status'] as const).map((k) => (
          <label key={k}>
            {fields[k]}{' '}
            <input
              maxLength={k === 'maturity' ? 200 : 300}
              value={data[k] ?? ''}
              onChange={(e) => patch({ [k]: e.target.value || null })}
            />
          </label>
        ))}
        <label>
          공시 상태{' '}
          <select
            value={data.detection}
            onChange={(e) => patch({ detection: e.target.value })}
          >
            <option value="DETECTED">기재 발견</option>
            <option value="EXPLICITLY_NONE">명시적 없음</option>
          </select>
        </label>
        <p>
          미검출은 후보를 만들지 않습니다. 명시적 없음에는 부정문 인용이
          필요합니다.
        </p>
        <label>
          금액 역할{' '}
          <select
            value={data.amount_role}
            onChange={(e) => patch({ amount_role: e.target.value })}
          >
            {[
              ['UNKNOWN', '미확인'],
              ['BALANCE', '잔액'],
              ['LIMIT', '한도'],
              ['CLAIM', '청구액'],
              ['GUARANTEE', '보증액'],
              ['PRINCIPAL', '원금'],
              ['LOAN_BALANCE', '대출잔액'],
              ['COMMITMENT', '보증·약정금액'],
              ['RELATED_PARTY', '특수관계자 제공분'],
              ['PROVISION', '소송충당부채'],
            ].map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {['guarantee', 'borrowing_maturity', 'litigation'].includes(
          data.kind,
        ) && (
          <details className="bundle-disclosure">
            <summary>구성·만기·소송 집계 정보</summary>
            <label>
              상세·합계 구분{' '}
              <select
                value={data.aggregation_level ?? 'UNKNOWN'}
                onChange={(e) => patch({ aggregation_level: e.target.value })}
              >
                <option value="UNKNOWN">미확인 · 합산 보류</option>
                <option value="DETAIL">상세행</option>
                <option value="SUBTOTAL">소계행</option>
                <option value="TOTAL">총계행</option>
              </select>
            </label>
            {data.kind === 'guarantee' && (
              <>
                <label>
                  보증·의무 유형{' '}
                  <select
                    value={data.obligation_type ?? ''}
                    onChange={(e) =>
                      patch({ obligation_type: e.target.value || null })
                    }
                  >
                    <option value="">미확인</option>
                    <option value="PF_GUARANTEE">PF 대출보증</option>
                    <option value="COMPLETION_SUPPORT">
                      책임준공 미이행 시 채무인수
                    </option>
                    <option value="FUNDING_SUPPORT">자금보충</option>
                    <option value="BUYER_GUARANTEE">
                      수분양자 중도금 보증
                    </option>
                    <option value="OTHER">기타 보증·조건부 의무</option>
                  </select>
                </label>
                <label>
                  사업장 수{' '}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={data.project_count ?? ''}
                    onChange={(e) =>
                      patch({
                        project_count:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <p>
                  피보증처 수를 사업장 수로 대신하지 않습니다. 각 금액 열은 별도
                  사실로 저장하고 해당 표의 직접 인용을 연결하세요.
                </p>
              </>
            )}
            {data.kind === 'litigation' && (
              <>
                <label>
                  소제기일{' '}
                  <input
                    type="date"
                    value={data.filing_date ?? ''}
                    onChange={(e) =>
                      patch({ filing_date: e.target.value || null })
                    }
                  />
                </label>
                <label>
                  사건번호{' '}
                  <input
                    maxLength={100}
                    value={data.case_number ?? ''}
                    onChange={(e) =>
                      patch({ case_number: e.target.value || null })
                    }
                  />
                </label>
                <label>
                  공시 소송 건수{' '}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={data.case_count ?? ''}
                    onChange={(e) =>
                      patch({
                        case_count:
                          e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  소송 관련 원문 설명{' '}
                  <textarea
                    maxLength={2000}
                    value={data.case_note ?? ''}
                    onChange={(e) =>
                      patch({ case_note: e.target.value || null })
                    }
                  />
                </label>
                <p>
                  소제기일은 공시일·기일과 구분하고, 피고 사건의 상대방에는
                  원고를 기록합니다. 각 항목의 직접 인용을 연결하세요.
                </p>
              </>
            )}
            <p>
              만기 요약은 YYYY-MM-DD 형식의 확인된 날짜를 사용합니다. 총괄행과
              상세행은 중복 합산하지 않습니다.
            </p>
          </details>
        )}
        <p>금액은 아래 원문 표의 셀을 눌러 선택하세요.</p>
        {data.amount && (
          <div>
            <p>
              선택 금액: {data.amount.raw_value} · 원문{' '}
              {data.amount.cell.row + 1}행 {data.amount.cell.column + 1}열
            </p>
            <label>
              금액 단위{' '}
              <select
                value={data.amount.unit}
                onChange={(e) => {
                  const unit = e.target.value
                  patch({
                    amount: {
                      ...data.amount!,
                      unit,
                      currency: ['USD', '천USD'].includes(unit)
                        ? 'USD'
                        : ['EUR', 'JPY'].includes(unit)
                          ? unit
                          : 'KRW',
                    },
                  })
                }}
              >
                {[
                  '원',
                  '천원',
                  '백만원',
                  '억원',
                  'USD',
                  '천USD',
                  'EUR',
                  'JPY',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => patch({ amount: null })}
            >
              금액 비우기
            </Button>
          </div>
        )}
        <h4>항목별 직접 인용</h4>
        <label>
          추가 근거 검색{' '}
          <input
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <Button
          type="button"
          variant="outline"
          disabled={!search.trim() || searchSources.isPending}
          onClick={() => searchSources.mutate()}
        >
          연결할 근거 찾기
        </Button>
        {searchSources.isError && (
          <p role="alert">추가 근거를 검색하지 못했습니다.</p>
        )}
        {searchSources.data?.candidates.map((c) => (
          <div key={c.segment_id}>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setExtraSources((v) => [...v, c.segment_id])
                setSource(c.segment_id)
                setRow(0)
                setText(0)
              }}
            >
              {c.origin === 'html' ? 'HTML' : '덤프'} ·{' '}
              {c.section_path.map((v) => v.title).join(' / ')} · 자료 연결
            </Button>
            <p>{c.excerpt.text}</p>
          </div>
        ))}
        {searchSources.data?.next_offset != null && (
          <p>첫 후보 10개입니다. 검색어를 구체화해 추가 자료를 찾으세요.</p>
        )}
        {data.citations.map((c, i) => (
          <div key={i}>
            <label>
              인용 항목 {i + 1}{' '}
              <select
                value={c.field}
                onChange={(e) =>
                  patch({
                    citations: data.citations.map((v, j) =>
                      i === j
                        ? { ...v, field: e.target.value as typeof c.field }
                        : v,
                    ),
                  })
                }
              >
                {Object.entries(fields).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              인용 자료 {i + 1}{' '}
              <select
                value={c.segment_id}
                onChange={(e) =>
                  patch({
                    citations: data.citations.map((v, j) =>
                      i === j ? { ...v, segment_id: e.target.value } : v,
                    ),
                  })
                }
              >
                {ids.map((v, j) => (
                  <option key={v} value={v}>
                    자료 {j + 1}
                  </option>
                ))}
              </select>
            </label>
            <label>
              정확한 발췌 {i + 1}{' '}
              <textarea
                required
                maxLength={4000}
                value={c.quote}
                onChange={(e) =>
                  patch({
                    citations: data.citations.map((v, j) =>
                      i === j ? { ...v, quote: e.target.value } : v,
                    ),
                  })
                }
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={data.citations.length <= 1}
              onClick={() =>
                patch({ citations: data.citations.filter((_, j) => i !== j) })
              }
            >
              인용 {i + 1} 삭제
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={data.citations.length >= 20}
          onClick={() =>
            patch({
              citations: [
                ...data.citations,
                { segment_id: selectedSource, field: 'subject', quote: '' },
              ],
            })
          }
        >
          인용 추가
        </Button>
        {initial && (
          <label>
            수정 사유{' '}
            <textarea
              required
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        )}
        <Button disabled={save.isPending}>검수 대기로 저장</Button>{' '}
        <Button type="button" variant="ghost" onClick={onClose}>
          편집 닫기
        </Button>
        {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
      </form>
      <h4>저장된 원문</h4>
      <label>
        원문 자료{' '}
        <select
          value={selectedSource}
          onChange={(e) => {
            setSource(e.target.value)
            setRow(0)
            setText(0)
          }}
        >
          {ids.map((v, i) => (
            <option key={v} value={v}>
              자료 {i + 1}
            </option>
          ))}
        </select>
      </label>
      {source.isError && <p role="alert">원문을 불러오지 못했습니다.</p>}
      {source.data && (
        <>
          <p>
            {source.data.title} · {source.data.scope}
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{source.data.text}</p>
          {source.data.cells && (
            <div className="table-scroll">
              <table aria-label="금액 선택용 원문 표">
                <tbody>
                  {source.data.cells.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={!/^-?[\d,.()\s]+$/.test(c)}
                            onClick={() =>
                              patch({
                                amount: {
                                  raw_value: c.trim(),
                                  unit: '원',
                                  currency: 'KRW',
                                  cell: {
                                    segment_id: selectedSource,
                                    row: source.data!.row_offset + i,
                                    column: j,
                                  },
                                },
                              })
                            }
                          >
                            {c || '빈칸'}
                          </Button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {source.data.truncated_cells && (
            <p>
              너무 긴 셀 일부가 생략되었습니다. 발췌가 불완전하면 승인할 수
              없습니다.
            </p>
          )}
          {row > 0 && (
            <Button onClick={() => setRow(Math.max(0, row - 20))}>
              원문 이전 행
            </Button>
          )}
          {source.data.next_row_offset !== null && (
            <Button onClick={() => setRow(source.data!.next_row_offset!)}>
              원문 다음 행
            </Button>
          )}
          {text > 0 && (
            <Button onClick={() => setText(Math.max(0, text - 4000))}>
              원문 이전 본문
            </Button>
          )}
          {source.data.next_text_offset !== null && (
            <Button onClick={() => setText(source.data!.next_text_offset!)}>
              원문 다음 본문
            </Button>
          )}
        </>
      )}
    </section>
  )
}
