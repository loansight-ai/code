import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../src/test/fixtures/${name}.json`, import.meta.url),
      'utf-8',
    ),
  )
const result = {
  ...fixture('financial-result'),
  ...fixture('core-card-assessments'),
  bok_benchmark: fixture('bok-benchmark'),
}
const id = result.analysis_run_id

test('BOK averages stay in core cards and all five metric domains remain available', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/session'))
      return route.fulfill({
        json: {
          user_id: id,
          workspace_id: id,
          user_code: '12345',
        },
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
          task_type: 'FINANCIAL_ANALYSIS',
          analysis_run_id: id,
          status: 'SUCCEEDED',
          stage: 'COMPLETED',
          state_version: 3,
          attempt: 1,
          error_code: null,
          occurred_at: result.collected_at,
          acknowledged: false,
          context: result.context,
          result,
        },
      })
    return route.fulfill({ status: 404, json: { detail: 'not_found' } })
  })
  await page.goto(`/financials/${id}/summary`)
  const section = page.getByRole('region', {
    name: '공통 핵심 5개 비율',
    exact: true,
  })
  await expect(section).toBeVisible()
  await expect(
    section.getByRole('link', { name: '한국은행 기업경영분석' }),
  ).toHaveAttribute('href', /nttId=11065774/)
  await expect(
    section.getByRole('img', { name: /유동비율:.*업종 평균 · 2025 131.5%/ }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '업종 평균 비교', exact: true }),
  ).toHaveCount(0)
  const domains = page.getByRole('region', {
    name: '5개 영역 지표',
    exact: true,
  })
  await expect(domains).toBeVisible()
  await expect(domains.getByRole('tab')).toHaveCount(5)
  await domains.getByRole('tab', { name: /활동성/ }).click()
  await expect(domains.getByRole('tabpanel')).toContainText(
    '업종 위치 · 활동성',
  )
  await section.scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('bok-comparison.png') })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
  await page
    .getByRole('navigation', { name: '기업 분석' })
    .getByRole('link', { name: '실적 변동·현금흐름', exact: true })
    .click()
  await expect(
    page.getByRole('img', { name: /영업이익률 업종 비교.*한국은행 업종 평균/ }),
  ).toHaveCount(0)
  expect(errors).toEqual([])
})
