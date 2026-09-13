import { describe, expect, it } from 'vitest'
import * as settings from './executionSettings.js'
import { resolveGuidance } from './guidance.js'

describe('guidance text import and catalog', () => {
  it('imports the selected text as a draft, keeping code literal and rejecting invalid text files', () => {
    expect(settings).toHaveProperty('importGuidanceText')
    const imported = settings.importGuidanceText('review.md', '# 核对\n\n```python\nprint(1)\n```')
    expect(imported).toEqual({ title: 'review', text: '# 核对\n\n```python\nprint(1)\n```', origin: 'imported' })
    for (const [name, text] of [['review.py', 'code'], ['review.md', '\u0000'], ['review.md', 'x'.repeat(20001)], ['review.md', ' \n']]) {
      expect(() => settings.importGuidanceText(name, text)).toThrow()
    }
  })
  it('preserves frozen versions while offering only the current enabled project guidance', () => {
    const original = settings.updateExecutionSettings(settings.emptyExecutionSettings(), { baseRevision: 0, guidance: { title: '检查', text: '旧规则' } }, () => 'guidance-test')
    const frozen = resolveGuidance({ id: 'guidance-test', version: '1' }, settings.projectGuidance(original, false))
    const latest = settings.updateExecutionSettings(original, { baseRevision: 1, guidance: { id: 'guidance-test', title: '检查', text: '新规则' } }, () => 'unused')
    expect(settings.guidanceCatalog(latest).find(item => item.id === 'guidance-test')?.version).toBe('2')
    expect(frozen?.text).toBe('旧规则')
    expect(resolveGuidance({ id: 'guidance-test', version: '1' }, settings.projectGuidance(latest, false))).toEqual(frozen)
    const damaged = structuredClone(latest)
    damaged.guidance[0].text = 'changed'
    expect(() => settings.validateExecutionSettings(damaged)).toThrow()
    expect(() => settings.validateExecutionSettings({ ...latest, apiKey: 'must-not-be-stored' })).toThrow()
  })
})
