import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('bridge Cordis bundle', () => {
  it('builds an executable function body even when the entry has named exports', () => {
    execFileSync(process.execPath, ['scripts/build-bridge.mjs'], {
      cwd: process.cwd(),
      stdio: 'pipe',
    })

    const body = readFileSync('dist-bridge/bridge.cordis.js', 'utf8')
    const plugin = new Function(body)()

    expect(plugin).toMatchObject({
      name: 'mira-bridge',
      inject: ['webServer', 'agents'],
    })
    expect(plugin.apply).toBeTypeOf('function')
    expect(body).not.toMatch(/\bexport\s*\{/)
  })
})
