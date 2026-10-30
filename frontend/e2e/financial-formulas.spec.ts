import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const result = JSON.parse(
  readFileSync(
    new URL('../src/test/fixtures/financial-result.json', import.meta.url),
    'utf-8',
  ),
)
result.formula_version = 'financial-formulas-v4'
result.metrics.push({
  key: 'inventory_turnover',
  label: '재고자산회전율',
  group: '활동성',
  unit: '회',
  formula: '매출액 ÷ ((기초 재고자산 + 기말 재고자산) ÷ 2)',
  basis: '분모 기초·기말 평균 · 분자 매출액',
  inputs: ['revenue', 'inventory'],
  values: [
    { period: 'current', value: '6.0000', state: 'CONFIRMED', reason: null },
  ],
  change: null,
  change_unit: '회',
})
const id = result.analysis_run_id

test('computed turnover opens the existing formula dialog and keeps five metric domains', async ({
  page,
}, testInfo) => {
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
    if (path.endsWith(`/financial-analyses/${id}`))
      return route.fulfill({
        json: {
          task_id: id,
          job_id: id,
          analysis_run_id: id,
          task_type: 'FINANCIAL_ANALYSIS',
          status: 'SUCCEEDED',
          stage: 'COMPLETED',
          state_version: 3,
          attempt: 1,
          occurred_at: result.collected_at,
          error_code: null,
          acknowledged: false,
          context: result.context,
          result,
        },
      })
    return route.fulfill({ status: 404, json: { detail: 'not_found' } })
  })
  await page.goto(`/financials/${id}/summary`)
  const panel = page.getByRole('region', { name: '5개 영역 지표', exact: true })
  await expect(panel.getByRole('tab')).toHaveCount(5)
  await panel.getByRole('tab', { name: /활동성/ }).click()
  const button = panel.getByRole('button', { name: '재고자산회전율 산식 보기' })
  await expect(button).toContainText('6회')
  await button.click()
  const dialog = page.getByRole('dialog', { name: '재고자산회전율 산식' })
  await expect(dialog).toContainText('아래 두 잔액의 산술평균')
  await expect(dialog).toContainText('financial-formulas-v4')
  await page.screenshot({ path: testInfo.outputPath('turnover-formula.png') })
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true)
})
