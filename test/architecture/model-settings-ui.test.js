import { readStyles } from '../helpers/read-styles.js'
import { describe, expect, it } from 'vitest'

describe('model settings layout', () => {
  it('uses the established drawer width and a full-width mobile layout', async () => {
    const css = await readStyles(new URL('../../src/styles.css', import.meta.url))

    expect(css).toMatch(/\.v2-model-settings[^}]*width:\s*420px/s)
    expect(css).toMatch(/@media \(max-width: 719px\)[\s\S]*\.v2-model-settings[^}]*width:\s*100%/)
    expect(css).toMatch(/\.v2-model-settings-form\s*>\s*footer[^}]*margin-top:\s*auto/s)
  })
})
