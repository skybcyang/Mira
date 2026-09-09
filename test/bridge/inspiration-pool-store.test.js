import { describe, expect, it, vi } from 'vitest'
import { InspirationPoolStore, emptyInspirationPool } from '../../bridge/inspiration-pool-store.js'

function memoryFs(initial = {}) {
  const files = new Map(Object.entries(initial))
  return {
    readText: vi.fn(async (path) => {
      if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      return files.get(path)
    }),
    writeText: async (path, content) => files.set(path, content),
    replace: async (from, to) => {
      files.set(to, files.get(from))
      files.delete(from)
    },
  }
}

describe('InspirationPoolStore', () => {
  const editingStore = () => {
    let sequence = 0
    return new InspirationPoolStore(memoryFs(), { newId: prefix => `${prefix}-${++sequence}`, now: () => '2026-09-08T00:00:00.000Z' })
  }
  const edit = (entry, markdown = '新版', tags = ['技术']) => ({ markdown, tags, baseVersionId: entry.headVersionId, baseUpdatedAt: entry.updatedAt })

  it('appends immutable content versions but only updates metadata for tags', async () => {
    const store = editingStore()
    const first = await store.createEntry({ markdown: '原文', tags: ['主意'] })
    const second = await store.updateEntry(first.id, edit(first))
    expect(second.versions).toHaveLength(2)
    expect(second.versions[0]).toEqual(first.versions[0])
    expect(second.versions[1]).toMatchObject({ sequence: 2, origin: 'human', content: { markdown: '新版' } })
    const tagged = await store.updateEntry(first.id, edit(second, '新版', ['约束']))
    expect(tagged.versions).toEqual(second.versions)
    expect(tagged.updatedAt > second.updatedAt).toBe(true)
    const duplicate = await store.updateEntry(first.id, edit(tagged, '新版', ['约束']))
    expect(duplicate).toEqual(tagged)
  })

  it('rejects concurrent stale edits, including tag-only changes, without losing either entry', async () => {
    const store = editingStore()
    const entries = await Promise.all(['一', '二'].map(markdown => store.createEntry({ markdown })))
    expect((await store.load()).entries).toHaveLength(2)
    const outcomes = await Promise.allSettled([
      store.updateEntry(entries[0].id, edit(entries[0], '一', ['甲'])),
      store.updateEntry(entries[0].id, edit(entries[0], '一', ['乙'])),
    ])
    expect(outcomes.map(item => item.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(outcomes.find(item => item.status === 'rejected').reason.code).toBe('INSPIRATION_CONFLICT')
    expect((await store.load()).entries[1]).toEqual(entries[1])
  })

  it('keeps the stored pool intact on invalid input, conflict, and write failure', async () => {
    const store = editingStore()
    const entry = await store.createEntry({ markdown: '原文' })
    for (const input of [{ ...edit(entry), markdown: '' }, { ...edit(entry), tags: undefined }, { ...edit(entry), tags: ['重复', '重复'] }, { ...edit(entry), boardId: 'forged' }]) {
      await expect(store.updateEntry(entry.id, input)).rejects.toBeDefined()
    }
    await expect(store.updateEntry(entry.id, { ...edit(entry), baseVersionId: 'stale' })).rejects.toMatchObject({ code: 'INSPIRATION_CONFLICT' })
    store.fs.replace = async () => { throw new Error('disk unavailable') }
    await expect(store.updateEntry(entry.id, edit(entry))).rejects.toMatchObject({ code: 'INSPIRATION_WRITE_FAILED' })
    expect((await store.load()).entries).toEqual([entry])
  })
  it('creates and persists a workspace-level pool without canvas geometry', async () => {
    const fs = memoryFs()
    const store = new InspirationPoolStore(fs, { newId: (() => {
      const ids = ['entry-1', 'version-1']
      return () => ids.shift()
    })(), now: () => '2026-09-04T00:00:00.000Z' })

    const created = await store.createEntry({ markdown: '独立记录', tags: ['主意'] })

    expect(created).toMatchObject({
      id: 'entry-1',
      tags: ['主意'],
      headVersionId: 'version-1',
      versions: [{ id: 'version-1', content: { kind: 'markdown', markdown: '独立记录' } }],
    })
    expect(created).not.toHaveProperty('x')
    expect(created).not.toHaveProperty('y')
    await expect(store.load()).resolves.toMatchObject({ entries: [created] })
  })

  it('returns an empty pool when the workspace has no pool file', async () => {
    const store = new InspirationPoolStore(memoryFs(), {
      now: () => '2026-09-04T00:00:00.000Z',
    })
    await expect(store.load()).resolves.toEqual(emptyInspirationPool('2026-09-04T00:00:00.000Z'))
  })

  it('rejects blank entries before writing', async () => {
    const fs = memoryFs()
    const store = new InspirationPoolStore(fs)

    await expect(store.createEntry({ markdown: '  \n ', tags: [] }))
      .rejects.toMatchObject({ code: 'INSPIRATION_INVALID' })
    expect(fs.readText).not.toHaveBeenCalled()
  })
})
