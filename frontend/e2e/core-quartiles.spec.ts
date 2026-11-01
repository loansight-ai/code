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
  ...fixture('relative-ratio-benchmark'),
  bok_benchmark: fixture('bok-benchmark'),
}
const id = result.analysis_run_id

test('core cards display quartile positions and accessible five-year details', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
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
  await expect(section.getByText('중앙값 166.6%')).toBeVisible()
  await expect(section.getByText('OFS 수집 표본 1,676개 기업')).toBeVisible()
  await expect(section.getByText('중앙값 2.0배')).toBeVisible()
  await expect(section.getByText(/자사는 기말 총자산/)).toBeVisible()
  expect(await section.locator('.vs-core-quartile-risk').count()).toBe(0)
  await expect(
    section.getByText(
      '경계 부근: 표본 구성에 따라 상대 구간이 달라질 수 있습니다.',
    ),
  ).toBeVisible()
  await section.screenshot({ path: testInfo.outputPath('core-quartiles.png') })
  await section.getByRole('button', { name: '이자보상비율 상세 보기' }).click()
  const dialog = page.getByRole('dialog', { name: '이자보상비율 산식' })
  await expect(
    dialog
      .getByRole('region', { name: '이자보상비율 업종 기준 5년 이력' })
      .getByRole('row'),
  ).toHaveCount(6)
  await expect(
    dialog.getByRole('row', { name: /업종 비교자료 출처/ }),
  ).toContainText('ECOS/OFS 출처')
  const current = dialog.getByRole('region', {
    name: '이자보상비율 현재 비교 기준',
  })
  await expect(current.getByText('해당 없음')).toHaveCount(3)
  await page.screenshot({
    path: testInfo.outputPath('core-quartile-detail.png'),
  })
  await page.keyboard.press('Escape')
  await expect(
    section.getByRole('button', { name: '이자보상비율 상세 보기' }),
  ).toBeFocused()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(section.getByText('OFS 수집 표본 1,676개 기업')).toBeVisible()
  expect(
    await section.evaluate(
      (node) =>
        node.scrollWidth <= node.clientWidth + 1 &&
        node.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true)
  await section.screenshot({
    path: testInfo.outputPath('relative-ratios-mobile.png'),
  })
  await section.getByRole('button', { name: '유동비율 상세 보기' }).click()
  const mobileDialog = page.getByRole('dialog', { name: '유동비율 산식' })
  await expect(mobileDialog.getByText(/평균 2.7% 변경/)).toBeVisible()
  expect(
    await mobileDialog.evaluate(
      (node) => node.scrollWidth <= node.clientWidth + 1,
    ),
  ).toBe(true)
  expect(
    await mobileDialog
      .locator('.core-relative-detail')
      .evaluate(
        (node) =>
          node.getBoundingClientRect().right <= innerWidth - 16 &&
          [...node.querySelectorAll('p')].every(
            (p) => p.scrollWidth <= p.clientWidth + 1,
          ),
      ),
  ).toBe(true)
  await page.screenshot({
    path: testInfo.outputPath('relative-ratios-mobile-detail.png'),
  })
})
