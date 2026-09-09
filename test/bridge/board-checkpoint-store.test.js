import { describe, expect, it, vi } from 'vitest'
import { BoardCheckpointStore } from '../../bridge/board-checkpoint-store.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'

const NOW = '2026-09-05T08:00:00.000Z'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) { files.set(path, content) },
    async replace(from, to) {
      if (!files.has(from)) throw Object.assign(new Error(`missing: ${from}`), { code: 'ENOENT' })
      files.set(to, files.get(from)); files.delete(from)
    },
    async remove(path) {
      if (!files.delete(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function checkpoint(id, createdAt = NOW, boardId = 'board-1') {
  const board = emptyBoardV2(boardId, '课题', NOW)
  const artifact = projectBoardArtifact({ board, runs: [], exportedAt: createdAt })
  return {
    schemaVersion: 1,
    id,
    boardId: board.id,
    title: id,
    baseBoardRevision: 0,
    artifact,
    createdAt,
    metadataUpdatedAt: createdAt,
  }
}

describe('BoardCheckpointStore', () => {
  it('atomically saves, strictly loads, and lists one Board newest first', async () => {
    const fs = memoryFs()
    const store = new BoardCheckpointStore(fs, undefined, { coordinator: createStorageCoordinator() })
    await store.save(checkpoint('older', '2026-09-05T08:00:00.000Z'))
    await store.save(checkpoint('newer', '2026-09-05T09:00:00.000Z'))

    await expect(store.load('board-1', 'older')).resolves.toMatchObject({ id: 'older' })
    await expect(store.listSummaries('board-1')).resolves.toEqual([
      expect.objectContaining({ id: 'newer' }),
      expect.objectContaining({ id: 'older' }),
    ])
    expect([...fs.files.keys()].some((path) => path.endsWith('.tmp'))).toBe(false)
  })

  it('updates only metadata with CAS and keeps the artifact immutable', async () => {
    const store = new BoardCheckpointStore(memoryFs(), undefined, {
      coordinator: createStorageCoordinator(),
      now: () => '2026-09-05T10:00:00.000Z',
    })
    const saved = await store.save(checkpoint('checkpoint-1'))
    const originalArtifact = structuredClone(saved.artifact)
    const updated = await store.updateMetadata('board-1', 'checkpoint-1', {
      title: '新名称', note: null, baseMetadataUpdatedAt: NOW,
    })

    expect(updated).toMatchObject({ title: '新名称', metadataUpdatedAt: '2026-09-05T10:00:00.000Z' })
    expect(updated).not.toHaveProperty('note')
    expect(updated.artifact).toEqual(originalArtifact)
    await expect(store.updateMetadata('board-1', 'checkpoint-1', {
      title: '过期', baseMetadataUpdatedAt: NOW,
    })).rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' })
  })

  it('returns all exact paths for Board purge and rejects unsafe IDs', async () => {
    const store = new BoardCheckpointStore(memoryFs(), undefined, { coordinator: createStorageCoordinator() })
    await store.save(checkpoint('checkpoint-1'))
    await store.save(checkpoint('nested-checkpoint', NOW, 'board-1--nested'))
    await expect(store.entriesForBoard('board-1')).resolves.toEqual([
      { id: 'checkpoint-1', path: store.path('board-1', 'checkpoint-1') },
    ])
    expect(() => store.path('../board', 'checkpoint-1')).toThrowError(
      expect.objectContaining({ code: 'BAD_PATH' }),
    )
    expect(() => store.path('board\\escape', 'checkpoint-1')).toThrowError(
      expect.objectContaining({ code: 'BAD_PATH' }),
    )
    expect(() => store.path('board-1', 'checkpoint\n1')).toThrowError(
      expect.objectContaining({ code: 'BAD_PATH' }),
    )
  })

  it('strictly lists IDs containing the filename separator without ambiguous parsing', async () => {
    const store = new BoardCheckpointStore(memoryFs(), undefined, {
      coordinator: createStorageCoordinator(),
    })
    await store.save(checkpoint('checkpoint--part', NOW, 'board--part'))

    await expect(store.listStrict()).resolves.toMatchObject([
      { id: 'checkpoint--part', boardId: 'board--part' },
    ])
  })

  it('maps every identity tuple to a distinct path on case-insensitive normalized filesystems', () => {
    const store = new BoardCheckpointStore(memoryFs(), undefined, {
      coordinator: createStorageCoordinator(),
    })
    const paths = [
      store.path('a', 'b--c'),
      store.path('a--b', 'c'),
      store.path('Board', 'checkpoint'),
      store.path('board', 'checkpoint'),
      store.path('\u00e9', 'checkpoint'),
      store.path('e\u0301', 'checkpoint'),
    ]
    const filesystemKeys = paths.map((path) => path.normalize('NFC').toLowerCase())

    expect(new Set(filesystemKeys).size).toBe(paths.length)
  })

  it('preindexes a 20k prevalidated restore batch with one directory scan', async () => {
    const fs = memoryFs()
    fs.listJson = vi.fn(fs.listJson)
    const store = new BoardCheckpointStore(fs, undefined, {
      coordinator: createStorageCoordinator(),
    })
    const checkpoints = Array.from({ length: 20_000 }, (_, index) =>
      checkpoint(`checkpoint-${index}`, NOW, `board-${Math.floor(index / 20)}`))

    await store.saveManyPrevalidated(checkpoints)

    expect(fs.listJson).toHaveBeenCalledOnce()
    expect(fs.files.size).toBe(20_000)
  }, 30_000)

  it('cleans an uncommitted temp file when atomic replace fails', async () => {
    const fs = memoryFs()
    fs.replace = async () => { throw Object.assign(new Error('disk failed'), { code: 'EIO' }) }
    const store = new BoardCheckpointStore(fs, undefined, {
      coordinator: createStorageCoordinator(),
    })

    await expect(store.save(checkpoint('checkpoint-1')))
      .rejects.toMatchObject({ code: 'CHECKPOINT_WRITE_FAILED' })
    expect([...fs.files.keys()]).toEqual([])
    await expect(store.listSummaries('board-1')).resolves.toEqual([])
  })

  it('rejects a checkpoint ID already owned by another Board', async () => {
    const store = new BoardCheckpointStore(memoryFs(), undefined, {
      coordinator: createStorageCoordinator(),
    })
    await store.save(checkpoint('shared-id', NOW, 'board-1'))

    await expect(store.save(checkpoint('shared-id', NOW, 'board-2')))
      .rejects.toMatchObject({ code: 'CHECKPOINT_CONFLICT' })
  })
})
