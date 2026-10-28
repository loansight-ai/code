import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { CompanyPage } from '../pages/company-page'

vi.mock('../features/company/api', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../features/company/api')>()
  return {
    ...actual,
    getCompanyReports: vi.fn(async (corpCode: string) => ({
      corp_code: corpCode,
      items: [2025, 2024, 2023].map((year) => ({
        receipt_no: `${year + 1}0320000001`,
        report_name: `사업보고서 (${year}.12)`,
        fiscal_year: String(year),
        period: `${year}.12`,
        receipt_date: `${year + 1}-03-20`,
        withdrawn: false,
      })),
      checked_at: '2026-10-28T12:00:00Z',
      search_start: '19990101',
      search_end: '20261028',
    })),
  }
})

const company = {
  corp_code: '00126380',
  corp_name: '삼성전자',
  corp_eng_name: 'Samsung Electronics',
  stock_code: '005930',
  modify_date: '20261028',
  ksic11_code: '264',
  ksic11_name: '통신 및 방송장비 제조업',
  ksic11_level: 3,
  ksic11_status: 'matched',
  induty_code: null,
  corp_cls: 'Y',
  acc_mt: '12',
  industry: '제조',
}
function mount(initialEntry = '/') {
  const router = createMemoryRouter([{ path: '/', element: <CompanyPage /> }], {
    initialEntries: [initialEntry],
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

it('searches the server, preserves IME composition and selects a real company without demo analysis', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [company],
        total: 1,
        offset: 0,
        limit: 10,
      }),
      { status: 200 },
    ),
  )
  const user = userEvent.setup()
  const router = mount()
  await user.click(await screen.findByRole('button', { name: /삼성전자/ }))
  expect(screen.getByText('DART 고유번호: 00126380')).toBeVisible()
  expect(
    screen.getByText('KSIC 11차: 264 · 통신 및 방송장비 제조업'),
  ).toBeVisible()
  expect(screen.getByText('DART 원본 업종코드: 미확보')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /예시 분석 열기/ }),
  ).not.toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: '기업명 또는 종목코드' })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '삼성' } })
  expect(router.state.location.search).toBe('')
  fireEvent.compositionEnd(input, { data: '삼성' })
  await vi.waitFor(() => expect(router.state.location.search).toContain('q='))
  await vi.waitFor(() =>
    expect(fetcher).toHaveBeenLastCalledWith(
      expect.stringContaining('q=%EC%82%BC%EC%84%B1'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  )
})

it('restores the criteria panel, defaults to separate accounts and preserves criteria in the URL', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [company],
        total: 1,
        offset: 0,
        limit: 10,
      }),
      { status: 200 },
    ),
  )
  const user = userEvent.setup()
  const router = mount('/?q=삼성&industry=제조')
  const panel = within(screen.getByRole('region', { name: '분석 기준 선택' }))
  expect(panel.getByRole('combobox', { name: '보고서' })).toBeDisabled()
  expect(panel.getByRole('radio', { name: /별도/ })).toBeDisabled()
  await user.click(await screen.findByRole('button', { name: /삼성전자/ }))
  expect(panel.getByText('분류 확인')).toBeVisible()
  expect(panel.getByText('검토 업종: 제조')).toBeVisible()
  await vi.waitFor(() =>
    expect(panel.getByRole('combobox', { name: '보고서' })).toHaveValue(
      '20260320000001',
    ),
  )
  expect(panel.getByRole('radio', { name: /별도/ })).toBeChecked()
  await user.selectOptions(
    panel.getByRole('combobox', { name: '보고서' }),
    '20250320000001',
  )
  await user.click(panel.getByRole('radio', { name: /연결/ }))
  const params = new URLSearchParams(router.state.location.search)
  expect(params.get('report')).toBe('20250320000001')
  expect(params.get('scope')).toBe('CFS')
  expect(params.get('q')).toBe('삼성')
  expect(params.get('industry')).toBe('제조')
  await act(async () => {
    await router.navigate(-1)
  })
  expect(panel.getByRole('radio', { name: /별도/ })).toBeChecked()
  expect(
    panel.getByRole('button', { name: '원문 수집·주석 구조화' }),
  ).toBeDisabled()
  await user.click(panel.getByRole('button', { name: '기업 선택 해제' }))
  expect(panel.getByRole('combobox', { name: '보고서' })).toBeDisabled()
})

it.each([
  ['unmatched', null, '미분류'],
  ['review_required', '제조', '재검토 필요'],
  ['matched', null, '검토 업종 미확정'],
])('keeps %s classification unresolved', async (status, industry, expected) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [{ ...company, ksic11_status: status, industry }],
        total: 1,
        offset: 0,
        limit: 10,
      }),
      { status: 200 },
    ),
  )
  mount()
  await userEvent
    .setup()
    .click(await screen.findByRole('button', { name: /삼성전자/ }))
  const classification = within(
    screen.getByRole('region', { name: '업종 판정 정보' }),
  )
  expect(classification.getByText(expected)).toBeVisible()
  expect(classification.queryByText('분류 확인')).not.toBeInTheDocument()
})

it('restores URL criteria and resets invalid criteria without clearing the search', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [company],
        total: 1,
        offset: 0,
        limit: 10,
      }),
      { status: 200 },
    ),
  )
  const router = mount('/?q=삼성&report=2023&scope=CFS')
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: /삼성전자/ }))
  await vi.waitFor(() =>
    expect(screen.getByRole('combobox', { name: '보고서' })).toHaveValue(
      '20240320000001',
    ),
  )
  expect(screen.getByRole('radio', { name: /연결/ })).toBeChecked()
  await act(async () => {
    await router.navigate('/?q=삼성&report=invalid&scope=invalid')
  })
  expect(await screen.findByText('분석 기준을 확인해 주세요')).toBeVisible()
  await user.click(screen.getByRole('button', { name: '분석 기준 초기화' }))
  expect(screen.getByRole('combobox', { name: '보고서' })).toHaveValue(
    '20260320000001',
  )
  expect(screen.getByRole('radio', { name: /별도/ })).toBeChecked()
  expect(new URLSearchParams(router.state.location.search).get('q')).toBe(
    '삼성',
  )
})

it('restores all four industry filters, resets pagination and preserves the search', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost')
      return new Response(
        JSON.stringify({
          items: [company],
          total: 100,
          offset: Number(url.searchParams.get('offset')),
          limit: 10,
        }),
        { status: 200 },
      )
    })
  const user = userEvent.setup()
  const router = mount('/?q=삼성&offset=30')
  await screen.findByRole('button', { name: /삼성전자/ })
  for (const industry of ['제조', '건설', '도소매', '부동산 임대']) {
    await user.click(screen.getByRole('button', { name: industry }))
    await vi.waitFor(() => {
      const url = new URL(
        String(fetcher.mock.lastCall?.[0]),
        'http://localhost',
      )
      expect(url.searchParams.get('industry')).toBe(industry)
      expect(url.searchParams.get('offset')).toBe('0')
      expect(url.searchParams.get('limit')).toBe('10')
      expect(url.searchParams.get('q')).toBe('삼성')
    })
    expect(screen.getByRole('button', { name: industry })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  }
  await user.click(screen.getByRole('button', { name: '다음' }))
  expect(
    new URLSearchParams(router.state.location.search).get('industry'),
  ).toBe('부동산 임대')
  expect(new URLSearchParams(router.state.location.search).get('offset')).toBe(
    '10',
  )
  await user.click(screen.getByRole('button', { name: '전체' }))
  await vi.waitFor(() =>
    expect(
      new URL(
        String(fetcher.mock.lastCall?.[0]),
        'http://localhost',
      ).searchParams.has('industry'),
    ).toBe(false),
  )
})

it('distinguishes request failure from no results and retries successfully', async () => {
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'dart_api_key_missing' }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({ items: [], total: 0, offset: 0, limit: 10 }),
        { status: 200 },
      ),
    )
  mount()
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '기업 목록을 불러오지 못했습니다.',
  )
  expect(screen.queryByText('검색 결과가 없습니다')).not.toBeInTheDocument()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '다시 시도' }))
  expect(await screen.findByText('검색 결과가 없습니다')).toBeVisible()
  expect(fetcher).toHaveBeenCalledTimes(2)
})
