import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'
import { V2BoardStore, emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { createV2Handlers } from '../../bridge/v2-http.js'
import { dispatchV2Route } from '../../bridge/v2-routes.js'
import { createMiraApiHandler } from '../../bridge/mira-http.js'
import { createMiraApplication } from '../../bridge/mira-application.js'
import { restoreWorkspaceBackup } from '../../bridge/node-backup-restore.js'
import { validateWorkspaceBackup } from '../../bridge/domain/workspace-backup.js'
import { validateBoardCheckpoint } from '../../bridge/domain/board-checkpoint.js'
import { validateBoardV2 } from '../../bridge/domain/validation.js'
import { projectBoardArtifact, remapBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { applyOrganization } from '../../bridge/domain/organization.js'

const NOW = '2026-09-06T00:00:00.000Z'
const roots = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
const group = (cardIds, id = 'group-a') => ({ id, title: 'Research', color: 'blue', cardIds })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mira-organization-'))
  roots.push(root)
  const fs = createNodeWorkspaceAdapter(root)
  const store = new V2BoardStore(fs)
  await store.save('board', emptyBoardV2('board', 'Research', NOW))
  let sequence = 0
  const handlers = createV2Handlers({ store, newId: (kind) => `${kind}-${++sequence}`, now: () => NOW })
  const { cards } = await handlers.createCards('board', { cards: [{ x: 0, y: 0, markdown: 'A' }, { x: 500, y: 0, markdown: 'B' }] })
  return { fs, store, handlers, cards, route: (body) => dispatchV2Route('PATCH', ['v2', 'boards', 'board', 'organization'], body, { store, handlers }) }
}

describe('board organization', () => {
  it('atomically resizes and positions cards through the route without changing their content metadata', async () => {
    const { route, store, cards } = await fixture()
    const before = await store.load('board')
    const result = await route({
      sizes: cards.map((card) => ({ cardId: card.id, width: 440, height: 320, baseWidth: card.width, baseHeight: card.height })),
      positions: [{ kind: 'card', id: cards[1].id, x: 800, y: 40, baseX: 500, baseY: 0 }],
    })
    expect(result.status).toBe(200)
    expect(result.body.cards).toEqual([{ ...cards[0], width: 440, height: 320 }, { ...cards[1], x: 800, y: 40, width: 440, height: 320 }])
    const after = await store.load('board')
    expect(after.cards).toEqual(result.body.cards)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.transformations).toEqual(before.transformations)
  })

  it('rejects all mixed changes on a stale or missing size target, with no in-memory or stored partial mutation', async () => {
    const { handlers, store, cards } = await fixture()
    const before = await store.load('board')
    for (const cardId of [cards[1].id, 'missing']) {
      const request = {
        groups: [group([cards[0].id])], baseGroups: [],
        colors: [{ cardId: cards[0].id, color: 'red', baseColor: null }],
        positions: [{ kind: 'card', id: cards[0].id, x: 10, y: 10, baseX: 0, baseY: 0 }],
        sizes: [{ cardId: cards[0].id, width: 440, height: 320, baseWidth: cards[0].width, baseHeight: cards[0].height },
          { cardId, width: 440, height: 320, baseWidth: 999, baseHeight: cards[1].height }],
      }
      const draft = structuredClone(before)
      expect(() => applyOrganization(draft, request)).toThrowError(expect.objectContaining({ code: 'ORGANIZATION_CONFLICT' }))
      expect(draft).toEqual(before)
      await expect(handlers.updateOrganization('board', request)).rejects.toMatchObject({ code: 'ORGANIZATION_CONFLICT' })
      expect(await store.load('board')).toEqual(before)
    }
  })

  it('serializes size CAS attempts and restores legal old dimensions outside UI presets', async () => {
    const { handlers, store, cards } = await fixture()
    await handlers.updateCard('board', cards[0].id, { width: 140, height: 1400 })
    const sizes = [{ cardId: cards[0].id, width: 440, height: 320, baseWidth: 140, baseHeight: 1400 }]
    const results = await Promise.allSettled([440, 560].map((width) => handlers.updateOrganization('board', { sizes: [{ ...sizes[0], width }] })))
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected').reason.code).toBe('ORGANIZATION_CONFLICT')
    const current = (await store.load('board')).cards[0]
    await handlers.updateOrganization('board', { sizes: [{ cardId: current.id, width: 140, height: 1400, baseWidth: current.width, baseHeight: current.height }] })
    expect((await store.load('board')).cards[0]).toEqual({ ...cards[0], width: 140, height: 1400 })
  })

  it('keeps all dimensions on disk after a failed atomic size replacement', async () => {
    const { handlers, store, fs, cards } = await fixture()
    const before = await store.load('board')
    fs.replace = async () => { throw new Error('injected write failure') }
    await expect(handlers.updateOrganization('board', {
      sizes: cards.map((card) => ({ cardId: card.id, width: 440, height: 320, baseWidth: card.width, baseHeight: card.height })),
    })).rejects.toMatchObject({ code: 'BOARD_V2_WRITE_FAILED' })
    expect(await store.load('board')).toEqual(before)
  })

  it.each([
    null, [], {},
    [{ cardId: 'card-1', width: 440, height: 320, baseWidth: 312 }],
    [{ cardId: 'card-1', width: 440, height: 320, baseWidth: 312, baseHeight: 208, x: 0 }],
    ...['width', 'height', 'baseWidth', 'baseHeight'].flatMap((key) => [0, -1, Infinity, NaN, '312', null].map((value) =>
      [{ cardId: 'card-1', width: 440, height: 320, baseWidth: 312, baseHeight: 208, [key]: value }])),
    Array.from({ length: 2 }, () => ({ cardId: 'card-1', width: 440, height: 320, baseWidth: 312, baseHeight: 208 })),
    Array.from({ length: 101 }, (_, index) => ({ cardId: `card-${index}`, width: 440, height: 320, baseWidth: 312, baseHeight: 208 })),
  ].map((sizes) => [sizes]))('rejects malformed sizes with zero writes: %j', async (sizes) => {
    const { handlers, store } = await fixture()
    const before = await store.load('board')
    await expect(handlers.updateOrganization('board', { sizes })).rejects.toMatchObject({ code: 'ORGANIZATION_INVALID' })
    expect(await store.load('board')).toEqual(before)
  })

  it('atomically groups, colors and moves through the real route and temporary storage without semantic changes', async () => {
    const { route, store, cards } = await fixture()
    const before = await store.load('board')
    const groups = [group(cards.map(({ id }) => id))]
    const result = await route({ baseGroups: [], groups, colors: [{ cardId: cards[0].id, baseColor: null, color: 'red' }], positions: [{ kind: 'card', id: cards[1].id, baseX: 500, baseY: 0, x: 1500, y: 60 }] })
    expect(result.status).toBe(200)
    expect(result.body.groups).toEqual(groups)
    expect(result.body.cards).toHaveLength(2)
    const after = await store.load('board')
    expect(after.revision).toBe(before.revision + 1)
    expect(after.cards).toEqual([{ ...cards[0], color: 'red' }, { ...cards[1], x: 1500, y: 60 }])
    expect(after.transformations).toEqual(before.transformations)
  })

  it('CAS rejects an entire mixed mutation and structural group equality ignores object key order', async () => {
    const { handlers, store, cards } = await fixture()
    const groups = [group([cards[0].id])]
    await handlers.updateOrganization('board', { baseGroups: [], groups })
    await handlers.updateOrganization('board', { baseGroups: [{ cardIds: [cards[0].id], color: 'blue', title: 'Research', id: 'group-a' }], groups })
    const before = await store.load('board')
    await expect(handlers.updateOrganization('board', { baseGroups: groups, groups: [], colors: [{ cardId: cards[0].id, baseColor: 'blue', color: 'red' }] })).rejects.toMatchObject({ code: 'ORGANIZATION_CONFLICT' })
    expect(await store.load('board')).toEqual(before)
  })

  it('moves an internal transformation without changing semantic metadata and restores automatic positioning', async () => {
    const { handlers, store, cards } = await fixture()
    const { transformation } = await handlers.createTransformation('board', { sourceRefs: [{ cardId: cards[0].id, versionId: cards[0].headVersionId }], label: 'Result', instruction: 'Summarize', acceptance: '' })
    const position = { kind: 'transformation', id: transformation.id, baseX: null, baseY: null, x: 400, y: 80 }
    const changed = await handlers.updateOrganization('board', { positions: [position] })
    expect(changed.transformations).toEqual([{ ...transformation, x: 400, y: 80 }])
    expect(changed.cards).toEqual([])
    await handlers.updateOrganization('board', { positions: [{ ...position, baseX: 400, baseY: 80, x: null, y: null }] })
    expect((await store.load('board')).transformations).toEqual([transformation])
  })

  it('serializes concurrent CAS attempts and permits only one winner', async () => {
    const { handlers, store, cards } = await fixture()
    const results = await Promise.allSettled(['red', 'blue'].map((color) => handlers.updateOrganization('board', { colors: [{ cardId: cards[0].id, color, baseColor: null }] })))
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.find(({ status }) => status === 'rejected').reason.code).toBe('ORGANIZATION_CONFLICT')
    expect((await store.load('board')).revision).toBe(2)
  })

  it('keeps stale group baselines as conflicts even after their referenced cards were deleted', async () => {
    const { handlers, cards } = await fixture()
    const original = [group([cards[0].id])]
    await handlers.updateOrganization('board', { baseGroups: [], groups: original })
    await handlers.deleteCard('board', cards[0].id)
    await expect(handlers.updateOrganization('board', { baseGroups: original, groups: [] })).rejects.toMatchObject({ code: 'ORGANIZATION_CONFLICT' })
  })

  it('classifies a frozen drag with a deleted member as a conflict before checking next membership', async () => {
    const { handlers, store, cards } = await fixture()
    const original = [group([cards[0].id])]
    await handlers.updateOrganization('board', { baseGroups: [], groups: original })
    await handlers.deleteCard('board', cards[0].id)
    const before = await store.load('board')
    await expect(handlers.updateOrganization('board', {
      baseGroups: original, groups: original,
      positions: [{ kind: 'card', id: cards[0].id, baseX: 0, baseY: 0, x: 100, y: 100 }],
    })).rejects.toMatchObject({ code: 'ORGANIZATION_CONFLICT' })
    expect(await store.load('board')).toEqual(before)
  })

  it('rejects dissolved-group restoration as a conflict when its member no longer exists', async () => {
    const { handlers, store, cards } = await fixture()
    const original = [group([cards[0].id])]
    await handlers.updateOrganization('board', { baseGroups: [], groups: original })
    await handlers.updateOrganization('board', { baseGroups: original, groups: [] })
    await handlers.deleteCard('board', cards[0].id)
    const before = await store.load('board')
    await expect(handlers.updateOrganization('board', { baseGroups: [], groups: original }))
      .rejects.toMatchObject({ code: 'ORGANIZATION_CONFLICT' })
    expect(await store.load('board')).toEqual(before)
  })

  it('returns HTTP 422/409 for invalid and stale input and retains archived read-only protection', async () => {
    const { handlers, store, cards } = await fixture()
    const server = createServer(createMiraApiHandler({ dispatch: (method, segments, body) => dispatchV2Route(method, segments, body, { handlers, store }) }))
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${server.address().port}/graphmind/api/v2/boards/board/organization`
    try {
      const invalid = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{}' })
      expect(invalid.status).toBe(422)
      expect((await invalid.json()).code).toBe('ORGANIZATION_INVALID')
      const stale = await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ colors: [{ cardId: cards[0].id, color: null, baseColor: 'red' }] }) })
      expect(stale.status).toBe(409)
      expect((await stale.json()).code).toBe('ORGANIZATION_CONFLICT')
      const board = await store.load('board')
      await store.save('board', { ...board, lifecycle: { state: 'archived' } })
      await expect(handlers.updateOrganization('board', { groups: [], baseGroups: [] })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('retains original storage after a failed atomic replacement', async () => {
    const { handlers, store, fs, cards } = await fixture()
    const before = await store.load('board')
    fs.replace = async () => { throw new Error('injected write failure') }
    await expect(handlers.updateOrganization('board', { baseGroups: [], groups: [group([cards[0].id])], colors: [{ cardId: cards[0].id, color: 'red', baseColor: null }] })).rejects.toMatchObject({ code: 'BOARD_V2_WRITE_FAILED' })
    expect(await store.load('board')).toEqual(before)
  })

  it.each([
    {}, { bad: true }, { groups: [] }, { baseGroups: [] }, { colors: [] },
    { colors: [{ cardId: 'card-1', color: '#fff', baseColor: null }] },
    { colors: [{ cardId: 'card-1', color: 'red' }] },
    { baseGroups: [], groups: [group(['card-1']), group(['card-1'], 'group-b')] },
    { positions: [{ kind: 'card', id: 'card-1', x: null, y: null, baseX: 0, baseY: 0 }] },
    { positions: [{ kind: 'transformation', id: 'x', x: null, y: 5, baseX: null, baseY: null }] },
    { colors: Array.from({ length: 101 }, (_, index) => ({ cardId: `card-${index}`, color: 'red', baseColor: null })) },
    { groups: Array.from({ length: 101 }, (_, index) => group([`card-${index}`], `group-${index}`)), baseGroups: [] },
    { groups: [group(Array.from({ length: 101 }, (_, index) => `card-${index}`))], baseGroups: [] },
    { groups: [{ ...group(['card-1']), parentId: 'other' }], baseGroups: [] },
  ])('strictly rejects malformed organization with zero writes: %j', async (request) => {
    const { handlers, store } = await fixture()
    const before = await store.load('board')
    await expect(handlers.updateOrganization('board', request)).rejects.toMatchObject({ code: 'ORGANIZATION_INVALID' })
    expect(await store.load('board')).toEqual(before)
  })

  it('creates independent group copies and preserves colors in ordinary creates', async () => {
    const { handlers, store } = await fixture()
    const request = { cards: [{ x: 0, y: 0, color: 'yellow' }], group: { title: 'Copy', color: 'green' } }
    const first = await handlers.createCards('board', request)
    const second = await handlers.createCards('board', request)
    expect(first.cards[0].color).toBe('yellow')
    expect(second.groups).toHaveLength(2)
    expect(second.groups[1].id).not.toBe(first.groups[0].id)
    expect(second.groups[1].cardIds).toEqual([second.cards[0].id])
    expect((await handlers.createCard('board', { x: 2, y: 3, color: 'violet' })).card.color).toBe('violet')
    const before = await store.load('board')
    await expect(handlers.createCards('board', { cards: [{ x: 0, y: 0, color: 'invalid' }], group: { title: 'Copy' } })).rejects.toMatchObject({ code: 'ORGANIZATION_INVALID' })
    expect(await store.load('board')).toEqual(before)
  })

  it('deletes empty groups and restores exact members while preserving unrelated groups', async () => {
    const { handlers, store, cards } = await fixture()
    const original = group([cards[0].id])
    await handlers.updateOrganization('board', { baseGroups: [], groups: [original] })
    const deletion = await handlers.deleteCard('board', cards[0].id)
    expect(deletion.groups).toEqual([])
    const unrelated = group([cards[1].id], 'other')
    await handlers.updateOrganization('board', { baseGroups: [], groups: [unrelated] })
    const restored = await handlers.restoreCards('board', { restoreReceiptId: deletion.restoreReceiptId })
    expect(restored.cards).toEqual([cards[0]])
    expect(restored.groups).toEqual(expect.arrayContaining([original, unrelated]))
    expect(validateBoardV2(await store.load('board'))).toEqual([])
  })

  it('fails restoration closed when an affected surviving group changed', async () => {
    const { handlers, store, cards } = await fixture()
    await handlers.updateOrganization('board', { baseGroups: [], groups: [group(cards.map(({ id }) => id))] })
    const deletion = await handlers.deleteCards('board', { cardIds: [cards[0].id] })
    await handlers.updateOrganization('board', { baseGroups: deletion.groups, groups: [{ ...deletion.groups[0], title: 'Changed' }] })
    const before = await store.load('board')
    await expect(handlers.restoreCards('board', { restoreReceiptId: deletion.restoreReceiptId })).rejects.toMatchObject({ code: 'CARD_RESTORE_CONFLICT' })
    expect(await store.load('board')).toEqual(before)
  })

  it('retains six 100-card grouped deletion batches and restores them without losing receipt capacity', async () => {
    const { handlers, store } = await fixture()
    const batches = []
    for (let index = 0; index < 6; index++) {
      batches.push(await handlers.createCards('board', { cards: Array.from({ length: 100 }, () => ({ x: 0, y: 0, color: 'blue' })), group: { title: `Batch ${index}` } }))
    }
    const original = await store.load('board')
    const deleted = []
    for (const batch of batches) deleted.push(await handlers.deleteCards('board', { cardIds: batch.cards.map(({ id }) => id) }))
    for (const batch of deleted.reverse()) await handlers.restoreCards('board', { restoreReceiptId: batch.restoreReceiptId })
    const restored = await store.load('board')
    expect(restored.groups).toEqual(original.groups)
    expect(restored.cards).toHaveLength(602)
  })

  it('validates stored colors/groups and remaps portable group identities and members', async () => {
    const { store, cards } = await fixture()
    const board = await store.load('board')
    board.cards[0].color = 'red'
    board.groups = [group(cards.map(({ id }) => id))]
    const artifact = projectBoardArtifact({ board, runs: [], workflows: [], exportedAt: NOW })
    let count = 0
    const copy = remapBoardArtifact(artifact, { generateId: (kind) => `new-${kind}-${++count}`, now: () => NOW })
    expect(copy.board.groups[0].id).not.toBe(board.groups[0].id)
    expect(copy.board.groups[0].cardIds).toEqual(copy.board.cards.map(({ id }) => id))
    expect(copy.board.cards[0].color).toBe('red')
    expect(validateBoardV2({ ...board, groups: [group(['missing'])] }).length).toBeGreaterThan(0)
    expect(validateBoardV2({ ...board, cards: [{ ...cards[0], color: 'bad' }, cards[1]] }).length).toBeGreaterThan(0)
  })

  it('round-trips organization through checkpoint forks and backup restore using real application storage', async () => {
    const { fs, handlers, cards, store } = await fixture()
    const groups = [group(cards.map(({ id }) => id))]
    await handlers.updateOrganization('board', { baseGroups: [], groups, colors: [{ cardId: cards[0].id, color: 'red', baseColor: null }] })
    let sequence = 0
    const app = createMiraApplication({ fs, newId: (kind) => `copy-${kind}-${++sequence}`, now: () => NOW })
    await app.ready
    const before = await store.load('board')
    const { checkpoint } = await app.checkpointService.create('board', { title: 'Stable', baseRevision: before.revision })
    expect(checkpoint.artifact.board.groups).toEqual(groups)
    const copy = await app.checkpointService.fork('board', checkpoint.id)
    expect(copy.board.groups[0].id).not.toBe(groups[0].id)
    expect(copy.board.groups[0].cardIds).toEqual(copy.board.cards.map(({ id }) => id))
    expect(copy.board.cards[0].color).toBe('red')
    expect(await store.load('board')).toEqual(before)
    const backup = await app.backupService.exportBackup()
    expect(backup.boards.find(({ id }) => id === 'board').groups).toEqual(groups)
    await fs.writeText('organization-backup.json', JSON.stringify(backup))
    const workspaceRoot = join(fs.root, 'restored')
    await restoreWorkspaceBackup({ inputPath: join(fs.root, 'organization-backup.json'), workspaceRoot })
    const restoredApp = createMiraApplication({ fs: createNodeWorkspaceAdapter(workspaceRoot) })
    await restoredApp.ready
    expect((await restoredApp.boardStore.load('board')).groups).toEqual(groups)
    const restoredCheckpoint = await restoredApp.checkpointStore.load('board', checkpoint.id)
    expect(restoredCheckpoint.artifact.board.cards[0].color).toBe('red')
    expect(restoredCheckpoint.artifact.board.groups).toEqual(groups)
    const invalid = structuredClone(backup)
    invalid.boards[0].groups[0].cardIds.push('missing')
    expect(() => validateWorkspaceBackup(invalid)).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
    const invalidCheckpoint = structuredClone(checkpoint)
    invalidCheckpoint.artifact.board.groups[0].cardIds.push('missing')
    expect(() => validateBoardCheckpoint(invalidCheckpoint)).toThrow()
  })
})
