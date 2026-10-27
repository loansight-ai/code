import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { CompanyPreparation } from '../features/company/company-preparation'
import { companies } from '../features/company/demo-data'
import {
  appendPreparation,
  canonicalAmount,
  DraftConflictError,
  manualSchema,
  preparationKey,
  readPreparation,
  type ManualDraft,
} from '../features/company/preparation-model'

const key = preparationKey('demo-manufacturing', '2025', 'CFS')
const valid: ManualDraft = {
  disclosureUnavailable: true,
  source: '회사 제출 감사보고서 12쪽',
  asOf: '2025-12-31',
  revenue: '1,300',
  operatingProfit: '-15.50',
  operatingCashflow: '',
}
function mount(company = companies[0]) {
  return render(
    <CompanyPreparation company={company} report="2025" scope="CFS" />,
  )
}
async function fillManual(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('checkbox'))
  await user.type(
    screen.getByRole('textbox', { name: /^매출액/ }),
    valid.revenue,
  )
  await user.type(
    screen.getByRole('textbox', { name: /^영업이익/ }),
    valid.operatingProfit,
  )
  await user.type(screen.getByRole('textbox', { name: /^출처/ }), valid.source)
  fireEvent.change(screen.getByLabelText(/재무 기준일/), {
    target: { value: valid.asOf },
  })
}

it('requires provenance and an explicit demo availability acknowledgement before storing a manual draft', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '직접 입력 초안' }))
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(await screen.findByText('출처를 입력해 주세요.')).toBeVisible()
  expect(screen.getByText('유효한 재무 기준일을 입력해 주세요.')).toBeVisible()
  expect(localStorage.getItem(key)).toBeNull()
  await fillManual(user)
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(
    await screen.findByText(/이 브라우저에 초안을 저장했습니다/),
  ).toBeVisible()
  const comparison = screen.getByRole('region', {
    name: '예시 원본과 직접 입력 비교',
  })
  expect(within(comparison).getByText('1,250')).toBeVisible()
  expect(within(comparison).getByText('1,300')).toBeVisible()
  expect(within(comparison).getByText('미입력')).toBeVisible()
  const saved = readPreparation(key)[0]
  expect(saved.kind === 'manual' && saved.value.operatingCashflow).toBe('')
  expect(
    readPreparation(preparationKey('demo-manufacturing', '2024', 'CFS')),
  ).toEqual([])
  expect(
    readPreparation(preparationKey('demo-manufacturing', '2025', 'OFS')),
  ).toEqual([])
  expect(
    readPreparation(preparationKey('demo-construction', '2025', 'CFS')),
  ).toEqual([])
})

it('does not store cancelled changes and restores focus to the opener', async () => {
  const user = userEvent.setup()
  mount()
  const opener = screen.getByRole('button', { name: '직접 입력 초안' })
  await user.click(opener)
  await user.type(
    screen.getByRole('textbox', { name: /^출처/ }),
    '저장하지 않은 내용',
  )
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(localStorage.getItem(key)).toBeNull()
  await vi.waitFor(() => expect(opener).toHaveFocus())
  await user.click(opener)
  expect(screen.getByRole('textbox', { name: /^출처/ })).toHaveValue('')
})

it('requires industry, reason and evidence and keeps the original classification unchanged', async () => {
  const user = userEvent.setup()
  const mixed = companies.find((company) => company.id === 'demo-mixed')!
  mount(mixed)
  await user.click(screen.getByRole('button', { name: '업종 변경 초안' }))
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(await screen.findByText('변경 사유를 입력해 주세요.')).toBeVisible()
  expect(screen.getByText('변경 근거를 입력해 주세요.')).toBeVisible()
  await user.selectOptions(
    screen.getByRole('combobox', { name: /^변경할 업종/ }),
    '제조',
  )
  await user.type(
    screen.getByRole('textbox', { name: /^변경 사유/ }),
    '제조 부문 근거 확인 예정',
  )
  await user.type(
    screen.getByRole('textbox', { name: /^변경 근거/ }),
    '사업보고서 부문별 매출 10쪽',
  )
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(await screen.findByText('업종 변경 초안 · 미적용')).toBeVisible()
  expect(mixed.industry).toBeNull()
  expect(mixed.classification).toBe('복합')
  const saved = readPreparation(preparationKey(mixed.id, '2025', 'CFS'))[0]
  expect(saved.kind === 'industry' && saved.value.previousIndustry).toBeNull()
  await user.click(screen.getByRole('button', { name: '업종 변경 초안' }))
  await user.selectOptions(screen.getByRole('combobox'), '제조')
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(
    await screen.findByText('현재 초안과 다른 업종을 선택해 주세요.'),
  ).toBeVisible()
})

it('keeps input editable when storage fails and does not claim a successful save', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '직접 입력 초안' }))
  await fillManual(user)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota')
  })
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(await screen.findByText(/초안을 저장하지 못했습니다/)).toBeVisible()
  expect(screen.getByRole('dialog')).toBeVisible()
  expect(screen.getByRole('textbox', { name: /^출처/ })).toHaveValue(
    valid.source,
  )
  expect(localStorage.getItem(key)).toBeNull()
})

it('protects a newer local draft from stale editor saves without losing unsaved input', async () => {
  const user = userEvent.setup()
  mount()
  await user.click(screen.getByRole('button', { name: '직접 입력 초안' }))
  await fillManual(user)
  appendPreparation(key, null, {
    kind: 'manual',
    value: { ...valid, source: '다른 화면의 최신 출처' },
  })
  await user.click(screen.getByRole('button', { name: '브라우저에 초안 저장' }))
  expect(
    await screen.findByText(/다른 화면에서 초안이 변경되었습니다/),
  ).toBeVisible()
  expect(screen.getByRole('textbox', { name: /^출처/ })).toHaveValue(
    valid.source,
  )
  expect(readPreparation(key)).toHaveLength(1)
  const saved = readPreparation(key)[0]
  expect(saved.kind === 'manual' && saved.value.source).toBe(
    '다른 화면의 최신 출처',
  )
})

it('does not overwrite malformed local drafts or report them as an empty history', () => {
  localStorage.setItem(key, '{broken')
  mount()
  expect(screen.getByRole('alert')).toHaveTextContent(
    '로컬 초안을 읽지 못했습니다',
  )
  expect(screen.getByRole('button', { name: '직접 입력 초안' })).toBeDisabled()
  expect(screen.queryByText('로컬 초안 이력 (0)')).not.toBeInTheDocument()
  expect(localStorage.getItem(key)).toBe('{broken')
})

it('validates calendar dates and numeric notation while preserving large amounts and missing values', () => {
  expect(manualSchema.safeParse({ ...valid, asOf: '2025-02-30' }).success).toBe(
    false,
  )
  expect(manualSchema.safeParse({ ...valid, revenue: '1,,250' }).success).toBe(
    false,
  )
  expect(manualSchema.safeParse({ ...valid, revenue: '1e3' }).success).toBe(
    false,
  )
  expect(manualSchema.safeParse({ ...valid, source: '  ' }).success).toBe(false)
  expect(canonicalAmount('9,007,199,254,740,993.00')).toBe('9007199254740993')
  expect(canonicalAmount('-0.50')).toBe('-0.5')
  expect(canonicalAmount('')).toBeNull()
  expect(canonicalAmount('0')).toBe('0')
})

it('appends immutable history and rejects stale revisions', () => {
  const first = appendPreparation(key, null, { kind: 'manual', value: valid })
  const second = appendPreparation(key, first[0].id, {
    kind: 'manual',
    value: { ...valid, revenue: '1400' },
  })
  expect(second).toHaveLength(2)
  expect(second[0]).toEqual(first[0])
  expect(() =>
    appendPreparation(key, first[0].id, { kind: 'manual', value: valid }),
  ).toThrow(DraftConflictError)
  expect(readPreparation(key)).toHaveLength(2)
})
