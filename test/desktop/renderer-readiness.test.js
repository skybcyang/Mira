import { describe, expect, it, vi } from 'vitest'
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
    })

    await expect(verifyRendererReady({ executeJavaScript })).resolves.toBeUndefined()
    expect(executeJavaScript).toHaveBeenCalledWith(RENDERER_READINESS_SCRIPT, true)
    expect(RENDERER_READINESS_SCRIPT).toContain('/graphmind/api/v2/boards')
    expect(RENDERER_READINESS_SCRIPT).toContain('document.styleSheets')
    expect(RENDERER_READINESS_SCRIPT).toContain("document.getElementById('root')")
  })

  it.each([
    { apiReady: false, mounted: true, styled: true },
    { apiReady: true, mounted: false, styled: true },
    { apiReady: true, mounted: true, styled: false },
  ])('rejects an incomplete renderer state: %o', async (state) => {
    await expect(verifyRendererReady({
      executeJavaScript: vi.fn().mockResolvedValue(state),
    })).rejects.toThrow('renderer did not become ready')
  })
})
