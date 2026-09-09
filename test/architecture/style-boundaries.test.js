import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// Use the CSS parser already owned by the frontend build, without another dependency.
const require = createRequire(import.meta.url)
const postcss = createRequire(require.resolve('vite/package.json'))('postcss')
const entry = new URL('../../src/styles.css', import.meta.url)
const modules = [
  'tokens.css',
  'base-and-app-bar.css',
  'file-picker.css',
  'canvas.css',
  'context-dock.css',
  'inspiration-picker.css',
  'board-history.css',
  'drawer-content.css',
  'transformation-detail.css',
  'run-and-model-settings.css',
  'workflow-library.css',
  'notices-and-plan-draft.css',
  'board-manager.css',
  'appearance.css',
  'command-palette.css',
  'responsive-desktop.css',
  'responsive-mobile.css',
  'accessibility.css',
]

function canonical(node) {
  return Object.fromEntries(
    ['type', 'selector', 'name', 'params', 'prop', 'value', 'important']
      .filter((key) => node[key] !== undefined)
      .map((key) => [key, node[key]])
      .concat(node.nodes ? [['nodes', node.nodes.filter((child) => child.type !== 'comment').map(canonical)]] : []),
  )
}

describe('stylesheet boundaries', () => {
  it('keeps the entry import-only and locks the complete cascade order', async () => {
    const root = postcss.parse(await readFile(entry, 'utf8'))
    const nodes = root.nodes.filter((node) => node.type !== 'comment')
    expect(nodes.every((node) => node.type === 'atrule' && node.name === 'import')).toBe(true)
    expect(nodes.map((node) => node.params)).toEqual(modules.map((name) => `'./styles/${name}'`))
  })

  it('imports each bounded, non-nested style module exactly once', async () => {
    expect((await readdir(new URL('../../src/styles/', import.meta.url))).sort()).toEqual([...modules].sort())
    for (const name of modules) {
      const css = await readFile(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8')
      expect(css.trim(), name).not.toBe('')
      expect(css.split('\n').length, name).toBeLessThanOrEqual(900)
      postcss.parse(css).walkAtRules('import', () => { throw new Error(`Nested import in ${name}`) })
    }
  })

  it('preserves every baseline selector, declaration, media query and their order', async () => {
    const { readStyles } = await import('../helpers/read-styles.js')
    const root = postcss.parse(await readStyles(entry))
    root.walkRules((rule) => {
      if (/\.v2-board-history|\.v2-version-(?:current|diff-empty|restore-confirm)/.test(rule.selector)) rule.remove()
    })
    root.walkAtRules((rule) => { if (rule.nodes?.length === 0) rule.remove() })
    const digest = createHash('sha256').update(JSON.stringify(canonical(root))).digest('hex')
    // Unified board navigation and plan form; adaptive owners remain unchanged.
    expect(digest).toBe('33b065b66e03181ef9e6cdf9ef5d5206b848b5ea87b2916f7bb6b04eb6dd9216')
  })

  it('keeps token definitions, feature bases and adaptive overrides with their owners', async () => {
    const featureBases = new Map([
      ['.v2-file-picker', 'file-picker.css'],
      ['.v2-card', 'canvas.css'],
      ['.v2-context-dock', 'context-dock.css'],
      ['.v2-inspiration-picker', 'inspiration-picker.css'],
      ['.v2-board-history', 'board-history.css'],
      ['.v2-content-detail', 'drawer-content.css'],
      ['.v2-transformation-edit-form', 'transformation-detail.css'],
      ['.v2-run-state', 'run-and-model-settings.css'],
      ['.v2-workflow-list', 'workflow-library.css'],
      ['.v2-notice-region', 'notices-and-plan-draft.css'],
      ['.v2-board-manager', 'board-manager.css'],
      ['.v2-command-palette', 'command-palette.css'],
    ])
    const seen = new Set()
    for (const name of modules) {
      const root = postcss.parse(await readFile(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8'))
      root.walkDecls(/^--mira-/, () => expect(name).toBe('tokens.css'))
      root.walkAtRules('media', () => {
        expect(['responsive-desktop.css', 'responsive-mobile.css', 'accessibility.css']).toContain(name)
      })
      for (const node of root.nodes) {
        if (!featureBases.has(node.selector) || seen.has(node.selector)) continue
        expect(name, node.selector).toBe(featureBases.get(node.selector))
        seen.add(node.selector)
      }
    }
    expect([...seen].sort()).toEqual([...featureBases.keys()].sort())
  })
})
