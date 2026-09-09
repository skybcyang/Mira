import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const moduleUrl = new URL('./inspiration.ts', import.meta.url)

async function readInspirationSource(): Promise<string | null> {
  try {
    return await readFile(moduleUrl, 'utf8')
  } catch {
    return null
  }
}

function hasNamedValueExport(source: string, name: string): boolean {
  const declaration = new RegExp(
    `export\\s+(?:(?:async\\s+)?function|const)\\s+${name}\\b`,
  )
  const exportList = new RegExp(`export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`, 's')
  return declaration.test(source) || exportList.test(source)
}

describe('inspiration picker pure contract', () => {
  it('keeps inspiration filtering and selection policy in a dedicated module', async () => {
    const source = await readInspirationSource()

    expect(source, 'src/v2/inspiration.ts must exist').not.toBeNull()
  })

  it('exports capture, filtering, ordered selection, and snapshot mapping APIs', async () => {
    const source = await readInspirationSource()

    expect(source, 'src/v2/inspiration.ts must exist before checking its exports').not.toBeNull()
    if (!source) return

    expect(hasNamedValueExport(source, 'mapInspirationCaptureToCardInput')).toBe(true)
    expect(hasNamedValueExport(source, 'filterInspirationCards')).toBe(true)
    expect(hasNamedValueExport(source, 'toggleInspirationSelection')).toBe(true)
    expect(hasNamedValueExport(source, 'mapInspirationSelectionToSnapshots')).toBe(true)
  })
})
