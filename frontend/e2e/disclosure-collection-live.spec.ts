import { expect, test } from '@playwright/test'

test('collects actual DART ZIP/XML and viewer notes then completes the parser job', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LOANSIGHT_LIVE_COLLECTION_TEST !== '1',
    'Requires live Compose and verified DART source',
  )
  await page.goto('/?q=01214248')
  const response = await page.request.post('/api/v1/users', {
    data: {},
    headers: { Origin: new URL(page.url()).origin },
  })
  expect(response.status()).toBe(201)
  await page.reload()
  await page.getByRole('button', { name: /뉴트리.*01214248/ }).click()
  const criteria = page.getByRole('region', { name: '분석 기준 선택' })
  await expect(criteria.getByText(/가장 오래된 보고서:/)).toBeVisible()
  if (testInfo.project.name === 'tablet') {
    await criteria.getByRole('radio', { name: /연결/ }).check()
    await expect(page).toHaveURL(/scope=CFS/)
  }
  const collect = criteria.getByRole('button', {
    name: '원문 수집·주석 구조화',
  })
  await expect(collect).toBeEnabled()
  await collect.click()
  await expect(criteria.getByText(/원문 저장·주석 구조화 완료/)).toBeVisible({
    timeout: 45_000,
  })
  await expect(criteria.getByText(/원문 ZIP.*주석 HTML.*보존/)).toBeVisible()
  await page.getByRole('button', { name: /내 분석 작업/ }).click()
  await expect(page.getByRole('list', { name: '내 작업 목록' })).toContainText(
    'DART 원문 수집',
  )
  await expect(page.getByRole('list', { name: '내 작업 목록' })).toContainText(
    '주석 구조화',
  )
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await criteria.getByRole('link', { name: '주석 결과 보기' }).click()
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/)
  await expect(
    page.getByRole('heading', { name: '주석 확인과 위험징후', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('내용 검수 전', { exact: true })).toBeVisible()
  const baseline = page.getByRole('region', { name: '공통 주석 근거 검색' })
  await baseline.getByRole('button', { name: '6항목 기본 검색' }).click()
  await expect(
    baseline.getByRole('group', { name: '검색 항목' }).getByRole('button'),
  ).toHaveCount(6)
  await baseline.getByRole('button', { name: /차입 만기·재무약정/ }).click()
  await expect(
    baseline.getByRole('button', { name: '원문에서 확인' }),
  ).toHaveCount(5)
  await baseline.getByRole('button', { name: '후보 더 보기' }).click()
  await expect(
    baseline.getByRole('button', { name: '원문에서 확인' }),
  ).toHaveCount(10)
  await baseline.getByRole('button', { name: '원문에서 확인' }).first().click()
  await expect(page).toHaveURL(/segment=[0-9a-f-]{36}/)
  const original = page.frameLocator('iframe[title="저장된 주석 원문"]')
  await expect(original.locator('body')).toContainText('주석')
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await page.getByRole('checkbox', { name: '표만 보기' }).check()
  const table = page
    .getByRole('region', { name: '주석 구간 목록' })
    .getByRole('button', { name: /표 · 구간/ })
    .first()
  await table.click()
  await expect(original.locator('.source-active')).toHaveCount(1)
  await expect(original.locator('.source-active')).toBeVisible()
  await expect(page).toHaveURL(/segment=[0-9a-f-]{36}/)
  await page.reload()
  await expect(
    baseline.getByRole('group', { name: '검색 항목' }).getByRole('button'),
  ).toHaveCount(6)
  await expect(
    page
      .frameLocator('iframe[title="저장된 주석 원문"]')
      .locator('.source-active'),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('dart-collection-complete.png'),
    fullPage: true,
    mask: [page.getByRole('button', { name: /사용자 \d{5}/ })],
  })
})
