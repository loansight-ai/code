import { expect, test } from '@playwright/test'

test('financial formulas, cashflow, evidence and review generation remain consistent across navigation', async ({
  page,
  context,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/analyses/demo-manufacturing/summary?report=2025&scope=CFS')
  await page.getByRole('button', { name: '유동비율 산식 보기' }).click()
  await expect(page.getByRole('dialog')).toContainText('유동부채 200억원')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '활동성', exact: true }).click()
  await expect(
    page.getByRole('table', { name: '핵심 재무 비율' }),
  ).toContainText('자료 없음')
  await page.getByRole('button', { name: '레버리지', exact: true }).click()
  await page
    .getByRole('checkbox', { name: '리스부채 포함 · 예시 옵션' })
    .click()
  await expect(page).toHaveURL(/lease=exclude/)
  await expect(
    page.getByRole('checkbox', { name: '리스부채 포함 · 예시 옵션' }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('table', { name: '핵심 재무 비율' }),
  ).toContainText('92.0%')
  await page.getByRole('link', { name: /실적 변동·현금흐름/ }).click()
  await expect(
    page.getByRole('table', { name: '영업이익 변동 분해' }),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: /3개년 예시/ })).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('cashflow.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: /주석·위험징후/ }).click()
  await page.getByLabel('판단 축').selectOption('외부 평가')
  await expect(
    page.getByText('조건에 해당하는 예시 항목이 없습니다'),
  ).toBeVisible()
  await page.getByRole('button', { name: '징후 필터 초기화' }).click()
  const warning = page.getByRole('checkbox', { name: /약정 위반.*담당자 확인/ })
  await expect(warning).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '보증 약정 · 가상 원문' })
    .click()
  await page.getByRole('button', { name: '예시 원문 확인 후 닫기' }).click()
  await expect(warning).toBeDisabled()
  await page.getByRole('button', { name: '예시 원문 열기' }).click()
  await page.getByRole('button', { name: '예시 원문 확인 후 닫기' }).click()
  await warning.check()
  await page
    .getByRole('button', { name: '주석 추출 근거', exact: true })
    .click()
  await expect(page.getByText('공시상 없음 · 예시')).toBeVisible()
  await expect(page.getByText('추출 실패 · 예시')).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('evidence-notes.png'),
    fullPage: true,
  })
  await page.getByRole('link', { name: /체크·검토 메모/ }).click()
  await expect(
    page.getByRole('checkbox', { name: /약정 위반.*담당자 확인/ }),
  ).toBeChecked()
  await page
    .getByLabel('핵심 수치', { exact: true })
    .fill('담당자가 수정한 핵심 수치 예시')
  await page
    .getByLabel('검토 메모', { exact: true })
    .fill('재생성 후에도 보존할 의견')
  await page.getByRole('button', { name: '브라우저에 저장' }).click()
  await page.getByRole('button', { name: '초안 재생성 미리보기' }).click()
  await page.getByRole('radio', { name: '수정한 문단 유지' }).check()
  await page.getByRole('button', { name: '예시 템플릿 재적용' }).click()
  await expect(page.getByLabel('핵심 수치', { exact: true })).toHaveValue(
    '담당자가 수정한 핵심 수치 예시',
  )
  await page.getByRole('button', { name: '초안 재생성 미리보기' }).click()
  await page.getByRole('radio', { name: '자동 초안 영역 전체 재생성' }).check()
  await page.getByRole('button', { name: '예시 템플릿 재적용' }).click()
  await expect(page.getByLabel('핵심 수치', { exact: true })).toHaveValue(
    /1,250억원/,
  )
  await expect(page.getByLabel('검토 메모')).toHaveValue(
    '재생성 후에도 보존할 의견',
  )
  await expect(
    page.getByText('저장된 버전 3개', { exact: false }),
  ).toBeVisible()
  await page.getByRole('button', { name: '복사', exact: true }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toContain('리스부채 제외')
  expect(copied).toContain('예시 주석 21 · 문단 2')
  expect(copied).toContain('재생성 후에도 보존할 의견')
  await page.reload()
  await expect(page.getByLabel('검토 메모')).toHaveValue(
    '재생성 후에도 보존할 의견',
  )
  await expect(
    page.getByRole('checkbox', { name: /약정 위반.*담당자 확인/ }),
  ).toBeChecked()
  await page.evaluate(() =>
    window.scrollTo(
      0,
      document.querySelector('.review-layout')!.getBoundingClientRect().top +
        window.scrollY -
        90,
    ),
  )
  await page.screenshot({ path: testInfo.outputPath('review-editor.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.goto(
    '/analyses/demo-manufacturing/review?report=2025&scope=CFS&lease=include',
  )
  await expect(page.getByLabel('검토 메모')).toHaveValue('')
  await expect(
    page.getByRole('checkbox', { name: /약정 위반.*담당자 확인/ }),
  ).toBeDisabled()
  expect(errors).toEqual([])
})

test('two tabs can compare and merge conflicting review drafts without losing either saved version', async ({
  page,
  context,
}) => {
  const url = '/analyses/demo-manufacturing/review?report=2025&scope=CFS'
  await page.goto(url)
  await page.getByLabel('검토 메모').fill('최초 의견')
  await page.getByRole('button', { name: '브라우저에 저장' }).click()
  const other = await context.newPage()
  await other.goto(`http://127.0.0.1:5173${url}`)
  await other.getByLabel('검토 메모').fill('두 번째 창의 편집 의견')
  await page.bringToFront()
  await page
    .getByLabel('핵심 수치', { exact: true })
    .fill('첫 번째 창의 최신 핵심 문단')
  await page.getByRole('button', { name: '브라우저에 저장' }).click()
  await other.bringToFront()
  await other.getByRole('button', { name: '브라우저에 저장' }).click()
  await expect(other.getByRole('alert')).toContainText('충돌')
  await expect(other.getByLabel('검토 메모')).toHaveValue(
    '두 번째 창의 편집 의견',
  )
  await other.getByRole('button', { name: '최신 저장본 비교·병합' }).click()
  const group = other
    .getByRole('dialog')
    .getByRole('group', { name: '핵심 수치' })
  await group.getByRole('radio', { name: '최신 저장본 사용' }).check()
  await other.getByRole('button', { name: '선택한 내용으로 병합·저장' }).click()
  await expect(other.getByLabel('핵심 수치', { exact: true })).toHaveValue(
    '첫 번째 창의 최신 핵심 문단',
  )
  await expect(other.getByLabel('검토 메모')).toHaveValue(
    '두 번째 창의 편집 의견',
  )
  await expect(
    other.getByText('저장된 버전 3개', { exact: false }),
  ).toBeVisible()
  await page.bringToFront()
  await page.reload()
  await expect(page.getByLabel('검토 메모')).toHaveValue(
    '두 번째 창의 편집 의견',
  )
})
