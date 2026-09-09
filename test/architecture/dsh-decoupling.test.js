import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

describe('DSH adapter boundary', () => {
  it('keeps the Mira application and stable entry free of DSH host services', async () => {
    const [entry, application, http, handlers, cordisPackage, bridgeBuild] = await Promise.all([
      readFile(new URL('bridge/main.js', root), 'utf8'),
      readFile(new URL('bridge/mira-application.js', root), 'utf8'),
      readFile(new URL('bridge/mira-http.js', root), 'utf8'),
      readFile(new URL('bridge/v2-http.js', root), 'utf8'),
      readFile(new URL('packages/mira-bridge/index.js', root), 'utf8'),
      readFile(new URL('scripts/build-bridge.mjs', root), 'utf8'),
    ])
    const dshHostTerms = /\bctx\b|\bagents\b|\bsubagents\b|\bsessionQuery\b|\bwebServer\b/

    expect(entry).not.toMatch(dshHostTerms)
    expect(application).not.toMatch(dshHostTerms)
    expect(http).not.toMatch(/DSH_UNAVAILABLE/)
    expect(handlers).not.toMatch(/DSH_UNAVAILABLE/)
    expect(entry).not.toMatch(/dsh-cordis-adapter/)
    expect(cordisPackage).toContain("'../../bridge/dsh-cordis-adapter.js'")
    expect(bridgeBuild).toContain("entryPoints: ['bridge/dsh-cordis-adapter.js']")
  })

  it('exposes the standalone host as the default production start path', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('package.json', root), 'utf8'),
    )

    expect(packageJson.scripts.start).toBe('node scripts/start-standalone.mjs')
    expect(packageJson.scripts['start:standalone']).toBe(
      'node scripts/start-standalone.mjs',
    )
    expect(packageJson.scripts['start:llm']).toContain(
      'MIRA_MODEL_ADAPTER=./bridge/openai-compatible-adapter.js',
    )
  })

  it('wires process-scoped model settings into the standalone host', async () => {
    const startScript = await readFile(
      new URL('scripts/start-standalone.mjs', root),
      'utf8',
    )

    expect(startScript).toContain("createModelSettingsService")
    expect(startScript).toContain('baseUrl: process.env.MIRA_LLM_BASE_URL')
    expect(startScript).toContain('model: process.env.MIRA_LLM_MODEL')
    expect(startScript).toContain('apiKey: process.env.MIRA_LLM_API_KEY')
    expect(startScript).toContain('modelSettings,')
  })
})
