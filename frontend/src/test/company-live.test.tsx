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
}
function mount() {
  const router = createMemoryRouter([{ path: '/', element: <CompanyPage /> }])
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
        limit: 30,
      }),
      { status: 200 },
    ),
  )
  const user = userEvent.setup()
  const router = mount()
  await user.click(await screen.findByRole('button', { name: /삼성전자/ }))
  expect(screen.getByText('DART 고유번호: 00126380')).toBeVisible()
  expect(
    screen.queryByRole('button', { name: /예시 분석 열기/ }),
  ).not.toBeInTheDocument()
  const input = screen.getByRole('textbox', { name: '기업명 또는 종목코드' })
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '삼성' } })
  expect(router.state.location.search).toBe('')
  fireEvent.compositionEnd(input, { data: '삼성' })
  await vi.waitFor(() => expect(router.state.location.search).toContain('q='))
  expect(fetcher).toHaveBeenLastCalledWith(
    expect.stringContaining('q=%EC%82%BC%EC%84%B1'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
        JSON.stringify({ items: [], total: 0, offset: 0, limit: 30 }),
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
