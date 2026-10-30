import { expect, test } from '@playwright/test'

test('cashflow example uses both financial charts with verified table data and responsive layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 401, json: { detail: 'session_required' } }),
  )
  await page.goto('/examples/financial-summary')
  await page
    .getByRole('navigation', { name: '기업 분석' })
    .getByRole('link', { name: '실적 변동·현금흐름', exact: true })
    .click()
  await expect(page).toHaveURL(/examples\/financial-cashflow/)
  await expect(
    page.getByRole('img', { name: /^영업이익 변동 워터폴/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^비교기간별 영업이익과/ }),
  ).toBeVisible()
  await expect(page.getByText(/영업CF는.*-310억원으로 음수 전환/)).toBeVisible()
  await page.getByText('분해 금액·검산 보기').click()
  const table = page.getByRole('table', { name: '영업이익 변동 분해 금액' })
  await expect(table).toContainText('+820')
  await expect(table).toContainText('-1,010')
  await expect(table).toContainText('-27')
  await page.getByText('분해 금액·검산 보기').click()
  await page.screenshot({
    path: testInfo.outputPath('cashflow-panels.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('heading', { name: '영업이익 변동 분해' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  await page.screenshot({
    path: testInfo.outputPath('cashflow-mobile.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})
