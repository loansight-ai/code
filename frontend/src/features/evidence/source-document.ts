import DOMPurify from 'dompurify'
import { scaledFontSize } from '../../shared/typography'

export function sourceDocument(html: string) {
  const body = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'div',
      'span',
      'table',
      'tbody',
      'thead',
      'tfoot',
      'tr',
      'th',
      'td',
      'caption',
      'colgroup',
      'col',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'b',
      'strong',
      'em',
      'i',
      'u',
      'sub',
      'sup',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'pre',
      'blockquote',
      'center',
    ],
    ALLOWED_ATTR: ['id', 'colspan', 'rowspan', 'scope', 'dir', 'lang'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  })
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'"><style>body{font:${scaledFontSize(14)}px/1.8 system-ui,sans-serif;color:#242820;padding:20px;margin:0;overflow-wrap:anywhere}table{border-collapse:collapse;max-width:100%;margin:16px 0;font-size:${scaledFontSize(12)}px}td,th{border:1px solid #d4d8cc;padding:7px;vertical-align:top}th{background:#f3f4f1}p{margin:8px 0}pre{white-space:pre-wrap}.source-active{outline:3px solid #ffbc00;outline-offset:3px;background:#fff4be!important;scroll-margin:30px}</style></head><body>${body}</body></html>`
}
