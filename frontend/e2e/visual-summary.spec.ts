import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const result = JSON.parse(
  readFileSync(
    new URL('../src/test/fixtures/financial-result.json', import.meta.url),
    'utf-8',
  ),
)
const id = result.analysis_run_id
test('standalone visual preview, tabs, formula and responsive layout', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', (route) =>
    route.fulfill({ status: 401, json: { detail: 'session_required' } }),
  )
  await page.goto('/preview/financial-summary')
  await expect(page).toHaveURL(/\/examples\/financial-summary$/)
  await expect(
    page.getByRole('heading', { name: '핵심 재무 요약', exact: true }),
  ).toBeVisible()
  await expect(
    page.locator('#example-data').getByText('예시 데이터', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('img', { name: /^총차입금/ })).toBeVisible()
  if (testInfo.project.name === 'desktop') {
    const radar = page.getByRole('img', { name: /^5축 업종 백분위\./ })
    const bounds = await radar.boundingBox()
    expect(bounds).not.toBeNull()
    await radar.screenshot({ path: testInfo.outputPath('radar-click.png') })
    await radar.click({
      position: { x: bounds!.width * 0.73, y: bounds!.height * 0.77 },
    })
    await expect(page.getByRole('tab', { name: /활동성/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  }
  await page.getByRole('tab', { name: /안정성/ }).click()
  await expect(page.getByRole('tabpanel')).toContainText('업종 위치 · 안정성')
  await expect(page.getByRole('tabpanel').getByText('하위 25%')).toBeVisible()
  await page
    .getByRole('region', { name: '5개 영역 지표' })
    .screenshot({ path: testInfo.outputPath('industry-position.png') })
  await page.getByRole('tab', { name: /활동성/ }).click()
  await expect(page.getByRole('tabpanel').getByText('상위 35%')).toBeVisible()
  await page.getByRole('tab', { name: /수익성/ }).click()
  const button = page
    .getByRole('region', { name: '공통 핵심 5개 비율' })
    .getByRole('button', { name: '이자보상비율', exact: true })
  await button.click()
  await expect(page.getByRole('dialog')).toContainText('영업이익 ÷ 이자비용')
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page
    .getByRole('region', { name: '공통 핵심 5개 비율' })
    .screenshot({ path: testInfo.outputPath('core-ratios.png') })
  await page
    .getByRole('region', { name: '영업이익', exact: true })
    .screenshot({ path: testInfo.outputPath('profit-card.png') })
  const industry = page.getByRole('region', { name: '건설 업종 핵심 지표' })
  await expect(industry.getByRole('row')).toHaveCount(6)
  await industry.screenshot({
    path: testInfo.outputPath('industry-highlights.png'),
  })
  const repayment = page.getByRole('region', { name: '상환능력', exact: true })
  await expect(repayment.getByRole('row')).toHaveCount(5)
  await expect(repayment).toContainText('1년 내 만기 9,300억원 · 49%')
  await repayment.screenshot({
    path: testInfo.outputPath('repayment-highlights.png'),
  })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('visual-summary.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('heading', { name: '공통 핵심 5개 비율' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  expect(errors).toEqual([])
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({
    path: testInfo.outputPath('visual-summary-mobile.png'),
    fullPage: true,
  })
})

test('real analysis preview shares authentication, source data and lease workflow', async ({
  page,
}) => {
  let posted: unknown
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/session'))
      return route.fulfill({
        json: { user_id: id, workspace_id: id, user_code: '12345' },
      })
    if (path.endsWith('/me/tasks'))
      return route.fulfill({ json: { tasks: [], event_cursor: `${id}:0` } })
    if (path.includes('/task-events'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      })
    if (path.endsWith('/companies'))
      return route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 10 },
      })
    const task = {
      task_id: id,
      job_id: id,
      task_type: 'FINANCIAL_ANALYSIS',
      analysis_run_id: id,
      status: 'SUCCEEDED',
      stage: 'COMPLETED',
      state_version: 3,
      attempt: 1,
      error_code: null,
      occurred_at: result.collected_at,
      acknowledged: false,
    }
    if (path.endsWith('/financial-analyses')) {
      posted = route.request().postDataJSON()
      return route.fulfill({
        json: {
          ...task,
          analysis_run_id: '22222222-2222-4222-8222-222222222222',
        },
      })
    }
    if (path.endsWith(`/financial-analyses/${id}`))
      return route.fulfill({
        json: { ...task, context: result.context, result },
      })
    if (path.includes('22222222-2222-4222-8222-222222222222'))
      return route.fulfill({
        json: {
          ...task,
          status: 'QUEUED',
          analysis_run_id: '22222222-2222-4222-8222-222222222222',
          context: { ...result.context, lease: 'exclude' },
          result: null,
        },
      })
    return route.fulfill({ status: 404, json: { detail: 'not_found' } })
  })
  await page.goto(
    `/financials/${id}/summary-preview?corp=${result.context.corp_code}`,
  )
  await expect(page).toHaveURL(new RegExp(`/financials/${id}/summary\\?corp=`))
  await expect(
    page.getByRole('heading', { name: '제조 업종 핵심 지표' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: '기존 화면 보기' })).toHaveCount(
    0,
  )
  await page.getByRole('checkbox', { name: '리스부채 포함' }).click()
  await expect(page).toHaveURL(
    /22222222-2222-4222-8222-222222222222\/summary\?/,
  )
  await expect(
    page.getByText('재무 데이터를 수집·계산하고 있습니다'),
  ).toBeVisible()
  expect(posted).toMatchObject({ scope: 'OFS', lease: 'exclude' })
})
