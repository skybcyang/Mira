import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('content detail inspiration metadata', () => {
  it('offers common tags, custom tag input, and source provenance', async () => {
    const source = (await Promise.all([
      readFile(new URL('./detail/ContentPanel.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./detail/ContentViews.tsx', import.meta.url), 'utf8'),
    ])).join('\n')

    expect(source).toMatch(/updateCardTags/)
    expect(source).toContain('主意')
    expect(source).toContain('约束')
    expect(source).toContain('技术')
    expect(source).toContain('事件')
    expect(source).toMatch(/添加标签|输入标签/)
    expect(source).toContain('来自灵感池')
    expect(source).toMatch(/inspirationRef/)
  })
})
