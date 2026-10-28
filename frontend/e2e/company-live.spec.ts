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
    page.getByText('KSIC 11차: 264 · 통신 및 방송장비 제조업'),
  ).toBeVisible()
  await expect(page.getByText('DART 원본 업종코드: 미확보')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toHaveCount(0)
  const criteria = page.getByRole('region', { name: '분석 기준 선택' })
  await expect(criteria.getByText('검토 업종: 제조')).toBeVisible()
  await expect(criteria.getByRole('radio', { name: /별도/ })).toBeChecked()
  const reportSelect = criteria.getByRole('combobox', { name: '보고서' })
  await expect(criteria.getByText(/가장 오래된 보고서:/)).toBeVisible()
  await expect(
    criteria.getByText(
      /원본 ZIP\/XML과 선택한 회계 범위의 주석 HTML을 저장하고/,
    ),
  ).toBeVisible()
  const reportLabel = (
    await reportSelect.locator('option').allTextContents()
  ).find((label) => label.includes('2024.12'))!
  await reportSelect.selectOption({ label: reportLabel })
  await criteria.getByRole('radio', { name: /연결/ }).check()
  await expect(page).toHaveURL(/report=\d{14}/)
  await expect(page).toHaveURL(/scope=CFS/)
  await expect(
    criteria.getByRole('button', { name: '원문 수집·주석 구조화' }),
  ).toBeDisabled()
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
