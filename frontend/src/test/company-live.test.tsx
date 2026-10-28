import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { CompanyPage } from '../pages/company-page'

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
