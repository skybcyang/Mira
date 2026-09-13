import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createV2Handlers } from '../../bridge/v2-http.js'

describe('explicit content intent', () => {
  it('has no recommendation timer, store command or HTTP endpoint', () => {
    for (const path of ['src/v2/ContextDock.tsx', 'src/v2/transformationSlice.ts', 'src/v2Api.ts', 'bridge/v2-routes.js']) {
      const source = readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
      expect(source, path).not.toMatch(/requestSuggestions|\/suggestions|handlers\.suggest/)
    }
    expect(createV2Handlers({ store: {}, runStore: {} })).not.toHaveProperty('suggest')
  })
})
