import { describe, expect, it } from 'vitest'
import { validateWorkspaceBackup } from '../../bridge/domain/workspace-backup.js'

const NOW = '2026-09-05T12:00:00.000Z'

function board() {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    revision: 0,
    lifecycle: { state: 'active' },
    cards: [],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function artifact(overrides = {}) {
  return {
    format: 'mira-board',
    formatVersion: 1,
    exportedAt: NOW,
    board: board(),
    runs: [],
    workflowProvenance: [],
    fileDependencies: [],
    externalReferences: [],
    ...overrides,
  }
}

function backup(artifactValue = artifact()) {
  return {
    format: 'mira-backup',
    formatVersion: 2,
    exportedAt: NOW,
    boards: [board()],
    runs: [],
    workflows: [],
    checkpoints: [{
      schemaVersion: 1,
      id: 'checkpoint-1',
      boardId: 'board-1',
      title: '初稿',
      baseBoardRevision: 0,
      artifact: artifactValue,
      createdAt: NOW,
      metadataUpdatedAt: NOW,
    }],
  }
}

describe('MiraBackup checkpoint portable-data policy', () => {
  it('accepts a valid checkpoint artifact', () => {
    expect(() => validateWorkspaceBackup(backup())).not.toThrow()
  })

  it.each([
    ['apiKey', { apiKey: 'must-not-persist' }],
    ['token', { token: 'must-not-persist' }],
    ['secret', { secret: 'must-not-persist' }],
    ['file body', { contentKind: 'file-reference', resolvedContent: 'must-not-persist' }],
  ])('rejects checkpoint artifact envelope %s before restore staging', (_label, extra) => {
    expect(() => validateWorkspaceBackup(backup(artifact(extra))))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })
})
