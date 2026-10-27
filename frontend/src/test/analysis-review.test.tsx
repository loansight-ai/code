import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import type { DemoContext } from '../features/analysis/demo-context'
import { AnalysisPage } from '../pages/analysis-page'
import { ReviewWorkspace } from '../features/review/review-workspace'
import { SourceViewer } from '../features/evidence/source-viewer'
import * as store from '../features/review/review-store'

vi.mock('../features/financial/financial-view', () => ({
  FinancialView: () => <div>추세 예시</div>,
}))
vi.mock('../shared/components/chart', () => ({
  Chart: ({ label }: { label: string }) => (
    <div role="img" aria-label={label} />
  ),
}))
const context: DemoContext = {
  companyId: 'demo-manufacturing',
  companyName: '한빛정밀',
  industry: '제조',
  report: '2025',
  scope: 'CFS',
  lease: 'include',
}

function mountAnalysis(path: string) {
  const router = createMemoryRouter(
    [{ path: '/analyses/:analysisId/:section', element: <AnalysisPage /> }],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
  return router
}
function editedDraft(opinion = '담당자 의견'): store.ReviewDraft {
  const draft = store.initialDraft(context, opinion)
  return {
    ...draft,
    paragraphs: draft.paragraphs.map((paragraph) =>
      paragraph.id === 'core'
        ? { ...paragraph, text: '직접 수정한 핵심 수치 문단', edited: true }
        : paragraph,
    ),
  }
}

it('shows formula operands and missing-account reasons, and separates lease options in the URL', async () => {
  const user = userEvent.setup()
  const router = mountAnalysis('/analyses/demo-manufacturing/summary')
  await user.click(
    await screen.findByRole('button', { name: '유동비율 산식 보기' }),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('유동자산 300억원')
  expect(screen.getByRole('dialog')).toHaveTextContent('유동부채 200억원')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: '활동성' }))
  expect(
    screen.getByRole('table', { name: '핵심 재무 비율' }),
  ).toHaveTextContent('계산 불가')
  await user.click(
    screen.getByRole('button', { name: '재고자산 회전일수 산식 보기' }),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('매출원가 미확보')
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: '레버리지' }))
  expect(
    screen.getByRole('table', { name: '핵심 재무 비율' }),
  ).toHaveTextContent('100.0%')
  await user.click(
    screen.getByRole('checkbox', { name: '리스부채 포함 · 예시 옵션' }),
  )
  expect(router.state.location.search).toContain('lease=exclude')
  expect(
    screen.getByRole('table', { name: '핵심 재무 비율' }),
  ).toHaveTextContent('92.0%')
  await user.click(screen.getByRole('button', { name: '부채비율 산식 보기' }))
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '리스 제외 부채총계 460억원',
  )
  await act(() =>
    router.navigate(
      '/analyses/demo-manufacturing/summary?lease=include&ratio=레버리지',
    ),
  )
  expect(screen.getByRole('dialog')).toHaveTextContent('부채총계 500억원')
})

it('shows cashflow decomposition without turning missing working-capital data into zero days', async () => {
  mountAnalysis('/analyses/demo-manufacturing/cashflow')
  expect(
    await screen.findByRole('table', { name: '영업이익 변동 분해' }),
  ).toHaveTextContent('−42')
  expect(
    screen.getByRole('table', { name: '현금흐름 구성' }),
  ).toHaveTextContent('현금 순증감')
  const working = screen.getByRole('table', { name: '운전자본 자료 상태' })
  expect(working).toHaveTextContent('계산 불가')
  expect(within(working).queryByText('0일')).not.toBeInTheDocument()
})

it('filters risk signals, separates note detection states, and does not unlock the warning through unrelated evidence', async () => {
  const user = userEvent.setup()
  mountAnalysis('/analyses/demo-manufacturing/evidence')
  const warning = await screen.findByRole('checkbox', {
    name: /약정 위반.*담당자 확인/,
  })
  expect(warning).toBeDisabled()
  await user.click(screen.getByRole('button', { name: '예시 원문 열기' }))
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '보증 약정 · 가상 원문',
    }),
  )
  await user.click(
    screen.getByRole('button', { name: '예시 원문 확인 후 닫기' }),
  )
  expect(warning).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('판단 축'), '외부 평가')
  expect(screen.getByText('조건에 해당하는 예시 항목이 없습니다')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '징후 필터 초기화' }))
  await user.click(screen.getByRole('button', { name: '주석 추출 근거' }))
  expect(screen.getByText('공시상 없음 · 예시')).toBeVisible()
  expect(screen.getByText('미검출 · 예시')).toBeVisible()
  expect(screen.getByText('추출 실패 · 예시')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '소송/제재 근거 원문' }))
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '계류 중인 소송 및 제재는 없습니다',
  )
})

it('never records a source view when the source cannot be rendered', () => {
  const record = vi.fn(() => '')
  render(
    <SourceViewer
      sourceId="missing"
      onSourceChange={() => {}}
      onClose={() => {}}
      onViewed={record}
    />,
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    '해당 원문 구간을 찾지 못했습니다',
  )
  expect(
    screen.queryByRole('button', { name: '예시 원문 확인 후 닫기' }),
  ).not.toBeInTheDocument()
  expect(record).not.toHaveBeenCalled()
})

it('gates warning confirmations by matching evidence and isolates all review criteria', () => {
  expect(() =>
    store.saveChecks(context, null, {
      viewed: [],
      confirmed: ['demo-covenant'],
    }),
  ).toThrow()
  expect(() =>
    store.saveChecks(context, null, {
      viewed: ['guarantee'],
      confirmed: ['demo-covenant'],
    }),
  ).toThrow()
  const entry = store.saveChecks(context, null, {
    viewed: ['covenant'],
    confirmed: ['demo-covenant'],
  })
  expect(store.readChecks(context).at(-1)?.value.confirmed).toEqual([
    'demo-covenant',
  ])
  expect(store.readChecks({ ...context, lease: 'exclude' })).toEqual([])
  expect(store.readChecks({ ...context, report: '2024' })).toEqual([])
  expect(store.readChecks({ ...context, scope: 'OFS' })).toEqual([])
  expect(
    store.readChecks({ ...context, companyId: 'demo-construction' }),
  ).toEqual([])
  store.saveChecks(context, entry.id, { viewed: ['covenant'], confirmed: [] })
  expect(store.readChecks(context).at(-1)?.value.confirmed).toEqual([])
})

it('preserves edited paragraphs in keep mode and always preserves opinions and previous revisions', async () => {
  const first = store.saveDraft(context, null, editedDraft())
  const kept = await store.regenerateDemoDraft(context, first.value, 'keep')
  expect(
    kept.paragraphs.find((paragraph) => paragraph.id === 'core')?.text,
  ).toBe('직접 수정한 핵심 수치 문단')
  const all = await store.regenerateDemoDraft(context, kept, 'all')
  expect(
    all.paragraphs.find((paragraph) => paragraph.id === 'core')?.edited,
  ).toBe(false)
  expect(all.opinion).toBe('담당자 의견')
  const next = store.saveDraft(context, first.id, all, 'regenerate-all')
  expect(next.parentId).toBe(first.id)
  expect(store.readDrafts(context)[0]).toEqual(first)
  expect(() => store.saveDraft(context, first.id, first.value)).toThrow(
    store.ReviewConflictError,
  )
})

it('restores legacy memos without overwriting their keys and excludes them from another lease snapshot', () => {
  const legacyKey = 'loansight.demo.memo.demo-manufacturing.2025.CFS'
  localStorage.setItem(legacyKey, '기존 사용자 메모')
  const first = render(<ReviewWorkspace context={context} />)
  expect(screen.getByLabelText('검토 메모')).toHaveValue('기존 사용자 메모')
  expect(localStorage.getItem(legacyKey)).toBe('기존 사용자 메모')
  first.unmount()
  render(<ReviewWorkspace context={{ ...context, lease: 'exclude' }} />)
  expect(screen.getByLabelText('검토 메모')).toHaveValue('')
})

it('keeps local editing intact while comparing and merging a newer saved revision', async () => {
  const user = userEvent.setup()
  const first = store.saveDraft(
    context,
    null,
    store.initialDraft(context, '최초 의견'),
  )
  render(<ReviewWorkspace context={context} />)
  await user.clear(screen.getByLabelText('검토 메모'))
  await user.type(screen.getByLabelText('검토 메모'), '현재 창의 의견')
  const other = store.saveDraft(
    context,
    first.id,
    editedDraft('다른 창의 의견'),
  )
  await user.click(screen.getByRole('button', { name: '브라우저에 저장' }))
  expect(screen.getByRole('alert')).toHaveTextContent('충돌')
  expect(screen.getByLabelText('검토 메모')).toHaveValue('현재 창의 의견')
  await user.click(
    screen.getByRole('button', { name: '최신 저장본 비교·병합' }),
  )
  const dialog = screen.getByRole('dialog')
  const core = within(dialog).getByRole('group', { name: '핵심 수치' })
  await user.click(
    within(core).getByRole('radio', { name: '최신 저장본 사용' }),
  )
  await user.click(
    within(dialog).getByRole('button', { name: '선택한 내용으로 병합·저장' }),
  )
  const latest = store.readDrafts(context).at(-1)!
  expect(latest.parentId).toBe(other.id)
  expect(latest.value.opinion).toBe('현재 창의 의견')
  expect(
    latest.value.paragraphs.find((paragraph) => paragraph.id === 'core')?.text,
  ).toBe('직접 수정한 핵심 수치 문단')
  expect(store.readDrafts(context)).toHaveLength(3)
})

it('does not apply regeneration after new edits arrive during the request', async () => {
  let finish!: (value: store.ReviewDraft) => void
  vi.spyOn(store, 'regenerateDemoDraft').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const user = userEvent.setup()
  render(<ReviewWorkspace context={context} />)
  await user.click(screen.getByRole('button', { name: '초안 재생성 미리보기' }))
  await user.click(screen.getByRole('button', { name: '예시 템플릿 재적용' }))
  fireEvent.change(screen.getByLabelText('검토 메모'), {
    target: { value: '생성 도중 새 의견' },
  })
  await act(async () => finish(store.initialDraft(context)))
  expect(screen.getByRole('alert')).toHaveTextContent('새 편집이 생겼습니다')
  expect(screen.getByLabelText('검토 메모')).toHaveValue('생성 도중 새 의견')
  expect(store.readDrafts(context)).toEqual([])
})

it('keeps unsaved text on write failure and refuses to overwrite malformed records', async () => {
  const user = userEvent.setup()
  const first = render(<ReviewWorkspace context={context} />)
  await user.type(
    screen.getByLabelText('검토 메모'),
    '저장 실패 시 보존할 의견',
  )
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota')
    })
  await user.click(screen.getByRole('button', { name: '브라우저에 저장' }))
  expect(screen.getByRole('alert')).toHaveTextContent('편집 내용을 유지')
  expect(screen.getByLabelText('검토 메모')).toHaveValue(
    '저장 실패 시 보존할 의견',
  )
  write.mockRestore()
  first.unmount()
  const key = store.reviewKey(context, 'draft')
  localStorage.setItem(key, '{broken')
  render(<ReviewWorkspace context={context} />)
  expect(screen.getByRole('button', { name: '브라우저에 저장' })).toBeDisabled()
  expect(localStorage.getItem(key)).toBe('{broken')
})

it('copies context, versions, source locations and current edits without inventing model probabilities', () => {
  const text = store.copyReview(context, editedDraft(), {
    viewed: [],
    confirmed: [],
  })
  expect(text).toContain('실제 분석/AI 생성 아님')
  expect(text).toContain('CFS / 리스부채 포함')
  expect(text).toContain('demo-evidence-v2')
  expect(text).toContain('예시 주석 21 · 문단 2')
  expect(text).toContain('직접 수정한 핵심 수치 문단')
  expect(text).toContain('표시 보류')
  expect(text).not.toMatch(/\d+(\.\d+)?%/)
  expect(store.copyReview(context, editedDraft(), null)).toContain(
    '확인 기록 조회 실패',
  )
})

it('rejects duplicate confirmations and evidence from another revision without rewriting the stored record', () => {
  expect(() =>
    store.saveChecks(context, null, {
      viewed: [],
      confirmed: ['unknown-item'],
    }),
  ).toThrow()
  expect(() =>
    store.saveChecks(context, null, {
      viewed: ['covenant'],
      confirmed: ['demo-covenant', 'demo-covenant'],
    }),
  ).toThrow()
  const record = store.saveChecks(context, null, {
    viewed: ['covenant'],
    confirmed: ['demo-covenant'],
  })
  const key = store.reviewKey(context, 'checks')
  const obsolete = JSON.stringify([
    { ...record, evidenceRevision: 'old-revision' },
  ])
  localStorage.setItem(key, obsolete)
  expect(() => store.readChecks(context)).toThrow()
  expect(localStorage.getItem(key)).toBe(obsolete)
})
