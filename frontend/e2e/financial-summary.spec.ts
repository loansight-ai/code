import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const result = JSON.parse(
  readFileSync(
    new URL('../src/test/fixtures/financial-result.json', import.meta.url),
    'utf-8',
  ),
)
const id = result.analysis_run_id
Object.assign(
  result,
  JSON.parse(
    readFileSync(
      new URL(
        '../src/test/fixtures/core-card-assessments.json',
        import.meta.url,
      ),
      'utf-8',
    ),
  ),
)
const other = '22222222-2222-4222-8222-222222222222'
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

test('financial summary, formula, shared cashflow and server lease request', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let posted: Record<string, unknown> | null = null
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let data: unknown
    if (path.endsWith('/session'))
      data = { user_id: id, workspace_id: id, user_code: '12345' }
    else if (path.endsWith('/me/tasks'))
      data = { tasks: [], event_cursor: `${id}:0` }
    else if (path.includes('/task-events'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      })
    else if (path.endsWith('/companies'))
      data = { items: [], total: 0, offset: 0, limit: 10 }
    else if (
      path.endsWith('/financial-analyses') &&
      route.request().method() === 'POST'
    ) {
      posted = route.request().postDataJSON()
      data = { ...task, analysis_run_id: other }
    } else if (path.endsWith(`/financial-analyses/${other}`))
      data = {
        ...task,
        status: 'QUEUED',
        analysis_run_id: other,
        context: { ...result.context, lease: 'exclude' },
        result: null,
      }
    else if (path.endsWith(`/financial-analyses/${id}`))
      data = { ...task, context: result.context, result }
    else return route.fulfill({ status: 404, json: { detail: 'not_found' } })
    return route.fulfill({ json: data })
  })
  await page.goto(`/financials/${id}/summary`)
  await expect(
    page.getByRole('heading', { name: '핵심 재무 요약', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '공통 핵심 5개 비율' }),
  ).toBeVisible()
  const core = page.getByRole('region', { name: '공통 핵심 5개 비율' })
  await expect(
    core.getByRole('img', { name: /유동비율:.*팀 가설 150.0%/ }),
  ).toBeVisible()
  await expect(
    core.getByRole('img', { name: /매출액영업이익률:.*전기 4.1%/ }),
  ).toBeVisible()
  await expect(
    core
      .getByRole('button', { name: '유동비율', exact: true })
      .locator('..')
      .getByText('주의', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('#main .source-strip')).toHaveCount(0)
  await expect(
    page.locator('#main').getByRole('button', { name: '분석 추가 정보' }),
  ).toHaveCount(0)
  const information = page
    .locator('.topbar')
    .getByRole('button', { name: '분석 추가 정보' })
  await information.click()
  await expect(
    page.getByRole('dialog', { name: '분석 추가 정보' }),
  ).toContainText(result.source_sha256)
  await page.keyboard.press('Escape')
  await expect(information).toBeFocused()
  await page.getByRole('button', { name: '이자보상비율', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '이자보상비율 산식' })
  await expect(dialog).toContainText('이자비용: 127.52억원')
  await page.keyboard.press('Escape')
  await page.screenshot({
    path: testInfo.outputPath('financial-summary.png'),
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy()
  await page
    .getByRole('navigation', { name: '기업 분석' })
    .getByRole('link', { name: '실적 변동·현금흐름', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '영업이익 변동 분해' }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: '기업 분석' })
    .getByRole('link', { name: '핵심 재무 요약', exact: true })
    .click()
  await page.getByRole('checkbox', { name: '리스부채 포함' }).click()
  await expect(page).toHaveURL(new RegExp(other))
  await expect(
    page.getByText('재무 데이터를 수집·계산하고 있습니다'),
  ).toBeVisible()
  expect(posted).toEqual({
    corp_code: result.context.corp_code,
    receipt_no: result.context.receipt_no,
    scope: 'OFS',
    lease: 'exclude',
  })
  expect(errors).toEqual([])
})
