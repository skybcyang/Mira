import { readStyles } from '../../test/helpers/read-styles.js'
import { describe, expect, it } from 'vitest'

const combinations = [
  ['studio', 'light'],
  ['studio', 'dark'],
  ['editorial', 'light'],
  ['editorial', 'dark'],
  ['blueprint', 'light'],
  ['blueprint', 'dark'],
] as const

const requiredColorTokens = [
  '--mira-canvas', '--mira-surface', '--mira-surface-subtle', '--mira-surface-hover',
  '--mira-ink', '--mira-muted', '--mira-faint', '--mira-border', '--mira-border-strong',
  '--mira-control-border', '--mira-accent', '--mira-accent-hover', '--mira-accent-soft',
  '--mira-on-accent', '--mira-warning', '--mira-warning-soft', '--mira-danger',
  '--mira-danger-soft', '--mira-on-danger', '--mira-grid', '--mira-minimap-node',
] as const

function selectorBlock(css: string, selector: string) {
  const escaped = selector.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? ''
}

function token(block: string, name: string) {
  return block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
}

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((part) => Number.parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

function contrast(left: string, right: string) {
  const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

describe('appearance CSS tokens', () => {
  it.each(combinations)('%s %s defines a complete, readable palette', async (direction, scheme) => {
    const css = await readStyles(new URL('../styles.css', import.meta.url))
    const block = selectorBlock(css, `:root[data-theme='${direction}'][data-color-scheme='${scheme}']`)
    for (const name of requiredColorTokens) expect(token(block, name), name).toBeTruthy()

    const surface = token(block, '--mira-surface')!
    expect(contrast(token(block, '--mira-ink')!, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(block, '--mira-muted')!, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(block, '--mira-faint')!, surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(block, '--mira-on-accent')!, token(block, '--mira-accent')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(block, '--mira-on-danger')!, token(block, '--mira-danger')!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(token(block, '--mira-control-border')!, surface)).toBeGreaterThanOrEqual(3)
    expect(contrast(token(block, '--mira-minimap-node')!, surface)).toBeGreaterThanOrEqual(3)
  })

  it.each(['studio', 'editorial', 'blueprint'])('%s defines its own geometry and typography', async (direction) => {
    const css = await readStyles(new URL('../styles.css', import.meta.url))
    const block = selectorBlock(css, `:root[data-theme='${direction}']`)
    for (const name of ['--mira-font-body', '--mira-font-display', '--mira-font-meta', '--mira-radius-card', '--mira-radius-control', '--mira-radius-panel', '--mira-shadow-card', '--mira-shadow-raised']) {
      expect(block, name).toContain(`${name}:`)
    }
  })
})
