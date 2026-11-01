import { useContext, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { SessionContext } from '../session/session-context'
import { request } from '../session/api'
import { Button } from '../../shared/components/button'
import { FactReview } from '../evidence/fact-panel'
import type { EvidenceBundle } from '../evidence/bundle-api'

const labels: Record<string, string> = {
  READY: '규칙 입력 준비',
  REVIEW_PENDING: '사실 검수 대기',
  REJECTED: '반려되어 제외',
  VALIDATION_BLOCKED: '근거 보완 필요',
  SOURCE_CHANGED: '원문 변경 · 재검수 필요',
  PERIOD_UNCONFIRMED: '보고서 기준 기간 확인 필요',
  CONFLICT_REQUIRES_REVIEW: '충돌 후보 확인 필요',
  DEFINITION_PENDING: '규칙 정의 대기',
  EVALUATED: '설정된 규칙 평가',
  INPUTS_MISSING: '입력 미확보',
  INPUTS_BLOCKED: '입력 검증 보류',
  PARTIAL: '일부만 평가',
  TRIGGERED: '조건 충족',
  NOT_TRIGGERED: '해당 조건 미충족',
  NOT_APPLICABLE: '적용 대상 아님',
  WARNING: '경고',
  CAUTION: '주의',
  OBSERVATION: '관찰',
  CONDITION_PRESENT: '조건·약정 존재',
  ACTUAL_EVENT: '사유 발생',
  EXPLICIT_NEGATION: '공시상 명시적 없음',
}
const signalSchema = z.object({
  bundle_id: z.string().uuid(),
  input_revision: z.string(),
  registry_revision: z.string(),
  version: z.string(),
  evaluation_status: z.string(),
  ready_inputs: z.number(),
  total_facts: z.number(),
  next_offset: z.number().nullable(),
  categories: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      status: z.string(),
      ready_inputs: z.number(),
      configured_rules: z.number(),
      states: z.record(z.string(), z.number()),
    }),
  ),
  facts: z.array(
    z.object({
      fact_id: z.string().uuid(),
      revision: z.number(),
      version: z.number(),
      category: z.string(),
      kind: z.string(),
      statement: z.string(),
      period: z.string().nullable(),
      gate: z.string(),
      detection: z.string(),
      model_eligible: z.literal(false),
    }),
  ),
  evaluations: z.array(
    z.object({
      rule_id: z.string(),
      rule_version: z.string(),
      title: z.string(),
      policy_source: z.string(),
      axis: z.string(),
      fact_id: z.string().uuid(),
      result: z.string(),
      severity: z.string().nullable(),
      event_relation: z.string().nullable(),
    }),
  ),
  severity_counts: z.record(z.string(), z.number()),
  limitations: z.array(z.string()),
  model_eligible: z.literal(false),
})
export function LiveSignals({ bundle }: { bundle: EvidenceBundle }) {
  const session = useContext(SessionContext)
  const owner =
    session?.phase === 'ready' ? session.session?.workspace_id : undefined
  const [offset, setOffset] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useQuery({
    queryKey: ['server', owner, bundle.bundle_id, 'signals', offset],
    enabled: !!owner,
    queryFn: async ({ signal }) => {
      const data = signalSchema.parse(
        await request(
          `/me/evidence-bundles/${bundle.bundle_id}/signals?offset=${offset}`,
          { signal },
        ),
      )
      if (data.bundle_id !== bundle.bundle_id)
        throw new Error('signal_bundle_mismatch')
      return data
    },
    retry: false,
  })
  const data = query.data
  return (
    <section className="panel" aria-label="현재 위험징후 규칙">
      <h2>현재 위험징후 규칙</h2>
      <p>
        승인된 사실의 원문·기간·충돌을 다시 확인해 규칙 입력을 준비합니다. 예측
        모델 투입과 담당자 최종 판단은 별도입니다.
      </p>
      <Button
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        규칙 입력 새로고침
      </Button>
      {query.isPending && <p>규칙 입력을 확인하고 있습니다.</p>}
      {query.isError && (
        <p role="alert">
          규칙 입력을 확인하지 못했습니다. 위험 없음으로 해석할 수 없습니다.
        </p>
      )}
      {data && (
        <>
          <p>
            {labels[data.evaluation_status] ?? data.evaluation_status} · 입력
            준비 {data.ready_inputs}/{data.total_facts}개 사실
          </p>
          {data.evaluations.length > 0 && (
            <p>
              {['WARNING', 'CAUTION', 'OBSERVATION']
                .map((k) => `${labels[k]} ${data.severity_counts[k] ?? 0}건`)
                .join(' · ')}{' '}
              · 설정된 규칙 범위
            </p>
          )}
          <ul>
            {data.categories.map((c) => (
              <li key={c.key}>
                <strong>{c.title}</strong> · {labels[c.status] ?? c.status} ·
                준비 {c.ready_inputs}개 · 정의된 규칙 {c.configured_rules}개
              </li>
            ))}
          </ul>
          {data.total_facts === 0 && (
            <p>
              규칙에 연결할 사실이 없습니다. 검색·추출 후 사실 검수가
              필요합니다.
            </p>
          )}
          {data.facts.map((f) => (
            <article key={f.fact_id}>
              <h3>{f.statement}</h3>
              <p>
                {labels[f.gate] ?? f.gate} · 기준 기간 {f.period ?? '미확인'} ·
                수정 {f.revision}차
              </p>
              <p>
                {f.detection === 'EXPLICITLY_NONE'
                  ? '해당 사실 범위의 명시적 없음 기재'
                  : '기재된 사실 · 사건 발생 여부는 규칙 정의에 따라 구분'}
              </p>
              <Button variant="outline" onClick={() => setSelected(f.fact_id)}>
                사실·검수 근거 보기
              </Button>
            </article>
          ))}
          {offset > 0 && (
            <Button onClick={() => setOffset(Math.max(0, offset - 30))}>
              이전 규칙 입력
            </Button>
          )}
          {data.next_offset !== null && (
            <Button onClick={() => setOffset(data.next_offset!)}>
              다음 규칙 입력
            </Button>
          )}
          {data.evaluations.map((e, i) => (
            <article key={`${e.rule_id}:${e.fact_id}:${i}`}>
              <h3>{e.title}</h3>
              <p>
                {labels[e.result] ?? e.result}
                {e.severity ? ` · ${labels[e.severity]}` : ''}
                {e.event_relation ? ` · ${labels[e.event_relation]}` : ''}
              </p>
              <p>
                {e.axis} · {e.rule_id} · 규칙 {e.rule_version}
              </p>
              <p>판정 기준: {e.policy_source}</p>
              <Button variant="ghost" onClick={() => setSelected(e.fact_id)}>
                판정 근거 확인
              </Button>
            </article>
          ))}
          {data.limitations.map((s) => (
            <p key={s}>{s}</p>
          ))}
          <details>
            <summary>규칙·입력 버전</summary>
            <p>{data.version}</p>
            <p>규칙 {data.registry_revision}</p>
            <p>입력 {data.input_revision}</p>
            <p>예측 모델 입력 보류</p>
          </details>
        </>
      )}
      {selected && (
        <FactReview
          key={selected}
          bundle={bundle}
          factId={selected}
          onSelect={setSelected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}
