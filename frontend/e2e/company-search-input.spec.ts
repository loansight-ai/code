import { expect, test } from '@playwright/test'

test('keeps Korean IME composition local until committed', async ({ page }) => {
  await page.goto('/?data=demo')
  const input = page.getByRole('textbox', { name: '기업명 또는 종목코드' })
  await input.focus()
  const cdp = await page.context().newCDPSession(page)
  for (const text of ['ㅎ', '하', '한']) {
    await cdp.send('Input.imeSetComposition', {
      text,
      selectionStart: text.length,
      selectionEnd: text.length,
    })
    // Exceed the debounce interval: composing text must never reach the URL.
    await page.waitForTimeout(400)
    await expect(input).toHaveValue(text)
    expect(new URL(page.url()).searchParams.has('q')).toBe(false)
    await expect(page.getByRole('button', { name: /새움건설/ })).toBeVisible()
  }
  await cdp.send('Input.insertText', { text: '한' })
  await page.keyboard.insertText('빛')
  await expect(input).toHaveValue('한빛')
  await expect(page).toHaveURL(/q=%ED%95%9C%EB%B9%9B$/)
  await expect(page.getByRole('button', { name: /한빛정밀/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /새움건설/ })).toHaveCount(0)
  await expect(input).toBeFocused()
})

test('preserves rapid middle edits and pending text when other criteria change', async ({
  page,
}) => {
  await page.goto(
    '/?data=demo&company=demo-manufacturing&report=2024&scope=OFS',
  )
  const input = page.getByRole('textbox', { name: '기업명 또는 종목코드' })
  await input.fill('123456')
  await input.evaluate((element: HTMLInputElement) =>
    element.setSelectionRange(2, 2),
  )
  await input.pressSequentially('ab')
  await expect(input).toHaveValue('12ab3456')
  expect(
    await input.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(4)
  await expect(page).toHaveURL(/q=12ab3456/)
  expect(
    await input.evaluate((element: HTMLInputElement) => element.selectionStart),
  ).toBe(4)
  await input.fill('한빛')
  await page.getByRole('button', { name: '제조', exact: true }).click()
  await expect(page).toHaveURL(/q=%ED%95%9C%EB%B9%9B/)
  const params = new URL(page.url()).searchParams
  expect(Object.fromEntries(params)).toMatchObject({
    company: 'demo-manufacturing',
    report: '2024',
    scope: 'OFS',
    industry: '제조',
    q: '한빛',
  })
})

test('restores URL search on navigation and cancels pending text on reset', async ({
  page,
}) => {
  await page.goto('/?data=demo&q=없는기업')
  const input = page.getByRole('textbox', { name: '기업명 또는 종목코드' })
  await expect(input).toHaveValue('없는기업')
  await expect(page.getByText('검색 결과가 없습니다')).toBeVisible()
  await input.fill('한빛')
  await page.getByRole('button', { name: '검색 조건 초기화' }).click()
  await expect(input).toHaveValue('')
  await page.waitForTimeout(400)
  expect(new URL(page.url()).searchParams.has('q')).toBe(false)
  await expect(page.getByRole('button', { name: /새움건설/ })).toBeVisible()
  await input.fill('한빛')
  await expect(page).toHaveURL(/q=%ED%95%9C%EB%B9%9B/)
  await page.reload()
  await expect(input).toHaveValue('한빛')
  await page.evaluate(() => {
    history.pushState(null, '', '/?data=demo&q=새움')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(input).toHaveValue('새움')
  await expect(page.getByRole('button', { name: /새움건설/ })).toBeVisible()
  await page.goBack()
  await expect(input).toHaveValue('한빛')
  await expect(page.getByRole('button', { name: /한빛정밀/ })).toBeVisible()
})
