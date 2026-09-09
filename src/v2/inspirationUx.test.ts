import { readStyles } from '../../test/helpers/read-styles.js'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readOptional(path: string): Promise<string | null> {
  try {
    return await readFile(new URL(path, import.meta.url), 'utf8')
  } catch {
    return null
  }
}

describe('inspiration picker UI contract', () => {
  it('exposes inspiration from the app bar and lazy-loads the picker feature', async () => {
    const [appBar, app] = await Promise.all([
      readOptional('./AppBar.tsx'),
      readOptional('../App.tsx'),
    ])

    expect(appBar).not.toBeNull()
    expect(app).not.toBeNull()
    if (!appBar || !app) return
    expect(appBar).toContain('灵感')
    expect(appBar).toMatch(/openInspirationPicker/)
    expect(app).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\/v2\/InspirationPicker['"]\)\)/)
  })

  it('presents a modal search task with source, filters, ordered selection, and one confirm command', async () => {
    const source = await readOptional('./InspirationPicker.tsx')

    expect(source, 'src/v2/InspirationPicker.tsx must exist').not.toBeNull()
    if (!source) return
    expect(source).toMatch(/role=["']dialog["']/)
    expect(source).toMatch(/aria-modal=(?:["']true["']|\{true\})/)
    expect(source).toContain('灵感池')
    expect(source).toMatch(/搜索灵感|搜索想法、约束、技术或事件/)
    expect(source).toMatch(/aria-pressed/)
    expect(source).toContain('已选')
    expect(source).toMatch(/上移|前移/)
    expect(source).toMatch(/下移|后移/)
    expect(source).toMatch(/移除/)
    expect(source).toContain('添加到当前画板')
  })

  it('provides a separate direct capture form before selection and import', async () => {
    const [source, styles] = await Promise.all([
      readOptional('./InspirationPicker.tsx'),
      readStyles(new URL('../styles.css', import.meta.url)).catch(() => null),
    ])

    expect(source, 'src/v2/InspirationPicker.tsx must exist').not.toBeNull()
    expect(styles, 'src/styles.css must exist').not.toBeNull()
    if (!source || !styles) return
    expect(source).toContain('记录灵感')
    expect(source).toContain('保存灵感')
    expect(source).toMatch(/<textarea\b/)
    expect(source).toMatch(/recordInspiration/)
    expect(source).toMatch(/aria-controls=["']v2-inspiration-capture["']/)
    expect(source).toMatch(/aria-expanded=/)
    expect(source).toMatch(/aria-live=["']polite["']/)
    expect(source).toMatch(/主意.*约束.*技术.*事件/s)
    expect(source).toContain('添加到当前画板')
    expect(styles).toMatch(
      /\.v2-inspiration-capture-selected button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    )
  })

  it('defines result and selected tabs for the full-screen mobile sheet', async () => {
    const source = await readOptional('./InspirationPicker.tsx')

    expect(source, 'src/v2/InspirationPicker.tsx must exist').not.toBeNull()
    if (!source) return
    expect(source).toMatch(/role=["']tablist["']/)
    expect(source).toMatch(/aria-selected/)
    expect(source).toContain('结果')
    expect(source).toContain('已选')
  })

  it('keeps pool results static and supports full reading without changing selection', async () => {
    const [source, styles] = await Promise.all([
      readOptional('./InspirationPicker.tsx'),
      readStyles(new URL('../styles.css', import.meta.url)).catch(() => null),
    ])

    expect(source).not.toBeNull()
    expect(styles).not.toBeNull()
    if (!source || !styles) return
    expect(source).toContain('getInspirationPool')
    expect(source).toContain('已记录到灵感池')
    expect(source).not.toContain('sourceBoardId')
    expect(styles).not.toMatch(/\.v2-inspiration-result:hover\s*\{[^}]*transform:/s)
    expect(styles).not.toContain('@keyframes mira-inspiration-enter')
    expect(source).toContain('阅读全文')
    expect(source).toContain('摘要')
    expect(source).toContain('列表')
    expect(styles).toContain('prefers-reduced-motion')
  })

  it('returns to the original task after cancel or completion', async () => {
    const [source, app] = await Promise.all([
      readOptional('./InspirationPicker.tsx'),
      readOptional('../App.tsx'),
    ])
    expect(source).not.toBeNull()
    expect(app).not.toBeNull()
    if (!source || !app) return
    expect(source).toContain("onClose: (outcome: 'cancel' | 'complete') => void")
    expect(source).toContain("onClose('cancel')")
    expect(source).toContain("onClose('complete')")
    expect(app).not.toMatch(/onAdded=\{\(cardIds\) => \{[\s\S]*setSelectedCardIds\(cardIds\)/)
    expect(app).toContain('restoreModalTaskFocus')
  })

  it('handles native modal Escape before underlying source selection or preview', async () => {
    const app = await readOptional('../App.tsx')
    const handler = app!.slice(app!.indexOf('const onKeyDown = (event: KeyboardEvent)'))
    expect(handler.indexOf("closest('dialog')")).toBeGreaterThanOrEqual(0)
    expect(handler.indexOf("closest('dialog')")).toBeLessThan(handler.indexOf('sourcePicker'))
  })
})
