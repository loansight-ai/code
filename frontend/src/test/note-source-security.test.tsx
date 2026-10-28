import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { LiveSourceViewer } from '../features/evidence/live-source-viewer'
import { sourceDocument } from '../features/evidence/source-document'

it('removes executable markup and external resources while preserving source anchors and table spans', () => {
  const html = sourceDocument(
    `<p id="source-safe" onclick="alert(1)">주석 원문</p><script>alert(1)</script><img src="https://example.com/track" onerror="alert(1)"><a href="javascript:alert(1)">링크</a><style>@import 'https://example.com/style';</style><form action="https://example.com"><input name="cookie"></form><svg onload="alert(1)"></svg><table><tr><td rowspan="2">100</td></tr></table>`,
  )
  const doc = new DOMParser().parseFromString(html, 'text/html')
  expect(doc.querySelector('script,img,a,form,input,svg')).toBeNull()
  expect(
    doc.querySelector('[onclick],[onerror],[onload],[src],[href]'),
  ).toBeNull()
  expect(doc.getElementById('source-safe')?.textContent).toBe('주석 원문')
  expect(doc.querySelector('td')?.getAttribute('rowspan')).toBe('2')
  expect(doc.querySelectorAll('style')).toHaveLength(1)
  expect(doc.querySelector('style')?.textContent).not.toContain('https:')
  expect(
    doc
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content'),
  ).toContain("script-src 'none'")
})

it('uses an iframe sandbox without script privileges', () => {
  render(
    <LiveSourceViewer
      source={{
        structure_id: '11111111-1111-4111-8111-111111111111',
        source_sha256: 'hash',
        view_kind: 'derived',
        html: '<p id="source-safe">본문</p>',
        anchors: {},
      }}
      segmentId={null}
    />,
  )
  expect(screen.getByTitle('저장된 주석 원문')).toHaveAttribute(
    'sandbox',
    'allow-same-origin',
  )
  expect(screen.getByTitle('저장된 주석 원문')).not.toHaveAttribute('src')
})
