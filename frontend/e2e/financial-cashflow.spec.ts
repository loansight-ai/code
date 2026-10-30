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
  await expect(
    page.getByRole('img', { name: /^이익에서 현금 브리지/ }),
  ).toBeVisible()
  const explanation = page.getByRole('button', { name: '차이 설명 표 펼치기' })
  await explanation.click()
  await expect(
    page.getByRole('table', { name: '이익 현금 차이 설명' }),
  ).toContainText('-534')
  await expect(
    page.getByRole('table', { name: '이익 현금 차이 설명' }),
  ).toContainText('근사')
  await page.getByRole('button', { name: '차이 설명 표 접기' }).click()
  await expect(
    page.getByRole('heading', { name: '운전자본 · 건설' }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^운전자본 전기 당기 일수 비교/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('table', { name: '현금흐름 확인 항목' }),
  ).toContainText('-310억')
  await page.getByText('일수·자료 상태 보기').click()
  await expect(
    page.getByRole('table', { name: '운전자본 일수 자료 상태' }),
  ).toContainText('142일')
  await page.getByText('일수·자료 상태 보기').click()
  await expect(
    page.getByRole('img', { name: /^현금흐름 구성 워터폴/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('img', { name: /^영업이익률 업종 비교/ }),
  ).toHaveAttribute('aria-label', expect.stringContaining('4.5%'))
  await page.getByRole('tab', { name: '부채비율', exact: true }).click()
  await expect(
    page.getByRole('img', { name: /^부채비율 업종 비교/ }),
  ).toBeVisible()
  await page
    .getByRole('tab', { name: '영업CF ÷ 영업이익', exact: true })
    .click()
  await expect(
    page.getByRole('img', { name: /^영업CF ÷ 영업이익 업종 비교/ }),
  ).toBeVisible()
  await page.getByRole('tab', { name: '영업이익률', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
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
