import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../src/', import.meta.url)
const slices = {
  boardSlice: ['createBoardSlice', 'async switchBoard(', 'async archiveBoard(', 'async importBoardFile('],
  cardSlice: ['createCardSlice', 'async commitCard(', 'async bindCardFile(', 'async restoreVersion('],
  canvasSlice: ['createCanvasSlice', 'async function replayHistory(', 'onNodesChange(', 'async confirmDeleteSelectedCards('],
  workflowSlice: ['createWorkflowSlice', 'async materializeWorkflowDraft(', 'async createWorkflowFromTransformation('],
  transformationSlice: ['createTransformationSlice', 'async generate(', 'async updateTransformation('],
}

describe('canvas store slice ownership', () => {
  it('keeps the root store as composition rather than a command implementation', async () => {
    const source = await readFile(new URL('v2Store.ts', root), 'utf8')
    expect(source.includes('v2Api.')).toBe(false)
    expect(source.includes('async function replayHistory(')).toBe(false)
    for (const [name, [factory]] of Object.entries(slices)) {
      expect(source.includes(`from './v2/${name}'`), name).toBe(true)
      expect(source.includes(`${factory}(`), name).toBe(true)
    }
  })

  it.each(Object.entries(slices))('%s owns its commands without importing the root store', async (name, markers) => {
    const source = await readFile(new URL(`v2/${name}.ts`, root), 'utf8')
    expect(source.includes("from '../v2Store'")).toBe(false)
    for (const marker of markers) expect(source.includes(marker), marker).toBe(true)
  })

  it('centralizes navigation generations, refresh write ordering, history capacity and projection', async () => {
    const source = await readFile(new URL('v2/storeContext.ts', root), 'utf8')
    for (const marker of ['createCanvasStoreContext', 'boardWriteSequences', 'boardRefreshes', 'function contextIsCurrent(', 'function project(', 'HISTORY_LIMIT = 50']) {
      expect(source.includes(marker), marker).toBe(true)
    }
  })
})
