import { expect, it, vi } from 'vitest'
import { runQualityMatrix } from '../../scripts/quality-matrix.mjs'

const cases = () => ['mira-close-reading', 'mira-evidence-review', 'mira-revision'].flatMap(guidanceId => [1, 2].map(number => ({
  id: `${guidanceId}-${number}`, title: 'Explicit fixture', guidanceId, guidanceVersion: '1.0.1', material: 'Selected evidence', instruction: 'Read this', acceptance: 'Cite this material', sourceDescription: { nature: 'test' }, existingSource: { id: 'source', headVersionId: 'source-version' },
})))
it('refuses incomplete quality input before creating or running anything', async () => {
  const api = vi.fn(), persist = vi.fn()
  await expect(runQualityMatrix({ cases: cases().slice(1), api, persist, boardId: 'qa' })).rejects.toThrow('six distinct')
  expect(api).not.toHaveBeenCalled(); expect(persist).not.toHaveBeenCalled()
})
it('retains actual Candidate output without claiming it was adopted', async () => {
  const api = async path => path.endsWith('/transformations') ? { transformation: { id: 'step' } }
    : path.endsWith('/runs') ? { run: { id: 'run', status: 'succeeded', targetCardId: 'target', sourceSnapshot: [], result: { disposition: 'candidate', output: 'Actual candidate text' } } }
      : { board: { cards: [] } }
  const report = await runQualityMatrix({ cases: cases(), api, boardId: 'qa', persist: async () => {} })
  expect(report.cases.flatMap(item => item.variants).every(item => item.output === 'Actual candidate text' && item.run.result.disposition === 'candidate')).toBe(true)
})
