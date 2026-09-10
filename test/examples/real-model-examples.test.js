import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { validateWorkspaceBackup } from '../../bridge/domain/workspace-backup.js'

const root = new URL('../../docs/examples/', import.meta.url)
const names = ['software', 'reading', 'research', 'writing']
const read = async name => JSON.parse(await readFile(new URL(name, root), 'utf8'))

describe('published examples generated through real model Runs', () => {
  it.each(names)('%s preserves real Kimi results and frozen evidence', async name => {
    const artifact = await read(`${name}.mira-board.json`)
    expect(() => validateBoardArtifact(artifact)).not.toThrow()
    expect(artifact.runs.length).toBeGreaterThanOrEqual(3)
    const evidence = JSON.parse(await readFile(new URL('../../docs/validation/evidence/2026-09-10-kimi-example-receipts.json', import.meta.url), 'utf8'))
    for (const run of artifact.runs) {
      const receipt = evidence.receipts.find(item => item.runId === run.id)
      expect(receipt?.responseModel).toBe('k3')
      expect(receipt?.responseId).toBeTruthy()
      expect(receipt?.outputSha256).toBe(createHash('sha256').update(run.result.output).digest('hex'))
      expect(run.modelSnapshot).toEqual({ provider: 'openai-compatible', model: 'k3' })
      expect(run.status).toBe('succeeded')
      expect(run.sourceSnapshot.length).toBeGreaterThan(0)
      expect(run.sourceSnapshot.every(source => source.resolvedContent.trim().length > 0)).toBe(true)
      expect(run).not.toHaveProperty('runtime')
    }
    const versions = artifact.board.cards.flatMap(card => card.versions)
    const generated = versions.filter(version => version.origin === 'ai')
    expect(generated.length).toBeGreaterThanOrEqual(3)
    for (const version of generated) {
      expect(artifact.runs.some(run => run.id === version.sourceRunId)).toBe(true)
      expect(version.content.markdown.length).toBeGreaterThan(200)
      expect(version.content.markdown).toBe(artifact.runs.find(run => run.id === version.sourceRunId).result.output)
    }
    expect(artifact.board.cards.some(card => card.versions.some(version =>
      version.origin === 'human' && /来源|原文|材料/.test(version.content.markdown)))).toBe(true)
    expect(JSON.stringify(artifact)).not.toMatch(/sk-kimi-|Bearer |local-demo|authored-example/)
  })

  it('backs up exactly the same four boards and genuine Runs', async () => {
    const backup = await read('mira-four-scenarios.mira-backup.json')
    expect(() => validateWorkspaceBackup(backup)).not.toThrow()
    const artifacts = await Promise.all(names.map(name => read(`${name}.mira-board.json`)))
    expect(backup.boards.map(board => board.id).sort()).toEqual(artifacts.map(a => a.board.id).sort())
    expect(backup.runs.map(run => run.id).sort()).toEqual(artifacts.flatMap(a => a.runs.map(run => run.id)).sort())
    expect(backup.checkpoints.length).toBeGreaterThanOrEqual(1)
    expect(backup.workflows.length).toBeGreaterThanOrEqual(1)
    expect(backup.inspirationPool.entries.length).toBeGreaterThanOrEqual(1)
    expect(backup.runs.some(run => run.result?.disposition === 'candidate')).toBe(true)
  })
})
