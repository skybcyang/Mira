import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ContentCard } from '../domain'
import { searchCards } from '../v2View'
import { cardFocusViewport } from '../canvasOperations'
import CommandPalette from './CommandPalette'

const card = (id: string, markdown: string): ContentCard => ({
  id, contentKind: 'markdown', x: 5000, y: 3000, width: 312, height: 208,
  headVersionId: `${id}-v1`, createdAt: '', updatedAt: '',
  versions: [{ id: `${id}-v1`, cardId: id, sequence: 1, digest: id,
    origin: 'human', createdAt: '', content: { kind: 'markdown', markdown } }],
})

describe('current board card search', () => {
  const search = searchCards

  it('searches independent names while retaining body and file-path search', () => {
    const named = { ...card('named', '# 原标题\n正文关键词'), name: '项目方案' }
    const file = card('file', '')
    file.name = '技术材料'
    file.contentKind = 'file-reference'
    file.versions[0].content = { kind: 'file-reference', path: 'notes/source.md', readonly: true }
    expect(search([named, file], '项目')[0].title).toBe('项目方案')
    expect(search([named, file], '原标题')[0].title).toBe('项目方案')
    expect(search([named, file], '技术')[0].title).toBe('技术材料')
    expect(search([named, file], 'source.md')[0].title).toBe('技术材料')
  })

  it('matches titles and the full current body, case insensitively, with nearby excerpts', () => {
    const cards = [card('body', `# 企业方案\n${'背景说明。'.repeat(100)}管理员需要 Billing 权限。`), card('title', '# Billing 方案\n账单说明')]
    const snapshot = JSON.stringify(cards)
    const matches = search(cards, '  BILLING  ')
    expect(matches.map((item) => item.cardId)).toEqual(['title', 'body'])
    expect(matches[1].preview).toContain('Billing')
    expect(matches[1].preview.length).toBeLessThanOrEqual(162)
    expect(search(cards, '管理员')[0].cardId).toBe('body')
    expect(search(cards, '背景说明。'.repeat(100))[0].preview.length).toBeLessThanOrEqual(162)
    expect(JSON.stringify(cards)).toBe(snapshot)
  })

  it('does not search historical versions, another board, or an empty query', () => {
    const current = card('current', '# 当前方案\n新内容')
    current.versions.push({ ...current.versions[0], id: 'old', content: { kind: 'markdown', markdown: '历史秘密' } })
    expect(search([current], '历史秘密')).toEqual([])
    expect(search([current], '  ')).toEqual([])
    expect(search([card('other-board', '# 其他内容')], '当前方案')).toEqual([])
    expect(search([{ ...current, headVersionId: 'missing' }], '新内容')).toEqual([])
  })

  it('finds file references by path and distinguishes duplicate basenames without reading files', () => {
    const files = ['alpha', 'beta'].map((folder) => {
      const result = card(folder, '')
      result.contentKind = 'file-reference'
      result.versions[0].content = { kind: 'file-reference', path: `research/${folder}/brief.md`, readonly: true }
      return result
    })
    expect(search(files, 'brief.md').map((item) => item.title)).toEqual(['alpha/brief.md', 'beta/brief.md'])
    expect(search(files, 'research/beta')[0].preview).toBe('research/beta/brief.md')
    expect(search([card('literal', '# C++\n[a+b]')], '[a+b]')[0].cardId).toBe('literal')
  })

  it('exposes the expanded search scope in the existing accessible dialog', () => {
    const html = renderToStaticMarkup(createElement(CommandPalette, { open: true, commands: [], onClose: () => {} }))
    expect(html).toContain('aria-label="搜索卡片或命令"')
    expect(html).toContain('placeholder="搜索当前画板卡片或命令')
  })

  it('does not let delayed initial fitting override an explicit search or selection', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toMatch(/const timer = window.setTimeout\(\(\) => \{\s*if \([\s\S]{0,250}selectedCardIds\.length[\s\S]{0,250}v2-command-palette\[open\]/)
    const appBar = await readFile(new URL('./AppBar.tsx', import.meta.url), 'utf8')
    expect(appBar).toMatch(/rf\.setViewport\(viewport, \{ duration: 1 \}\)/)
  })
})

describe('readable card focus', () => {
  const focus = (area: { x: number; y: number; width: number; height: number }, width = 312, height = 208) => {
    return cardFocusViewport(
      { position: { x: 5000, y: 3000 }, width, height }, area,
    )
  }

  it('centers a distant card in the unobscured desktop or narrow area at readable zoom', () => {
    for (const area of [
      { x: 16, y: 64, width: 1000, height: 520 },
      { x: 16, y: 64, width: 358, height: 380 },
    ]) {
      const viewport = focus(area)
      expect(viewport.zoom).toBeGreaterThanOrEqual(0.8)
      expect(viewport.zoom).toBeLessThanOrEqual(1)
      const left = 5000 * viewport.zoom + viewport.x
      const top = 3000 * viewport.zoom + viewport.y
      expect(left).toBeGreaterThanOrEqual(area.x)
      expect(top).toBeGreaterThanOrEqual(area.y)
      expect(left + 312 * viewport.zoom).toBeLessThanOrEqual(area.x + area.width)
      expect(top + 208 * viewport.zoom).toBeLessThanOrEqual(area.y + area.height)
    }
  })

  it('keeps oversized content readable and starts at its top instead of shrinking it away', () => {
    const area = { x: 16, y: 60, width: 358, height: 400 }
    const viewport = focus(area, 1800, 2000)
    expect(viewport.zoom).toBe(0.8)
    expect(5000 * viewport.zoom + viewport.x).toBe(area.x)
    expect(3000 * viewport.zoom + viewport.y).toBe(area.y)
  })
})
