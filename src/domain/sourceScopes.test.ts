import { describe, expect, it } from 'vitest'
import * as scopes from './sourceScopes.js'

describe('explicit source text ranges', () => {
  it('keeps user order, exact Unicode and CRLF slices with real line positions', () => {
    const result = scopes.assembleScopedText('甲😀\r\n乙\r\n甲😀', [{ start: 8, end: 11 }, { start: 0, end: 3 }])
    expect(result.resolvedContent).toBe('【片段 1 · 原文第 3–3 行】\n甲😀\n\n【片段 2 · 原文第 1–1 行】\n甲😀')
    expect(result.lines).toEqual([{ startLine: 3, endLine: 3 }, { startLine: 1, endLine: 1 }])
    expect(scopes.assembleScopedText('a\r\nb\r\n', [{ start: 0, end: 3 }]).lines).toEqual([{ startLine: 1, endLine: 1 }])
  })
  it('rejects empty, overlapping, out-of-bounds and split Unicode ranges', () => {
    for (const spans of [[], [{ start: 0, end: 1 }, { start: 0, end: 1 }], [{ start: 0, end: 5 }], [{ start: 1, end: 2 }], [{ start: 0, end: 1.1 }]]) {
      expect(() => scopes.assembleScopedText('甲😀', spans)).toThrow()
    }
    expect(() => scopes.assembleScopedText(' \n ', [{ start: 0, end: 3 }])).toThrow()
  })
  it('binds a confirmed range to the full text and source version', async () => {
    const scope = { cardId: 'a', mode: 'ranges' as const, versionId: 'v1', contentDigest: await scopes.contentDigest('前文\n选中'), spans: [{ start: 3, end: 5 }] }
    expect(await scopes.resolveSourceScope('前文\n选中', scope, 'v1')).toMatchObject({ resolvedContent: expect.stringContaining('选中') })
    await expect(scopes.resolveSourceScope('变化\n选中', scope, 'v1')).rejects.toMatchObject({ code: 'SOURCE_SCOPE_CHANGED' })
    await expect(scopes.resolveSourceScope('前文\n选中', scope, 'v2')).rejects.toMatchObject({ code: 'SOURCE_VERSION_CHANGED' })
    expect(() => scopes.validateSourceScopes([{ ...scope, text: 'unselected text' }], ['a'])).toThrow()
    expect(() => scopes.validateSourceScopes([scope, scope], ['a'])).toThrow()
  })
  it('selects Markdown chapters and ignores fenced and indented code headings', () => {
    const text = '# A\r\nintro\r\n```md\r\n# false\r\n```\r\n## Child\r\nchild\r\n    # code\r\n# B\r\nend'
    const chapters = scopes.textChapters(text)
    expect(chapters.map(chapter => chapter.title)).toEqual(['A', 'Child', 'B'])
    expect(text.slice(chapters[0].start, chapters[0].end)).toBe(text.slice(0, text.indexOf('# B')))
    expect(chapters[1].end).toBe(chapters[0].end)
  })
  it('maps native textarea LF positions to original CRLF text without guessing duplicate text', () => {
    const text = '同文\r\n同文\r\n😀'
    expect(scopes.nativeSelectionSpan(text, 3, 5)).toEqual({ start: 4, end: 6 })
    expect(scopes.nativeSelectionSpan(text, 6, 8)).toEqual({ start: 8, end: 10 })
  })
  it('recognizes Setext headings with original offsets and ignores thematic breaks', () => {
    const text = 'Chapter A\r\n=========\r\nbody\r\n\r\n---\r\n\r\nChapter B\r\n=========\r\nend'
    const chapters = scopes.textChapters(text)
    expect(chapters.map(chapter => chapter.title)).toEqual(['Chapter A', 'Chapter B'])
    expect(chapters[0].end).toBe(text.indexOf('Chapter B'))
  })
})
