import { describe, expect, it, vi } from 'vitest'
import {
  checkpointSummary,
  validateBoardCheckpoint,
} from '../../bridge/domain/board-checkpoint.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

const NOW = '2026-09-05T08:00:00.000Z'

function checkpoint(overrides = {}) {
  const board = emptyBoardV2('board-1', '课题', NOW)
  board.revision = 3
  const artifact = projectBoardArtifact({ board, runs: [], exportedAt: NOW })
  return {
    schemaVersion: 1,
    id: 'checkpoint-1',
    boardId: 'board-1',
    title: '第一稿',
    note: '可以继续比较',
    baseBoardRevision: 3,
    artifact,
    createdAt: NOW,
    metadataUpdatedAt: NOW,
    ...overrides,
  }
}

describe('BoardCheckpoint domain', () => {
  it('validates the embedded BoardArtifact and projects a lightweight summary', () => {
    const value = checkpoint()
    expect(validateBoardCheckpoint(value)).toBe(value)
    expect(checkpointSummary(value)).toEqual({
      id: 'checkpoint-1',
      boardId: 'board-1',
      title: '第一稿',
      note: '可以继续比较',
      baseBoardRevision: 3,
      counts: { cards: 0, transformations: 0, runs: 0 },
      createdAt: NOW,
      metadataUpdatedAt: NOW,
    })
  })

  it.each([
    [{ title: ' ' }, 'title'],
    [{ title: ' 第一稿 ' }, 'title'],
    [{ title: 'x'.repeat(81) }, 'title'],
    [{ note: '' }, 'note'],
    [{ note: ' 备注 ' }, 'note'],
    [{ note: 'x'.repeat(241) }, 'note'],
    [{ boardId: 'board-2' }, 'boardId'],
    [{ baseBoardRevision: 2 }, 'baseBoardRevision'],
    [{ extra: true }, 'fields'],
  ])('rejects an invalid checkpoint %s', (change, field) => {
    expect(() => validateBoardCheckpoint(checkpoint(change))).toThrowError(
      expect.objectContaining({ code: 'CHECKPOINT_INVALID', message: expect.stringContaining(field) }),
    )
  })
})
