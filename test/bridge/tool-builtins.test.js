import { expect, it } from 'vitest'
import { executeBuiltin } from '../../bridge/tool-builtins.js'
it('searches only frozen fragments and calculates without eval', async () => {
  expect(JSON.parse((await executeBuiltin('mira-source-search', { query: 'yes' }, { sources: [{ text: 'no\nyes' }] })).text)).toEqual([{ sourceIndex: 0, line: 2, text: 'yes' }])
  expect((await executeBuiltin('mira-calculator', { operation: 'sum', values: [0.1, 0.2] }, {})).text).toContain('0.30000000000000004')
  await expect(executeBuiltin('mira-calculator', { operation: 'divide', values: [1, 0] }, {})).rejects.toMatchObject({ code: 'TOOL_FAILED' })
})
it('parses quoted CSV and reports after-check diagnostics without editing output', async () => {
  const summary = JSON.parse((await executeBuiltin('mira-csv-summary', { sourceIndex: 0 }, { sources: [{ text: 'name,n\n"a,b",3\nc,5' }] })).text)
  expect(summary.rows).toBe(2); expect(summary.columns[1]).toMatchObject({ name: 'n', sum: 8, mean: 4 })
  expect(JSON.parse((await executeBuiltin('mira-output-check', { maxCharacters: 1 }, { output: 'abc' })).text).passed).toBe(false)
})
it('refuses URLs outside explicitly bound scope before network', async () => {
  let reads = 0
  await expect(executeBuiltin('mira-web-read', { url: 'https://other.example' }, {}, { urls: ['https://allowed.example'], web: async () => { reads++; return { text: 'x' } } })).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' })
  expect(reads).toBe(0)
})
