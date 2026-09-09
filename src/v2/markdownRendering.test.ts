import { createElement, Fragment } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ContentReaderView } from './detail/ContentViews'
import { SourcePreviewPanel } from './SourcePreview'

const table = '| Name | Count |\n| :--- | ---: |\n| **Mira** | 2 |'
const read = (content: string, path?: string) => renderToStaticMarkup(createElement(ContentReaderView, {
  title: 'Preview', content, contentKind: path ? 'file-reference' : 'markdown', path,
}))

describe('shared Markdown preview', () => {
  it.each([undefined, 'notes.md'])('renders aligned GFM tables in %s with a bounded scroll region', (path) => {
    const html = read(table, path)
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('text-align:right')
    expect(html).toContain('<strong>Mira</strong>')
    expect(html).toContain('v2-markdown-table')
    expect(html).toContain('aria-label="表格"')
  })
  it('renders task lists as disabled checkboxes, strikethrough and literal links', () => {
    const html = read('- [x] Done\n- [ ] Pending\n\n~~Old~~ https://example.com')
    expect(html).toContain('type="checkbox" disabled="" checked=""')
    expect(html).toContain('type="checkbox" disabled=""')
    expect(html).toContain('<del>Old</del>')
    expect(html).toContain('href="https://example.com"')
  })
  it('preserves headings, emphasis, lists, quotes, code, links and images', () => {
    const html = read('# Title\n\n**Bold** *Italic* `code`\n\n> Quote\n\n1. Item\n\n```js\nconst n = 1\n```\n\n[Link](https://example.com)\n\n![Alt](https://example.com/image.png)\n\n---')
    for (const fragment of ['<h1>', '<strong>', '<em>', '<code>', '<blockquote>', '<ol>', 'language-js', '<a href=', '<img src=', '<hr/>']) expect(html).toContain(fragment)
  })
  it('does not interpret non-Markdown files or execute embedded HTML and unsafe URLs', () => {
    expect(read(table, 'notes.txt')).not.toContain('<table>')
    const html = read('<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n<img src=x onerror=alert(1)>')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img ')
    expect(html).not.toContain('href="javascript:')
  })
  it('renders frozen Markdown sources using the same table parser', () => {
    const html = renderToStaticMarkup(createElement(SourcePreviewPanel, {
      request: { boardId: 'missing', cardId: 'removed', snapshot: {
        cardId: 'removed', versionId: 'v1', digest: 'frozen', contentKind: 'markdown', resolvedContent: table,
      } }, onClose() {},
    }))
    expect(html).toContain('<table>')
  })
  it('gives footnotes separate anchors in simultaneous readers', () => {
    const content = 'Text[^note]\n\n[^note]: Footnote'
    const html = renderToStaticMarkup(createElement(Fragment, null, ...['a', 'b'].map((title) =>
      createElement(ContentReaderView, { key: title, title, content, contentKind: 'markdown' }))))
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1])
    expect(ids.length).toBeGreaterThanOrEqual(4)
    expect(new Set(ids).size).toBe(ids.length)
    for (const [, href] of html.matchAll(/href="#([^"]+)"/g)) expect(ids).toContain(href)
    for (const [, label] of html.matchAll(/aria-describedby="([^"]+)"/g)) expect(ids).toContain(label)
  })
  it('routes canvas Markdown through the shared renderer', () => {
    const source = readFileSync(new URL('./ContentCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('MarkdownContent')
    expect(source).not.toContain("from 'react-markdown'")
  })
})
