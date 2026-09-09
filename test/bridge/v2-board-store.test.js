import { describe, expect, it, vi } from 'vitest'
import { V2BoardStore, emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { createV2Handlers } from '../../bridge/v2-http.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { removeFilesAtomically } from '../../bridge/storage-file-transaction.js'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      if (!files.has(from)) throw new Error(`missing temp: ${from}`)
      files.set(to, files.get(from))
      files.delete(from)
    },
    async remove(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      files.delete(path)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

describe('v2 board store', () => {
  it('rejects creating a board id that has been permanently deleted', async () => {
    const fs = memoryFs()
    fs.files.set('purged-boards-v2/board-1.json', '{"boardId":"board-1"}')
    const store = new V2BoardStore(fs, 'boards-v2', { newId: () => 'board-1' })

    await expect(store.create('新课题')).rejects.toMatchObject({ code: 'BOARD_ID_REUSED' })
  })

  it('atomically removes all purge files and restores them after a failed delete', async () => {
    const fs = memoryFs()
    fs.files.set('boards-v2/a.json', 'a')
    fs.files.set('runs-v2/r.json', 'r')
    await expect(removeFilesAtomically(fs, ['boards-v2/a.json', 'runs-v2/r.json'])).resolves.toBeUndefined()
    expect(fs.files.has('boards-v2/a.json')).toBe(false)
    expect(fs.files.has('runs-v2/r.json')).toBe(false)

    const failingFs = memoryFs()
    failingFs.files.set('boards-v2/a.json', 'a')
    failingFs.files.set('runs-v2/r.json', 'r')
    const remove = failingFs.remove.bind(failingFs)
    failingFs.remove = async (path) => {
      if (path === 'runs-v2/r.json.purge') throw new Error('delete failed')
      return remove(path)
    }
    await expect(removeFilesAtomically(failingFs, ['boards-v2/a.json', 'runs-v2/r.json'])).rejects.toMatchObject({ code: 'BOARD_PURGE_FAILED' })
    expect(failingFs.files.get('boards-v2/a.json')).toBe('a')
    expect(failingFs.files.get('runs-v2/r.json')).toBe('r')
    expect([...failingFs.files.keys()].some((path) => path.endsWith('.purge'))).toBe(false)
  })

  it('writes a verified temp file before atomically replacing the board', async () => {
    const fs = memoryFs()
    const replace = vi.spyOn(fs, 'replace')
    const store = new V2BoardStore(fs)
    const board = emptyBoardV2('board-1', '课题', '2026-08-23T01:00:00.000Z')

    await store.save('board-1', board)

    expect(replace).toHaveBeenCalledWith('boards-v2/board-1.json.tmp', 'boards-v2/board-1.json')
    expect(fs.files.has('boards-v2/board-1.json.tmp')).toBe(false)
    expect(await store.load('board-1')).toEqual(board)
  })

  it('creates explicit active revision zero boards', () => {
    expect(emptyBoardV2('board-1', '  课题  ', '2026-08-23T01:00:00.000Z')).toMatchObject({
      title: '课题',
      revision: 0,
      lifecycle: { state: 'active' },
    })
  })

  it('strips legacy relations from boards loaded from disk', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    const board = emptyBoardV2('board-1', '课题', '2026-09-03T00:00:00.000Z')
    const legacy = {
      ...board,
      relations: [{ id: 'r1', fromCardId: 'a', toCardId: 'b', kind: 'reference' }],
    }
    fs.files.set('boards-v2/board-1.json', JSON.stringify(legacy))

    const loaded = await store.load('board-1')

    expect('relations' in loaded).toBe(false)
  })

  it('normalizes legacy lifecycle fields on read without rewriting the file', async () => {
    const fs = memoryFs()
    const legacy = {
      ...emptyBoardV2('board-1', '旧课题', '2026-08-23T01:00:00.000Z'),
    }
    delete legacy.revision
    delete legacy.lifecycle
    const serialized = JSON.stringify(legacy)
    fs.files.set('boards-v2/board-1.json', serialized)
    const store = new V2BoardStore(fs)

    await expect(store.load('board-1')).resolves.toMatchObject({
      revision: 0,
      lifecycle: { state: 'active' },
    })
    expect(fs.files.get('boards-v2/board-1.json')).toBe(serialized)
  })

  it('does not replace the previous board when temp verification fails', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    const original = emptyBoardV2('board-1', '原版', '2026-08-23T01:00:00.000Z')
    await store.save('board-1', original)
    const replace = vi.spyOn(fs, 'replace')
    const normalRead = fs.readText.bind(fs)
    fs.readText = vi.fn(async (path) =>
      path.endsWith('.tmp') ? '{bad json' : normalRead(path),
    )

    await expect(
      store.save('board-1', { ...original, title: '不应写入' }),
    ).rejects.toMatchObject({ code: 'BOARD_V2_WRITE_FAILED' })
    expect(replace).not.toHaveBeenCalled()
    expect(JSON.parse(fs.files.get('boards-v2/board-1.json')).title).toBe('原版')
  })

  it('lists active summaries separately from the complete lifecycle catalog', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    await store.save(
      'board-1',
      emptyBoardV2('board-1', '研究课题', '2026-08-23T01:00:00.000Z'),
    )
    await store.save('board-2', {
      ...emptyBoardV2('board-2', '已归档', '2026-08-23T01:00:00.000Z'),
      revision: 3,
      lifecycle: { state: 'archived', archivedAt: '2026-08-24T01:00:00.000Z' },
      updatedAt: '2026-08-24T01:00:00.000Z',
    })
    fs.files.set('boards-v2/broken.json', '{no')

    await expect(store.listSummaries()).resolves.toEqual([
      {
        id: 'board-1', title: '研究课题', state: 'active', revision: 0,
        updatedAt: '2026-08-23T01:00:00.000Z',
      },
    ])
    await expect(store.listCatalogSummaries()).resolves.toEqual([
      {
        id: 'board-1', title: '研究课题', state: 'active', revision: 0,
        updatedAt: '2026-08-23T01:00:00.000Z',
      },
      {
        id: 'board-2', title: '已归档', state: 'archived', revision: 3,
        updatedAt: '2026-08-24T01:00:00.000Z',
      },
    ])
  })

  it('lists strict Boards deterministically and fails closed on corrupt members', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    await store.save('board-z', emptyBoardV2('board-z', 'Z', '2026-08-23T01:00:00.000Z'))
    await store.save('board-a', emptyBoardV2('board-a', 'A', '2026-08-23T01:00:00.000Z'))

    await expect(store.list()).resolves.toEqual(['board-z', 'board-a'])
    await expect(store.listStrict()).resolves.toEqual([
      expect.objectContaining({ id: 'board-a' }),
      expect.objectContaining({ id: 'board-z' }),
    ])
    fs.files.set('boards-v2/broken.json', '{bad')
    await expect(store.listStrict()).rejects.toMatchObject({ code: 'BOARD_V2_INVALID' })
  })

  it('fails strict reads when a Board ID does not match its file name', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    fs.files.set(
      'boards-v2/board-file.json',
      JSON.stringify(emptyBoardV2('board-inside', '错位', '2026-08-23T01:00:00.000Z')),
    )

    await expect(store.load('board-file')).rejects.toMatchObject({ code: 'BOARD_V2_INVALID' })
    await expect(store.listStrict()).rejects.toMatchObject({ code: 'BOARD_V2_INVALID' })
  })

  it('treats reserved import Board IDs as absent until synchronous publication', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const store = new V2BoardStore(fs, 'boards-v2', { coordinator })
    const board = emptyBoardV2('board-new', '新画板', '2026-08-23T01:00:00.000Z')
    fs.files.set('boards-v2/board-new.json', JSON.stringify(board))
    const reservation = coordinator.reserveImportIds('tx-1', {
      boardIds: ['board-new'], runIds: [],
    })

    await expect(store.list()).resolves.toEqual([])
    await expect(store.listStrict()).resolves.toEqual([])
    await expect(store.load('board-new')).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' })
    coordinator.releaseImportIds(reservation)
    await expect(store.list()).resolves.toEqual(['board-new'])
    await expect(store.load('board-new')).resolves.toEqual(board)
  })

  it('reuses its held mutation lease when saving an aggregate with a snapshot queued', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const store = new V2BoardStore(fs, 'boards-v2', { coordinator })
    await store.save('board-1', emptyBoardV2('board-1', '原版', '2026-08-23T01:00:00.000Z'))
    let continueChange
    const mayContinue = new Promise((resolve) => {
      continueChange = resolve
    })
    let changeStarted
    const didStart = new Promise((resolve) => {
      changeStarted = resolve
    })
    const events = []

    const update = store.update('board-1', async (board) => {
      events.push('update:start')
      changeStarted()
      await mayContinue
      board.title = '已更新'
      return board
    }).then(() => events.push('update:end'))
    await didStart
    const snapshot = coordinator.withSnapshot(async () => {
      events.push('snapshot')
      expect((await store.load('board-1')).title).toBe('已更新')
    })
    continueChange()

    await Promise.all([update, snapshot])
    expect(events).toEqual(['update:start', 'snapshot', 'update:end'])
  })

  it('increments revision exactly once for each successful aggregate update', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs, 'boards-v2', {
      now: () => '2026-08-23T01:00:01.000Z',
    })
    await store.save(
      'board-1',
      emptyBoardV2('board-1', '原版', '2026-08-23T01:00:00.000Z'),
    )

    await store.update('board-1', async (board) => {
      board.title = '更新'
      board.revision = 99
      return board
    })

    await expect(store.load('board-1')).resolves.toMatchObject({
      title: '更新', revision: 1, updatedAt: '2026-08-23T01:00:01.000Z',
    })
  })

  it('rejects ordinary aggregate writes to archived and trashed boards', async () => {
    for (const state of ['archived', 'trashed']) {
      const fs = memoryFs()
      const store = new V2BoardStore(fs)
      await store.save('board-1', {
        ...emptyBoardV2('board-1', '课题', '2026-08-23T01:00:00.000Z'),
        lifecycle: { state },
      })
      const before = fs.files.get('boards-v2/board-1.json')

      await expect(store.update('board-1', async (board) => {
        board.title = '不应写入'
        return board
      })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
      expect(fs.files.get('boards-v2/board-1.json')).toBe(before)
    }
  })

  it('reports a missing board as a domain-level not-found error', async () => {
    const store = new V2BoardStore(memoryFs())

    await expect(store.load('missing')).rejects.toMatchObject({
      code: 'BOARD_NOT_FOUND',
    })
  })

  it('preserves invalid-path errors instead of reporting a storage failure', async () => {
    const store = new V2BoardStore(memoryFs())

    await expect(store.load('../outside')).rejects.toMatchObject({
      code: 'BAD_PATH',
    })
  })

  it('does not disguise board storage failures as missing or empty data', async () => {
    const readFailure = Object.assign(new Error('disk offline'), { code: 'EIO' })
    const readFs = memoryFs()
    readFs.readText = async () => {
      throw readFailure
    }
    await expect(new V2BoardStore(readFs).load('board-1')).rejects.toMatchObject({
      code: 'BOARD_V2_READ_FAILED',
    })

    const listFs = memoryFs()
    listFs.listJson = async () => {
      throw readFailure
    }
    await expect(new V2BoardStore(listFs).list()).rejects.toMatchObject({
      code: 'BOARD_V2_READ_FAILED',
    })

    const memberFs = memoryFs()
    memberFs.files.set(
      'boards-v2/board-1.json',
      JSON.stringify(emptyBoardV2('board-1', '课题', '2026-08-23T01:00:00.000Z')),
    )
    memberFs.readText = async () => {
      throw readFailure
    }
    await expect(new V2BoardStore(memberFs).listSummaries()).rejects.toMatchObject({
      code: 'BOARD_V2_READ_FAILED',
    })
  })

  it('serializes overlapping updates to the same board without losing either change', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs)
    const original = emptyBoardV2('board-1', '原版', '2026-08-23T01:00:00.000Z')
    await store.save('board-1', original)

    let releaseFirst
    const firstMayFinish = new Promise((resolve) => {
      releaseFirst = resolve
    })
    let firstStarted
    const firstDidStart = new Promise((resolve) => {
      firstStarted = resolve
    })

    const first = store.update('board-1', async (board) => {
      board.title = '第一项变更'
      firstStarted()
      await firstMayFinish
      return board
    })
    await firstDidStart
    const second = store.update('board-1', async (board) => {
      board.title += ' + 第二项变更'
      return board
    })
    releaseFirst()

    await Promise.all([first, second])
    await expect(store.load('board-1')).resolves.toMatchObject({
      title: '第一项变更 + 第二项变更',
    })
  })

  it('resolves concurrent board-bottom card placement inside the serialized update', async () => {
    const fs = memoryFs()
    const store = new V2BoardStore(fs, 'boards-v2', {
      now: () => '2026-08-23T01:00:01.000Z',
    })
    await store.save(
      'board-1',
      emptyBoardV2('board-1', '灵感池', '2026-08-23T01:00:00.000Z'),
    )
    const generatedIds = ['first', 'first-v1', 'second', 'second-v1']
    const handlers = createV2Handlers({
      store,
      runStore: {},
      newId: () => generatedIds.shift(),
      now: () => '2026-08-23T01:00:01.000Z',
    })

    const results = await Promise.all([
      handlers.createCard('board-1', {
        markdown: '第一条灵感', placement: 'board-bottom',
      }),
      handlers.createCard('board-1', {
        markdown: '第二条灵感', placement: 'board-bottom',
      }),
    ])

    expect(results.map(({ card }) => ({ x: card.x, y: card.y }))).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 240 },
    ])
    expect((await store.load('board-1')).cards).toHaveLength(2)
  })
})
