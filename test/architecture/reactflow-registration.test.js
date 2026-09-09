import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('React Flow component registration', () => {
  it('keeps nodeTypes stable across StrictMode remounts', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../src/App.tsx'), 'utf8')
    const registration = source.indexOf('const nodeTypes =')
    const canvasComponent = source.indexOf('function V2Canvas(')

    expect(registration).toBeGreaterThan(-1)
    expect(registration).toBeLessThan(canvasComponent)
    expect(source).not.toContain('useMemo(() => ({ contentCard:')
  })
})
