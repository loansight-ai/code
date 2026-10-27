import { expect, test } from '@playwright/test'

test('real API restores user and tasks, streams completion, and synchronizes acknowledgement across tabs', async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    process.env.LOANSIGHT_LIVE_API !== '1',
    'Requires running Compose backend and LOANSIGHT_LIVE_API=1',
  )
  await page.goto('/')
  await page.getByRole('button', { name: '코드로 접속', exact: true }).click()
  await page.getByRole('button', { name: '새 코드 발급' }).click()
  const current = page.getByText(/현재 사용자 코드:/)
  await expect(current).toContainText(/[0-9]{5}/)
  const code = (await current.innerText()).match(/[0-9]{5}/)![0]
  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: /내 분석 작업/ }).click()
  await expect(page.getByRole('status')).toHaveText('실시간 연결됨')
  await page.getByRole('button', { name: '연결 점검 실행' }).click()
  await expect(
    page.getByRole('button', { name: '종료 알림 확인' }),
  ).toBeVisible({ timeout: 30_000 })
  await page.reload()
  await expect(
    page.getByRole('button', { name: `사용자 ${code}` }),
  ).toBeVisible()
  await page.getByRole('button', { name: /내 분석 작업/ }).click()
  await expect(
    page.getByRole('button', { name: '종료 알림 확인' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '작업 상세 보기' }).click()
  await expect(page.getByRole('region', { name: '작업 상세' })).toContainText(
    '"financial_analysis_performed": false',
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('session-tasks.png'),
    fullPage: true,
  })

  const second = await context.newPage()
  await second.goto('/')
  await second.getByRole('button', { name: /내 분석 작업/ }).click()
  await expect(second.getByRole('status')).toHaveText('실시간 연결됨')
  await page.getByRole('button', { name: '종료 알림 확인' }).click()
  await expect(
    second.getByLabel('내 작업 목록').getByRole('listitem'),
  ).toHaveCount(0)
  await second.close()

  await page.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: `사용자 ${code}` }).click()
  await page.getByRole('button', { name: '로그아웃', exact: true }).click()
  await page.getByLabel('사용자 코드').fill(code)
  await page.getByRole('button', { name: '코드로 재접속' }).click()
  await expect(page.getByText(/현재 사용자 코드:/)).toContainText(code)
})
