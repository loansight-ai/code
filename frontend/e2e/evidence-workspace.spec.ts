import { expect, test } from '@playwright/test'
import { exposureFixture } from './exposure-fixture'

const id = '11111111-1111-4111-8111-111111111111'
const sid = '22222222-2222-4222-8222-222222222222'
const fid = '33333333-3333-4333-8333-333333333333'
const bundle = {
  bundle_id: id,
  bundle_revision: 'layout-fixture',
  corp_code: '00164478',
  receipt_no: '20260318001395',
  company_name: '화면 검증 기업',
  period: '2025.12',
  scope: 'OFS',
  review_status: 'PENDING',
  evidence_verified: false,
  model_input_status: 'WITHHELD_UNVERIFIED',
  collection_import_id: null,
  sources: [
    { origin: 'html', structure_id: sid },
    { origin: 'dump', archive: 'fixture.dump' },
  ],
  coverage: [
    { region: 'notes', scope: 'OFS', segments: 300, nonempty: 300 },
    {
      region: 'business_report',
      scope: 'COMMON',
      segments: 223,
      nonempty: 180,
    },
    { region: 'audit', scope: 'OFS', segments: 1, nonempty: 1 },
  ],
  limitations: ['일부 사업보고서 구간은 본문이 확보되지 않았습니다.'],
  baseline: null,
}
const candidate = {
  segment_id: sid,
  kind: 'table',
  origin: 'dump',
  region: 'notes',
  scope: 'OFS',
  source_revision: id,
  sha256: 'hash',
  section_path: [{ id: sid, title: '담보제공자산과 관련 채무' }],
  excerpt: {
    text: '담보 제공 내역과 당기 잔액을 확인합니다.',
    start: 0,
    end: 23,
    truncated: false,
  },
  location: {},
  source_url: null,
}
const fact = {
  id: fid,
  root_id: fid,
  supersedes_id: null,
  revision: 1,
  version: 0,
  state: 'PENDING',
  model_eligible: false,
  origin: { kind: 'DUMP_AUDIT_CANDIDATE' },
  validation: {
    status: 'CITATIONS_VALID',
    issues: [],
    normalized_amount: null,
  },
  data: {
    category: 'audit',
    kind: 'audit_opinion',
    statement: '감사의견 기재: 적정',
    subject: '화면 검증 기업',
    direction: 'UNKNOWN',
    period: '2025.12',
    counterparty: null,
    amount_role: 'UNKNOWN',
    amount: null,
    maturity: null,
    status: '적정',
    detection: 'DETECTED',
    citations: [
      { segment_id: sid, field: 'statement', quote: '감사의견은 적정입니다.' },
    ],
  },
}

test('evidence workspace has styled panels, usable search and no viewport overflow', async ({
  page,
}, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let json: unknown
    if (path.endsWith('/session'))
      json = { user_id: id, workspace_id: id, user_code: '00001' }
    else if (path.endsWith('/me/tasks'))
      json = { tasks: [], event_cursor: `${id}:0` }
    else if (path.endsWith('/task-events'))
      return route.fulfill({
        contentType: 'text/event-stream',
        body: ': connected\n\n',
      })
    else if (path.endsWith('/fact-extraction') || path.endsWith('/agent'))
      json = { available: false, run: null }
    else if (path.endsWith('/exposure-summary')) json = exposureFixture(bundle)
    else if (path.endsWith('/facts'))
      json = { facts: [fact], next_offset: null }
    else if (path.endsWith(`/facts/${fid}`))
      json = {
        fact,
        reviews: [],
        revisions: [{ id: fid, revision: 1, state: 'PENDING' }],
      }
    else if (path.endsWith('/fact-sources'))
      json = {
        segment_id: sid,
        origin: 'dump',
        revision: id,
        sha256: 'hash',
        scope: 'OFS',
        title: '감사 자료',
        text: '감사의견은 적정입니다.',
        source_url: null,
        cells: null,
        row_offset: 0,
        next_row_offset: null,
        text_offset: 0,
        next_text_offset: null,
        truncated_cells: false,
      }
    else if (path.endsWith('/signals'))
      json = {
        bundle_id: id,
        input_revision: 'input',
        registry_revision: 'registry',
        version: 'fixture',
        evaluation_status: 'DEFINITION_PENDING',
        ready_inputs: 0,
        total_facts: 1,
        next_offset: null,
        categories: [
          {
            key: 'audit',
            title: '감사의견·계속기업',
            status: 'REVIEW_PENDING',
            ready_inputs: 0,
            configured_rules: 0,
            states: { REVIEW_PENDING: 1 },
          },
        ],
        facts: [],
        evaluations: [],
        severity_counts: {},
        limitations: ['운영 규칙 등록 전입니다.'],
        model_eligible: false,
      }
    else if (path.endsWith('/sections'))
      json = {
        bundle_id: id,
        bundle_revision: bundle.bundle_revision,
        sections: [],
        next_offset: null,
      }
    else if (path.endsWith('/baseline'))
      json = {
        bundle_id: id,
        bundle_revision: bundle.bundle_revision,
        items: [
          '감사의견·계속기업',
          '차입 만기·재무약정',
          '신용등급',
          '담보',
          '소송·제재',
          '부외·후속사건',
        ].map((title, i) => ({
          key: [
            'audit',
            'borrowing',
            'credit',
            'collateral',
            'litigation',
            'off_balance',
          ][i],
          title,
          terms: ['담보'],
          total: 1,
          candidates: [candidate],
          next_offset: null,
          unavailable_regions: [],
          bundle_id: id,
          bundle_revision: bundle.bundle_revision,
          candidate_status: 'MATCHED',
        })),
      }
    else if (path.endsWith('/search'))
      json = {
        bundle_id: id,
        bundle_revision: bundle.bundle_revision,
        total: 1,
        candidates: [candidate],
        next_offset: null,
      }
    else if (path.endsWith(`/segments/${sid}`)) json = candidate
    else if (path.endsWith('/context'))
      json = {
        bundle_id: id,
        bundle_revision: bundle.bundle_revision,
        segments: [candidate],
        next_text_offset: null,
        table: {
          unit: '단위: 백만원',
          cells: [
            ['구분', '당기', '전기'],
            ['제공 담보', '100', '80'],
          ],
          row_offset: 0,
          next_row_offset: null,
        },
      }
    else if (path.endsWith(`/evidence-bundles/${id}`)) json = bundle
    else if (path.endsWith('/companies/00164478'))
      json = {
        corp_code: '00164478',
        corp_name: '화면 검증 기업',
        ksic11_status: 'matched',
        industry: '건설',
        modify_date: '20261031',
      }
    else return route.fulfill({ status: 404, json: { detail: 'not_found' } })
    return route.fulfill({ json })
  })
  await page.goto(`/evidence/${id}/evidence`)
  await expect(
    page.getByRole('heading', { name: '주석 확인과 위험징후', exact: true }),
  ).toBeVisible()
  const main = page.locator('main.evidence-workspace')
  const search = main.getByRole('region', { name: '보고서 통합 근거' })
  const facts = main.getByRole('region', { name: '구조화 사실 검수' })
  await expect(
    page
      .getByRole('navigation', { name: '주석 확인 메뉴' })
      .getByRole('button', { name: '주석 추출 근거' }),
  ).toHaveAttribute('aria-current', 'page')
  const overview = main.getByRole('region', { name: '추출 현황' })
  const detail = main.getByRole('complementary', { name: '선택 항목 근거' })
  const composition = main.getByRole('region', {
    name: '제공 보증·조건부 의무 구성',
  })
  await expect(
    composition.getByRole('cell', { name: '10,985', exact: true }),
  ).toBeVisible()
  await expect(composition.getByText('= 61.0%', { exact: true })).toBeVisible()
  await expect(composition.getByText('합산 제외')).toBeVisible()
  const maturity = main.getByRole('region', { name: '1년 내 만기 요약' })
  await expect(maturity.getByText('810', { exact: true })).toBeVisible()
  await expect(
    main.getByRole('region', { name: '소송 현황 피고' }).getByText('12건'),
  ).toBeVisible()
  const litigation = main.getByRole('region', { name: '소송 현황 피고' })
  await expect(litigation.getByText('386억', { exact: true })).toBeVisible()
  await expect(
    litigation
      .getByRole('table', { name: '피고 소송가액 상위 사건' })
      .getByRole('row'),
  ).toHaveCount(4)
  await expect(litigation.getByText('2024.03.11')).toBeVisible()
  const compositionBounds = await composition.boundingBox()
  const litigationBounds = await litigation.boundingBox()
  expect(litigationBounds!.width).toBeGreaterThanOrEqual(
    compositionBounds!.width,
  )
  await litigation.screenshot({ path: info.outputPath('litigation-card.png') })
  await expect(overview.getByRole('row')).toHaveCount(7)
  await expect(
    detail.getByText('감사의견 기재: 적정', { exact: true }),
  ).toBeVisible()
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
  expect(await overflow()).toBe(false)
  await page.screenshot({
    path: info.outputPath('evidence-initial.png'),
    fullPage: true,
  })
  await composition.getByRole('button', { name: /XI.2/ }).first().click()
  const exposureDialog = page.getByRole('dialog', {
    name: '구성·만기·소송 원문',
  })
  await expect(
    exposureDialog.getByRole('table', { name: '저장된 근거 표' }),
  ).toBeVisible()
  await exposureDialog
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await litigation
    .getByRole('button', { name: '하자보수금 청구 원문 열기' })
    .click()
  await expect(
    exposureDialog.getByRole('table', { name: '저장된 근거 표' }),
  ).toBeVisible()
  await exposureDialog
    .getByRole('button', { name: '닫기', exact: true })
    .click()
  await maturity.getByRole('link', { name: '만기 사다리 보기 →' }).click()
  await expect(
    main.getByRole('region', { name: '상세 만기 사다리' }),
  ).toBeVisible()
  await page
    .getByRole('navigation', { name: '주석 확인 메뉴' })
    .getByRole('button', { name: '주석 추출 근거' })
    .click()
  await main.getByRole('button', { name: '담보 제공', exact: true }).click()
  await expect(detail.getByRole('heading', { name: '담보 제공' })).toBeVisible()
  await expect(detail.getByText('검색 후보', { exact: true })).toBeVisible()
  await expect(detail.getByText('미확보')).toHaveCount(3)
  await detail.getByRole('button', { name: '원문 열기' }).click()
  const dialog = page.getByRole('dialog', { name: '선택 근거 원문' })
  await expect(
    dialog.getByRole('table', { name: '저장된 근거 표' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: '닫기', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await overflow()).toBe(false)
  await page.screenshot({
    path: info.outputPath('extraction-mobile.png'),
    fullPage: true,
  })
  await page.setViewportSize(info.project.use.viewport!)
  await main.locator('.extraction-tools > summary').click()
  await expect(
    facts.getByRole('button', { name: /감사의견 · 감사의견 기재/ }),
  ).toBeVisible()
  await expect(search.locator('.bundle-panel-body')).toHaveCSS(
    'padding',
    '18px',
  )
  await search.getByRole('button', { name: '공통 6항목 검색' }).click()
  const category = search.locator('.bundle-categories details').first()
  await category.locator('summary').click()
  await category
    .getByRole('button', { name: '담보제공자산과 관련 채무 · 표' })
    .click()
  await expect(
    page.getByRole('table', { name: '저장된 근거 표' }),
  ).toBeVisible()
  await facts.getByRole('button', { name: /감사의견 · 감사의견 기재/ }).click()
  const review = page.getByRole('region', { name: '선택 사실 검수' })
  await expect(review.getByLabel('검수 사유')).toBeVisible()
  await expect(
    review.getByRole('button', { name: '승인', exact: true }),
  ).toBeDisabled()
  expect(await overflow()).toBe(false)
  await page.screenshot({
    path: info.outputPath('evidence-expanded.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await overflow()).toBe(false)
  await expect(search.getByPlaceholder('차입금, 담보')).toBeVisible()
  await page.screenshot({
    path: info.outputPath('evidence-mobile.png'),
    fullPage: true,
  })
  await review.getByRole('button', { name: '수정본 작성', exact: true }).click()
  const editor = page.getByRole('region', { name: '사실 후보 편집' })
  await expect(
    editor.getByRole('textbox', { name: '사실 설명', exact: true }),
  ).toBeVisible()
  await expect(
    editor.getByRole('paragraph').filter({ hasText: '감사의견은 적정입니다.' }),
  ).toBeVisible()
  expect(await overflow()).toBe(false)
  await page.screenshot({
    path: info.outputPath('evidence-editor-mobile.png'),
    fullPage: true,
  })
  expect(errors).toEqual([])
})
