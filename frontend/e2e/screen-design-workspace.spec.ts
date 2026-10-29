import { expect, test } from '@playwright/test'

const id = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const owner = '33333333-3333-4333-8333-333333333333'
const keys = [
  'audit',
  'borrowing',
  'credit',
  'collateral',
  'litigation',
  'off_balance',
]
const titles = [
  '감사의견·계속기업',
  '차입 만기·재무약정',
  '신용등급',
  '담보',
  '소송·제재',
  '부외·후속사건',
]
const metadata = {
  structure_id: id,
  status: 'SUCCEEDED',
  stage: 'COMPLETED',
  corp_code: '01214248',
  company_name: '화면 검증 기업',
  receipt_no: '20260320001416',
  scope: 'OFS',
  period: '2025.12',
  source_sha256: 'fixture-hash',
  source_bytes: 1000,
  parser_version: '0.8.4',
  input_origin: 'dart_viewer_note_html',
  segment_count: 1,
  evidence_verified: false,
  hierarchy: { nodes: [{ id: 'root', title: '주석', parent_id: null }] },
}
const segment = {
  id: sid,
  local_id: 'b1',
  ordinal: 0,
  kind: 'paragraph',
  source_xpath: '/html/body/p',
  text: '재무약정 위반은 없습니다.',
  owner_node_id: 'root',
  table_data: null,
}
const candidate = {
  segment_id: sid,
  ordinal: 0,
  kind: 'paragraph',
  owner_node_id: 'root',
  section_path: [{ id: 'root', title: '주석' }],
  excerpt: {
    text: segment.text,
    start: 0,
    end: segment.text.length,
    truncated: false,
  },
  matches: [{ term: '약정', fields: ['text'] }],
  source_url: `/notes/${id}?segment=${sid}`,
  table_title: null,
}

test('filing context, extraction table, source drawer and local review follow the design flow', async ({
  page,
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url())
    let data: unknown = metadata
    if (url.pathname.endsWith('/session'))
      data = { user_id: owner, workspace_id: owner, user_code: '12345' }
    else if (url.pathname.endsWith('/me/tasks'))
      data = { tasks: [], event_cursor: `${owner}:0` }
    else if (url.pathname.includes('/task-events'))
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      })
    else if (url.pathname.endsWith('/companies'))
      data = { items: [], total: 0, offset: 0, limit: 10 }
    else if (url.pathname.endsWith('/search/baseline'))
      data = {
        run: {
          run_id: sid,
          structure_id: id,
          source_sha256: 'fixture-hash',
          created_at: '2026-10-29T00:00:00Z',
          dictionary_version: 'fixture-v1',
          dictionary_status: 'DRAFT',
          execution_kind: 'BASELINE_KEYWORD',
          execution_status: 'COMPLETED',
          report_coverage: 'PARTIAL',
          agent_status: 'NOT_RUN',
          evidence_verified: false,
          items: keys.map((key, index) => ({
            key,
            title: titles[index],
            terms: ['약정'],
            mode: 'ANY',
            search_status: 'COMPLETED',
            candidate_status: key === 'borrowing' ? 'MATCHED' : 'NO_MATCH',
            total: key === 'borrowing' ? 1 : 0,
            candidates: key === 'borrowing' ? [candidate] : [],
            truncated: false,
            next_offset: null,
            unavailable_regions: [],
            review_status: 'PENDING',
          })),
        },
      }
    else if (url.pathname.endsWith('/search/agent'))
      data = {
        available: true,
        provider: 'codex',
        run: {
          run_id: sid,
          structure_id: id,
          status: 'SUCCEEDED',
          error_code: null,
          result: {
            structure_id: id,
            source_sha256: 'fixture-hash',
            execution_status: 'COMPLETED',
            evidence_verified: false,
            items: keys.map((key) => ({
              key,
              search_status: 'COMPLETED',
              limitations: '주석 영역만 확인. 검수 전.',
              findings:
                key === 'borrowing'
                  ? [
                      {
                        statement: '약정 위반이 없다는 문구가 있습니다.',
                        citations: [{ segment_id: sid, quote: segment.text }],
                      },
                    ]
                  : [],
            })),
          },
        },
      }
    else if (url.pathname.endsWith('/source-view'))
      data = {
        structure_id: id,
        source_sha256: 'fixture-hash',
        html: `<p id="source-${sid}">${segment.text}</p>`,
        anchors: { [sid]: `source-${sid}` },
        view_kind: 'derived',
      }
    else if (url.pathname.endsWith('/segments'))
      data = { segments: [segment], total: 1, next_after: null }
    else if (url.pathname.includes('/segments/')) data = segment
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    })
  })
  await page.goto(`/notes/${id}`)
  await expect(
    page.getByRole('heading', { name: '주석 확인과 위험징후', exact: true }),
  ).toBeVisible()
  await expect(page.getByLabel('기업 분석 기준')).toContainText(
    '20260320001416',
  )
  await expect(
    page.getByRole('group', { name: '검색 항목' }).getByRole('button'),
  ).toHaveCount(6)
  await page
    .getByRole('button', { name: '차입 만기·재무약정', exact: true })
    .click()
  await page.getByRole('button', { name: '원문에서 확인', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(
    page
      .frameLocator('iframe[title="저장된 주석 원문"]')
      .locator('.source-active'),
  ).toHaveText(segment.text)
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await page.getByRole('button', { name: 'AI 요약', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: '사실 후보 · 검수 전', exact: true }),
  ).toBeVisible()
  const mask = [page.getByRole('button', { name: /사용자 \d{5}/ })]
  await page.screenshot({
    path: testInfo.outputPath('evidence-summary.png'),
    fullPage: true,
    mask,
  })
  await page.getByRole('link', { name: '체크·검토 메모', exact: true }).click()
  const check = page.getByRole('checkbox', { name: /약정 위반이 없다는 문구/ })
  await expect(check).toBeDisabled()
  await page.getByRole('button', { name: '근거 원문 1', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="저장된 주석 원문"]')
      .locator('.source-active'),
  ).toBeVisible()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await expect(check).toBeEnabled()
  await check.check()
  await page
    .getByLabel('담당자 의견', { exact: true })
    .fill('원문 대조 완료. 내부 약정 확인 필요.')
  await page
    .getByRole('button', { name: '브라우저에 저장', exact: true })
    .click()
  await page.reload()
  await expect(page.getByLabel('담당자 의견', { exact: true })).toHaveValue(
    '원문 대조 완료. 내부 약정 확인 필요.',
  )
  await expect(check).toBeChecked()
  await page.screenshot({
    path: testInfo.outputPath('live-review.png'),
    fullPage: true,
    mask,
  })
  await page.getByRole('link', { name: '핵심 재무 요약', exact: true }).click()
  await expect(page.getByLabel('기업 분석 기준')).toContainText('별도(OFS)')
  await expect(page.getByText('1,250', { exact: true })).toHaveCount(0)
  await page.screenshot({
    path: testInfo.outputPath('live-summary.png'),
    fullPage: true,
    mask,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
})
