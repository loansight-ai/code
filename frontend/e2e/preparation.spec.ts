import { expect, test } from '@playwright/test'

test('manual-input and industry drafts keep provenance, history and original analysis separate', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?company=demo-manufacturing&report=2025&scope=CFS')
  const preparation = page.getByRole('region', {
    name: '직접 입력·업종 변경 초안',
  })
  const manualOpener = preparation.getByRole('button', {
    name: '직접 입력 초안',
  })
  await manualOpener.click()
  let dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '브라우저에 초안 저장' }).click()
  await expect(dialog.getByText('출처를 입력해 주세요.')).toBeVisible()
  await expect(
    dialog.getByText('유효한 재무 기준일을 입력해 주세요.'),
  ).toBeVisible()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('textbox', { name: /^매출액/ }).fill('1,300')
  await dialog.getByRole('textbox', { name: /^영업이익/ }).fill('-15.50')
  await dialog
    .getByRole('textbox', { name: /^출처/ })
    .fill('회사 제출 감사보고서 12쪽')
  await dialog.getByLabel(/재무 기준일/).fill('2025-12-31')
  await dialog.getByRole('button', { name: '브라우저에 초안 저장' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(manualOpener).toBeFocused()
  const comparison = preparation.getByRole('region', {
    name: '예시 원본과 직접 입력 비교',
  })
  await expect(
    comparison.getByRole('cell', { name: '1,250', exact: true }),
  ).toBeVisible()
  await expect(
    comparison.getByRole('cell', { name: '1,300', exact: true }),
  ).toBeVisible()
  await expect(
    comparison.getByRole('cell', { name: '미입력', exact: true }),
  ).toBeVisible()
  await page.reload()
  await expect(comparison.getByText('1,300')).toBeVisible()
  await manualOpener.click()
  dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await dialog.getByRole('checkbox').check()
  await dialog.getByRole('textbox', { name: /^매출액/ }).fill('1,400')
  await dialog.getByRole('button', { name: '브라우저에 초안 저장' }).click()
  await preparation.getByText('로컬 초안 이력 (2)', { exact: true }).click()
  await expect(preparation.locator('.draft-history li')).toHaveCount(2)
  await expect(preparation.locator('.draft-history li').first()).toContainText(
    '1,300',
  )
  await preparation.getByRole('button', { name: '업종 변경 초안' }).click()
  dialog = page.getByRole('dialog')
  await dialog
    .getByRole('combobox', { name: /^변경할 업종/ })
    .selectOption('건설')
  await dialog
    .getByRole('textbox', { name: /^변경 사유/ })
    .fill('사업 구조 변경 여부 확인')
  await dialog
    .getByRole('textbox', { name: /^변경 근거/ })
    .fill('예시 보고서 사업 부문 10쪽')
  await dialog.getByRole('button', { name: '브라우저에 초안 저장' }).click()
  await expect(preparation.getByText('업종 변경 초안 · 미적용')).toBeVisible()
  await expect(
    preparation.getByText('로컬 초안 이력 (3)', { exact: true }),
  ).toBeVisible()
  await manualOpener.click()
  await page.keyboard.press('Escape')
  await expect(manualOpener).toBeFocused()
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('.preparation-panel')!.getBoundingClientRect()
        .top +
        window.scrollY -
        90,
    ),
  )
  await page.screenshot({ path: testInfo.outputPath('preparation-drafts.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  // Saving an industry proposal does not replace the current analysis snapshot.
  await page.getByRole('button', { name: '예시 분석 열기' }).click()
  await expect(page.locator('.source-strip')).toContainText('제조')
  await expect(
    page.locator('.metric').filter({ hasText: '매출액' }),
  ).toContainText('1,250')
  await page.goto('/?company=demo-manufacturing&report=2024&scope=CFS')
  await expect(
    preparation.getByText('로컬 초안 이력 (0)', { exact: true }),
  ).toBeVisible()
  expect(errors).toEqual([])
})
