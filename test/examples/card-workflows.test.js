import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { validateBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { digestContent } from '../../bridge/domain/content.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { createBoardImportCommitter } from '../../bridge/board-import-committer.js'
import { createBoardPortabilityService } from '../../bridge/board-portability-service.js'
import { V2BoardStore } from '../../bridge/v2-board-store.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'
import { WorkflowStore } from '../../bridge/workflow-store.js'

const directory = new URL('../../docs/examples/', import.meta.url)
const names = ['software', 'reading', 'research', 'writing']
const identities = (board) => [board.id, ...board.cards.flatMap((card) => [card.id, ...card.versions.map(({ id }) => id)]), ...board.transformations.map(({ id }) => id)]

describe('portable real-model workflow examples', () => {
  it('ships the four explicitly named example artifacts', async () => {
    const files = await readdir(directory).catch(() => [])
    expect(files.filter((name) => name.endsWith('.mira-board.json')).sort())
      .toEqual(names.map((name) => `${name}.mira-board.json`).sort())
  })

  it.each(names)('%s imports twice as isolated new boards without inventing model history', async (name) => {
    const file = new URL(`${name}.mira-board.json`, directory)
    const source = await readFile(file, 'utf8')
    const artifact = JSON.parse(source)
    const unchanged = structuredClone(artifact)
    expect(() => validateBoardArtifact(artifact)).not.toThrow()
    expect(artifact.runs.length).toBeGreaterThanOrEqual(3)
    expect(artifact.fileDependencies).toEqual([])
    expect(artifact.board.transformations).toHaveLength(3)
    expect(artifact.board.cards.length).toBeGreaterThanOrEqual(7)
    for (const card of artifact.board.cards) {
      expect(card).not.toHaveProperty('fileBinding')
      expect(card.contentKind).toBe('markdown')
      const head = card.versions.find(version => version.id === card.headVersionId)
      expect(head.id).toBe(card.headVersionId)
      expect(head.content.markdown.length).toBeGreaterThan(50)
      expect(head.digest).toBe(digestContent(head.content))
    }
    artifact.board.transformations.forEach((step) => {
      expect(step.sourceCardIds.length).toBeGreaterThan(0)
      expect(artifact.board.cards.some(card => card.id === step.targetCardId)).toBe(true)
      expect(artifact.runs.some(run => run.id === step.lastRunId)).toBe(true)
      expect(artifact.runs.some(run => run.id === step.lastAppliedRunId)).toBe(true)
      expect(step.instruction.length).toBeGreaterThan(20)
    })
    const root = await mkdtemp(join(tmpdir(), 'mira-workflow-example-'))
    try {
      const fs = createNodeWorkspaceAdapter(root)
      const coordinator = createStorageCoordinator()
      const boardStore = new V2BoardStore(fs, 'boards-v2', { coordinator })
      const runStore = createV2RunStore(fs, 'runs-v2', { coordinator })
      const workflowStore = new WorkflowStore(fs, 'workflows-v2')
      const newId = (kind) => `${kind}-${randomUUID()}`
      const committer = createBoardImportCommitter({ fs, coordinator, newId })
      const service = createBoardPortabilityService({ boardStore, runStore, workflowStore, committer, newId })
      const first = await service.importBoard({ artifact })
      const second = await service.importBoard({ artifact })
      const firstIds = new Set(identities(first.board))
      const sourceIds = new Set(identities(artifact.board))
      expect(identities(second.board).some((id) => firstIds.has(id) || sourceIds.has(id))).toBe(false)
      expect(identities(first.board).some((id) => sourceIds.has(id))).toBe(false)
      expect(await boardStore.load(first.boardId)).toEqual(first.board)
      expect(await boardStore.load(second.boardId)).toEqual(second.board)
      expect(await boardStore.list()).toHaveLength(2)
      expect(await runStore.list()).toHaveLength(artifact.runs.length * 2)
      expect(await workflowStore.list()).toEqual([])
      expect(() => validateBoardArtifact(artifact)).not.toThrow()
      const exported = await service.exportBoard(first.boardId)
      expect(() => validateBoardArtifact(exported)).not.toThrow()
      expect(exported.runs).toHaveLength(artifact.runs.length)
      expect(exported.board.cards.map((card) => card.versions[0].content))
        .toEqual(artifact.board.cards.map((card) => card.versions[0].content))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
    expect(artifact).toEqual(unchanged)
    expect(await readFile(file, 'utf8')).toBe(source)
  })
})
