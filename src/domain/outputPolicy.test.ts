import { describe, expect, it } from 'vitest'
import { checkOutput, listOutputPolicies, resolveOutputPolicy, validateOutputPolicy, validateOutputCheck } from './outputPolicy.js'

describe('output policy', () => {
  it('freezes the actual rule and rejects damaged, unknown, or excessive fields', () => {
    const policy = resolveOutputPolicy({ id: 'concise', version: '1.0.0', text: '只写必要结论。', maxCharacters: 20 })!
    expect(policy).toMatchObject({ customized: true, format: 'auto', maxCharacters: 20 })
    expect(() => validateOutputPolicy(policy)).not.toThrow()
    expect(() => validateOutputPolicy({ ...policy, text: 'changed' })).toThrow()
    expect(() => validateOutputPolicy({ ...policy, execute: 'anything' })).toThrow()
    expect(() => resolveOutputPolicy({ id: 'missing', version: '1.0.0' })).toThrow()
    for (const maxCharacters of [0, -1, 1.5, 100001, '20', null]) {
      expect(() => resolveOutputPolicy({ id: 'concise', version: '1.0.0', maxCharacters })).toThrow()
    }
    expect(resolveOutputPolicy(null)).toBeUndefined()
    expect(resolveOutputPolicy(undefined)?.id).toBe('concise')
    expect(listOutputPolicies()).toHaveLength(3)
  })

  it('counts Unicode code points including whitespace without altering the output', () => {
    const policy = resolveOutputPolicy({ id: 'concise', version: '1.0.0', maxCharacters: 4 })!
    const output = '你😀\n好。'
    const result = checkOutput(output, policy)
    expect(result).toEqual({ version: '1', characters: 5, maxCharacters: 4, lengthPassed: false, format: 'auto' })
    expect(checkOutput(output, undefined)).toBeUndefined()
    expect(() => validateOutputCheck(result, output, policy)).not.toThrow()
    expect(() => validateOutputCheck({ ...result, lengthPassed: true }, output, policy)).toThrow()
    expect(() => validateOutputCheck(result, output + 'x', policy)).toThrow()
  })

  it.each([
    ['paragraphs', '# 结论\n\n这是正文。', true],
    ['paragraphs', '- 列表', false],
    ['list', '# 结论\n\n1. 一点\n2. 二点', true],
    ['list', '- ', false],
    ['paragraphs', '# 只有标题', false],
    ['list', '- 一点\n\n多余的解释', false],
    ['table', '| 结论 | 依据 |\n| --- | --- |\n| A | B |', true],
    ['table', '```\n| A | B |\n| - | - |\n| C | D |\n```', false],
    ['table', '| 看似表格 | 没有分隔 |', false],
  ] as const)('checks actual Markdown structure: %s', (format, output, passed) => {
    const policy = resolveOutputPolicy({ id: 'balanced', version: '1.0.0', format })!
    expect(checkOutput(output, policy)?.formatPassed).toBe(passed)
  })
})
