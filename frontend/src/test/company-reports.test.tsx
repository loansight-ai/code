import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { expect, it, vi } from 'vitest'
import { CompanyReportSelect } from '../features/company/company-report-select'

function result(code = '00126380') {
  return {
    corp_code: code,
    items: [
      {
        receipt_no: '20260320000001',
        report_name: '사업보고서 (2025.12)',
        fiscal_year: '2025',
        period: '2025.12',
        receipt_date: '2026-03-20',
        withdrawn: false,
      },
      {
        receipt_no: '20200320000001',
        report_name: '[기재정정]사업보고서 (2019.03)',
        fiscal_year: '2019',
        period: '2019.03',
        receipt_date: '2020-03-20',
        withdrawn: false,
      },
    ],
    checked_at: '2026-10-28T12:00:00Z',
    search_start: '19990101',
    search_end: '20261028',
  }
}
function mount() {
  function Harness() {
    const [code, setCode] = useState('00126380')
    return (
      <>
        <button onClick={() => setCode('00000001')}>다른 기업</button>
        <CompanyReportSelect corpCode={code} />
      </>
    )
  }
  const router = createMemoryRouter([{ path: '/', element: <Harness /> }])
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

it('shows only returned fiscal years, historical range and receipt identity', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(result()), { status: 200 }),
  )
  const router = mount()
  expect(
    await screen.findByText('가장 오래된 보고서: 2019.03 결산'),
  ).toBeVisible()
  expect(
    screen.getByRole('option', { name: '사업보고서 (2025.12)' }),
  ).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: /2024/ })).not.toBeInTheDocument()
  await userEvent
    .setup()
    .selectOptions(
      screen.getByRole('combobox', { name: '보고서' }),
      '20200320000001',
    )
  expect(new URLSearchParams(router.state.location.search).get('report')).toBe(
    '20200320000001',
  )
  expect(screen.getByRole('link', { name: 'DART 원문 보기' })).toHaveAttribute(
    'href',
    expect.stringContaining('20200320000001'),
  )
})

it('distinguishes empty reports from failure and retries', async () => {
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ detail: 'dart_reports_unavailable' }), {
        status: 503,
      }),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ ...result(), items: [] }), { status: 200 }),
    )
  mount()
  expect(
    await screen.findByText('사업보고서를 불러오지 못했습니다'),
  ).toBeVisible()
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '사업보고서 다시 조회' }))
  expect(
    await screen.findByText(/선택 가능한 사업보고서가 DART 조회 범위에서/),
  ).toBeVisible()
  expect(screen.getByRole('combobox', { name: '보고서' })).toBeDisabled()
})

it('does not show another company reports while its request is loading', async () => {
  let finish: ((value: Response) => void) | undefined
  vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify(result()), { status: 200 }),
    )
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
  mount()
  await screen.findByText('가장 오래된 보고서: 2019.03 결산')
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: '다른 기업' }))
  expect(screen.queryByRole('option', { name: /2025/ })).not.toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: '보고서' })).toBeDisabled()
  finish!(
    new Response(JSON.stringify({ ...result('00000001'), items: [] }), {
      status: 200,
    }),
  )
  expect(
    await screen.findByText(/선택 가능한 사업보고서가 DART 조회 범위에서/),
  ).toBeVisible()
})
