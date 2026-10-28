import { expect, test } from '@playwright/test'

test('searches real DART codes and displays the selected company', async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.LOANSIGHT_LIVE_COMPANY_TEST !== '1',
    'Requires prepared DART API/cache',
  )
  await page.goto('/?q=005930')
  await page.getByRole('button', { name: /삼성전자.*00126380.*005930/ }).click()
  await expect(page.getByText('DART 고유번호: 00126380')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('dart-company-search.png'),
    fullPage: true,
  })
  const input = page.getByRole('textbox', { name: '기업명 또는 종목코드' })
  await input.fill('0068Y0')
  await expect(page.getByRole('button', { name: /0068Y0/ })).toBeVisible()
  await input.fill('존재하지않는기업검색검증xyz')
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible()
})
