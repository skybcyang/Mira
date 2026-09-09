import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { startNodeRuntime } from '../../bridge/node-runtime.js'

it('persists names and inspiration revisions through real HTTP without modifying existing snapshots', async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-name-edit-test-'))
  const runtime = await startNodeRuntime({ workspaceRoot, staticRoot: join(workspaceRoot, 'web'), host: '127.0.0.1', port: 0,
    hostOptions: { logger: { log() {}, error() {} } } })
  const request = async (method, path, input, status = 200) => {
    const response = await fetch(`${runtime.address.url}/graphmind/api/v2${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: input === undefined ? undefined : JSON.stringify(input),
    })
    const body = await response.json()
    expect(response.status, JSON.stringify(body)).toBe(status)
    return body
  }
  try {
    const { entry } = await request('POST', '/inspiration-pool/entries', { markdown: '# 原始灵感', tags: ['主意'] }, 201)
    const { boardId } = await request('POST', '/boards', { title: '编辑验收' }, 201)
    const snapshot = { poolSource: { poolId: 'inspiration-pool', entryId: entry.id, versionId: entry.headVersionId }, tags: entry.tags }
    const created = await request('POST', `/boards/${boardId}/cards/batch`, { cards: [snapshot] }, 201)
    const original = created.cards[0]
    const path = `/inspiration-pool/entries/${entry.id}`
    const input = { markdown: '# 修改后的灵感', tags: ['技术'], baseVersionId: entry.headVersionId, baseUpdatedAt: entry.updatedAt }
    const edited = (await request('PATCH', path, input)).entry
    expect(edited.versions).toHaveLength(2)
    expect(edited.versions[0]).toEqual(entry.versions[0])
    expect((await request('PATCH', path, input, 409)).code).toBe('INSPIRATION_CONFLICT')
    expect((await request('PATCH', '/inspiration-pool/entries/missing', input, 404)).code).toBe('INSPIRATION_NOT_FOUND')
    const after = await request('GET', `/boards/${boardId}`)
    expect(after.board.cards[0]).toEqual(original)
    const laterCopy = await request('POST', `/boards/${boardId}/cards/batch`, { cards: [snapshot] }, 201)
    expect(laterCopy.cards[0].versions[0].content.markdown).toBe('# 原始灵感')
    const cardPath = `/boards/${boardId}/cards/${original.id}`
    const named = (await request('PATCH', cardPath, { name: '灵感提纲', baseName: null })).card
    expect(named.versions).toEqual(original.versions)
    expect((await request('PATCH', cardPath, { name: '旧窗口', baseName: null }, 409)).code).toBe('CARD_NAME_CONFLICT')
    const reloaded = await request('GET', `/boards/${boardId}`)
    expect(reloaded.board.cards[0].name).toBe('灵感提纲')
    const artifact = await request('GET', `/boards/${boardId}/export`)
    expect(artifact.board.cards[0].name).toBe('灵感提纲')
    const imported = await request('POST', '/boards/imports', { artifact }, 201)
    const importedBoard = await request('GET', `/boards/${imported.boardId}`)
    expect(importedBoard.board.cards[0].name).toBe('灵感提纲')
    const backup = await request('GET', '/backup')
    expect(backup.boards.find(board => board.id === boardId).cards[0].name).toBe('灵感提纲')
    expect(backup.inspirationPool.entries[0].versions).toHaveLength(2)
  } finally {
    await runtime.close()
    await rm(workspaceRoot, { recursive: true, force: true })
  }
})
