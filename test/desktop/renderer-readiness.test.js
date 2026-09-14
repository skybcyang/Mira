import { describe, expect, it, vi } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  RENDERER_READINESS_SCRIPT,
  verifyRendererReady,
} from '../../desktop/renderer-readiness.mjs'

describe('desktop renderer readiness', () => {
  it('requires mounted React content, loaded styles, and an authenticated API response', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue({
      apiReady: true,
      mounted: true,
      styled: true,
      projectReady: true,
    })

    await expect(verifyRendererReady({ executeJavaScript })).resolves.toBeUndefined()
    expect(executeJavaScript).toHaveBeenCalledWith(RENDERER_READINESS_SCRIPT, true)
    expect(RENDERER_READINESS_SCRIPT).toContain('/graphmind/api/v2/boards')
    expect(RENDERER_READINESS_SCRIPT).toContain('document.styleSheets')
    expect(RENDERER_READINESS_SCRIPT).toContain("document.getElementById('root')")
  })

  it.each([
    { apiReady: false, mounted: true, styled: true, projectReady: true },
    { apiReady: true, mounted: false, styled: true, projectReady: true },
    { apiReady: true, mounted: true, styled: false, projectReady: true },
    { apiReady: true, mounted: true, styled: true, projectReady: false },
  ])('rejects an incomplete renderer state: %o', async (state) => {
    await expect(verifyRendererReady({
      executeJavaScript: vi.fn().mockResolvedValue(state),
    })).rejects.toThrow('renderer did not become ready')
  })

  it('waits for project and remembered board hydration before declaring the mounted UI ready', async () => {
    let ready = false
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ boards: [] }) }))
    const result = await runInNewContext(RENDERER_READINESS_SCRIPT, {
      document: {
        getElementById: () => ({ childElementCount: 1, textContent: 'Mira' }),
        styleSheets: [{}],
        querySelector: () => ({ getAttribute: () => ready ? 'true' : 'false' }),
      },
      fetch,
      setTimeout: callback => { expect(fetch).not.toHaveBeenCalled(); ready = true; callback() },
    })
    expect(result).toMatchObject({ projectReady: true, apiReady: true })
  })

  it('rejects a project hydration error even if the board listing API is healthy', async () => {
    const result = await runInNewContext(RENDERER_READINESS_SCRIPT, {
      document: {
        getElementById: () => ({ childElementCount: 1, textContent: '加载失败' }),
        styleSheets: [{}], querySelector: () => ({ getAttribute: () => 'error' }),
      },
      fetch: async () => ({ ok: true, json: async () => ({ boards: [] }) }),
      setTimeout: () => { throw new Error('must reject failed hydration without waiting') },
    })
    await expect(verifyRendererReady({ executeJavaScript: async () => result })).rejects.toThrow('project did not become ready')
  })
})
