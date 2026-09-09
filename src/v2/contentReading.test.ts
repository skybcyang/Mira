import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { ContentEditorView } from './detail/ContentViews'

describe('content reading presentation', () => {
  it('protects unsaved tags and locks tag editing during continuous submission', () => {
    const source = readFileSync(new URL('./detail/ContentPanel.tsx', import.meta.url), 'utf8')
    expect(source).toContain('nextBlocked={nextBlocked || tagsDirty || nameDirty}')
    expect(source).toContain('<fieldset disabled={continuing}')
  })
  it('does not cancel a submitted draft through Escape while saving', () => {
    const source = readFileSync(new URL('./detail/ContentViews.tsx', import.meta.url), 'utf8')
    expect(source).toContain('if (!saving) onCancel()')
  })
  it('exposes read-only run preview and explicit source comparison from relations', () => {
    const source = readFileSync(new URL('./detail/RelationPanel.tsx', import.meta.url), 'utf8')
    expect(source).toContain('RunRangePreview')
    expect(source).toContain('sourceComparisonRows')
  })
  it('excludes preserved hidden editors from mobile focus traversal', () => {
    const source = readFileSync(new URL('./useMobilePanelModal.ts', import.meta.url), 'utf8')
    expect(source).toContain('element.getClientRects().length > 0')
    expect(source).toContain('visiblePanel()')
  })
  it('keeps one expanded drawer with a preserved source companion', () => {
    const source = readFileSync(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8')
    expect(source).toContain('is-expanded')
    expect(source).toContain('SourcePreviewPanel')
    expect(source).toContain('initialMode={drawer.mode}')
  })
  it('keeps the draft editor mounted while reading unsaved content', () => {
    const html = renderToStaticMarkup(createElement(ContentEditorView, {
      title: '报告', content: '# 未保存正文', dirty: true, saving: false,
      onChange() {}, onSave() {}, onCancel() {}, mode: 'read', onModeChange() {},
    }))
    expect(html).toContain('aria-label="正文呈现"')
    expect(html).toContain('textarea')
    expect(html).toContain('hidden=""')
    expect(html).toContain('未保存正文')
    expect(html).toContain('未保存的草稿')
  })
  it('offers a distinct guarded save-and-new action', () => {
    const html = renderToStaticMarkup(createElement(ContentEditorView, {
      title: '报告', content: '', dirty: false, saving: false,
      onChange() {}, onSave() {}, onCancel() {}, onSaveNext() {},
    }))
    expect(html).toContain('保存并新建')
    expect(html).toMatch(/disabled=""[^>]*>.*?保存并新建/s)
  })
})
