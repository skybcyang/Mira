import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('organization UI integration', () => {
  it('registers a distinct group node, not another Card type', async () => {
    const app = await readFile(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toContain('canvasGroup: CanvasGroupNode')
  })
  it('exposes organization controls alongside the existing selection toolbar', async () => {
    const toolbar = await readFile(new URL('./CanvasSelectionToolbar.tsx', import.meta.url), 'utf8')
    expect(toolbar).toContain('CanvasOrganizationControls')
    expect(toolbar).toContain('GroupSelectionToolbar')
  })
  it('keeps visual card color separate from run and selection state', async () => {
    const source = await readFile(new URL('./ContentCard.tsx', import.meta.url), 'utf8')
    expect(source).toContain('data-card-color={data.card.color}')
  })
})
