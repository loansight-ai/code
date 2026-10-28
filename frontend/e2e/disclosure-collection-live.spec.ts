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
  await page.screenshot({
    path: testInfo.outputPath('dart-collection-complete.png'),
    fullPage: true,
    mask: [page.getByRole('button', { name: /사용자 \d{5}/ })],
  })
})
