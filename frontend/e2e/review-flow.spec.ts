import { expect, test } from '@playwright/test'

test('company selection, analysis navigation, source confirmation and local memo restore', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toBeDisabled()
  await page.screenshot({
    path: testInfo.outputPath('company-search.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: /한빛정밀/ }).click()
  await page.getByLabel('보고서').selectOption('2024')
  await page.getByRole('radio', { name: /별도/ }).check()
  await page.getByRole('button', { name: '예시 분석 열기' }).click()
  await expect(page).toHaveURL(/summary\?report=2024&scope=OFS/)
  await expect(page.getByRole('table')).toBeVisible()
  await expect(page.getByRole('img', { name: /예시 매출액/ })).toBeVisible()
  await page.getByRole('button', { name: /2025년/ }).click()
  await page.screenshot({
    path: testInfo.outputPath('financial-summary.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: /주석·위험징후/ }).click()
  await expect(page).toHaveURL(/evidence\?report=2024&scope=OFS/)
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('checkbox')).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await page.getByRole('button', { name: '예시 원문 확인 후 닫기' }).click()
  await page.getByRole('checkbox').check()
  await page.getByRole('link', { name: /담당자 검토/ }).click()
  await page.getByLabel('검토 메모').fill('추가 확인할 사항을 기록합니다.')
  await page.getByRole('button', { name: '브라우저에 저장' }).click()
  await page.reload()
  await expect(page.getByLabel('검토 메모')).toHaveValue(
    '추가 확인할 사항을 기록합니다.',
  )
  await page.getByRole('link', { name: /12개월 위험 예측/ }).click()
  await expect(page.getByText('예측 보류')).toBeVisible()
  await page.getByRole('button', { name: '내 분석 작업' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    '연결된 분석 작업이 없습니다',
  )
  expect(errors).toEqual([])
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
