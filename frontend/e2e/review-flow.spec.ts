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
  await expect(
    page.getByRole('table', { name: '주요 재무 계정' }),
  ).toBeVisible()
  await page.getByRole('link', { name: '기업 다시 선택' }).click()
  await expect(page.getByRole('button', { name: /한빛정밀/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByLabel('보고서')).toHaveValue('2024')
  await expect(page.getByRole('radio', { name: /별도/ })).toBeChecked()
  await page.reload()
  await expect(page.getByRole('button', { name: /한빛정밀/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await page.getByRole('button', { name: '예시 분석 열기' }).click()
  await expect(page.getByRole('img', { name: /예시 매출액/ })).toBeVisible()
  await page.getByRole('button', { name: /2025년/ }).click()
  await page.screenshot({
    path: testInfo.outputPath('financial-summary.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: /주석·위험징후/ }).click()
  await expect(page).toHaveURL(/evidence\?report=2024&scope=OFS/)
  await expect(
    page.getByRole('checkbox', {
      name: '약정 위반 사유 발생 문구 확인 · 담당자 확인',
    }),
  ).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('checkbox', {
      name: '약정 위반 사유 발생 문구 확인 · 담당자 확인',
    }),
  ).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await page.getByRole('button', { name: '예시 원문 확인 후 닫기' }).click()
  await page
    .getByRole('checkbox', {
      name: '약정 위반 사유 발생 문구 확인 · 담당자 확인',
    })
    .check()
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

test('shows classification reasons and prevents analysis of unresolved or excluded examples', async ({
  page,
}, testInfo) => {
  await page.goto('/')
  await expect(page.getByRole('button', { name: /누리렌탈/ })).toBeDisabled()
  await page.getByRole('button', { name: /다온산업/ }).click()
  await expect(
    page.getByRole('region', { name: '업종 판정 정보' }),
  ).toContainText('부문별 매출 근거')
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toBeDisabled()
  await page.getByRole('button', { name: /여울개발/ }).click()
  await expect(
    page.getByRole('region', { name: '업종 판정 정보' }),
  ).toContainText('미분류 상태를 유지')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('classification.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: '기업 선택 해제' }).click()
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toBeDisabled()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.goto('/analyses/demo-excluded/summary')
  await expect(
    page.getByRole('heading', { name: '분석 기준을 확인해 주세요' }),
  ).toBeVisible()
  await page.goto('/?company=demo-manufacturing&scope=INVALID')
  await expect(page.getByRole('alert')).toContainText(
    '분석 기준을 확인해 주세요',
  )
  await page.getByRole('button', { name: '분석 기준 초기화' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:5173/')
  await expect(
    page.getByRole('button', { name: '예시 분석 열기' }),
  ).toBeDisabled()
})
