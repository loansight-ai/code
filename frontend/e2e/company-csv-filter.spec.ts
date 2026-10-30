import { expect, test } from '@playwright/test'

test('CSV filter is sent to server, survives reload and combines with market', async ({
  page,
}, testInfo) => {
  const requests: URL[] = []
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/companies')) {
      requests.push(url)
      return route.fulfill({
        json: {
          items: [],
          total: 0,
          offset: Number(url.searchParams.get('offset') ?? 0),
          limit: 10,
        },
      })
    }
    return route.fulfill({ status: 401, json: { detail: 'session_required' } })
  })
  await page.goto('/?q=삼성&market=Y&offset=10')
  const filter = page.getByRole('checkbox', {
    name: 'CSV 재무 데이터 보유 기업만',
  })
  await expect(filter).not.toBeChecked()
  await filter.click()
  await expect(filter).toBeChecked()
  await expect
    .poll(() => requests.at(-1)?.searchParams.get('collected_only'))
    .toBe('true')
  expect(requests.at(-1)?.searchParams.get('market')).toBe('Y')
  expect(requests.at(-1)?.searchParams.get('q')).toBe('삼성')
  expect(requests.at(-1)?.searchParams.get('offset')).toBe('0')
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible()
  await page.reload()
  await expect(filter).toBeChecked()
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('company-csv-filter.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true)
  await filter.click()
  await expect(filter).not.toBeChecked()
  await expect
    .poll(() => requests.at(-1)?.searchParams.has('collected_only'))
    .toBe(false)
})
