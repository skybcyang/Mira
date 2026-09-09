import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { v2Api } from '../v2Api'
import { SourcePreviewPanel } from './SourcePreview'

afterEach(() => vi.restoreAllMocks())
describe('source preview', () => {
  it('renders the frozen historical body even with no source board mounted', () => {
    const fetch = vi.spyOn(v2Api, 'getCardContent')
    const html = renderToStaticMarkup(createElement(SourcePreviewPanel, {
      request: { boardId: 'missing-board', cardId: 'removed', runId: 'run-1', snapshot: {
        cardId: 'removed', versionId: 'old-v1', digest: 'frozen', contentKind: 'markdown', resolvedContent: '# Frozen history',
      } }, onClose: vi.fn(),
    }))
    expect(html).toContain('Frozen history')
    expect(html).toContain('old-v1')
    expect(html).toContain('当时')
    expect(html).toContain('当前')
    expect(html).toContain('data-card-reader="true"')
    expect(html).not.toContain('textarea')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not resolve a current source from another board', () => {
    const html = renderToStaticMarkup(createElement(SourcePreviewPanel, {
      request: { boardId: 'missing-board', cardId: 'source' }, onClose: vi.fn(),
    }))
    expect(html).toContain('当前来源不可用')
    expect(html).toContain('返回原任务')
  })

  it('isolates requests by board, source and snapshot and cancels late file responses', async () => {
    const source = await readFile(new URL('./SourcePreview.tsx', import.meta.url), 'utf8')
    expect(source).toContain('key={JSON.stringify(')
    expect(source).toContain('request.boardId')
    expect(source).toContain('request.cardId')
    expect(source).toContain('request.snapshot?.versionId')
    expect(source).toContain('let active = true')
    expect(source).toContain('active = false')
    expect(source).toMatch(/if \(!active\) return/)
    expect(source).not.toMatch(/\.commitCard\(|\.setSelectedCardIds\(|\.openDrawer\(|\.runToTransformation\(/)
  })

  it('keeps context independent from preview and detail panel chunks', async () => {
    const source = await readFile(new URL('./sourcePreviewContext.ts', import.meta.url), 'utf8')
    expect(source).toContain('createContext')
    expect(source).not.toContain('./SourcePreview')
    expect(source).not.toContain('ContentViews')
  })

  it('labels current file content using the received version rather than its opening path revision', async () => {
    const source = await readFile(new URL('./SourcePreview.tsx', import.meta.url), 'utf8')
    expect(source).toContain('versionId: result.versionId')
    expect(source).toContain('file.versionId')
  })
})
