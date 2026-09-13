import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMiraApplication } from '../../bridge/mira-application.js'
import { createNodeWorkspaceAdapter } from '../../bridge/node-workspace-adapter.js'

it('atomically saves selected material and pool provenance without runs, strips it on edits and preserves restore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-material-integration-'))
  let app, id = 0
  try {
    const fs = createNodeWorkspaceAdapter(root)
    app = createMiraApplication({ fs, newId: prefix => `${prefix}-${++id}`, materialReaders: { web: async () => ({ text: '保留原句\n不要保存的正文', title: '公开材料', url: 'https://example.com/source', sourceDigest: 'a'.repeat(64), reader: { id: 'fixture', version: '1' }, byteLength: 40 }) } })
    await app.ready
    const board = await app.boardStore.create('材料验收')
    const { preview } = await app.materialService.preview({ kind: 'web', url: 'https://example.com/source' })
    const body = { previewId: preview.previewId, spans: [{ start: 0, end: 4 }] }
    const replace = fs.replace
    fs.replace = async () => { throw new Error('disk failure') }
    await expect(app.materialService.saveCard(board.id, body)).rejects.toThrow()
    expect((await app.boardStore.load(board.id)).cards).toHaveLength(0)
    fs.replace = replace
    const { card } = await app.materialService.saveCard(board.id, body)
    expect(card.versions[0].materialOrigin.locators).toEqual(body.spans)
    expect(card.versions[0].content.markdown).not.toContain('不要保存')
    expect(await app.runStore.list(board.id)).toEqual([])
    await expect(app.handlers.createCard(board.id, { markdown: 'fake', materialOrigin: card.versions[0].materialOrigin })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const edited = await app.handlers.commitCardVersion(board.id, card.id, { baseVersionId: card.headVersionId, markdown: '人工改写' })
    expect(edited.card.versions.at(-1).materialOrigin).toBeUndefined()
    const restored = await app.handlers.restoreCardVersion(board.id, card.id, card.headVersionId, { baseVersionId: edited.card.headVersionId })
    expect(restored.card.versions.at(-1).materialOrigin).toEqual(card.versions[0].materialOrigin)
    const clip = await app.materialService.preview({ kind: 'web', url: 'https://example.com/source' })
    const { entry } = await app.materialService.saveCapture({ previewId: clip.preview.previewId, spans: body.spans, note: '我的备注', tags: ['阅读'] })
    const { cards } = await app.handlers.createCards(board.id, { cards: [{ poolSource: { poolId: 'inspiration-pool', entryId: entry.id, versionId: entry.headVersionId } }] })
    expect(cards[0].versions[0].materialOrigin).toEqual(entry.versions[0].materialOrigin)
    expect((await app.boardStore.load(board.id)).transformations).toEqual([])
    const readonlyPreview = await app.materialService.preview({ kind: 'web', url: 'https://example.com/source' })
    const beforeArchive = await app.boardStore.load(board.id)
    await app.handlers.archiveBoard(board.id, { baseRevision: beforeArchive.revision })
    await expect(app.materialService.saveCard(board.id, { ...body, previewId: readonlyPreview.preview.previewId })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    expect((await app.boardStore.load(board.id)).cards).toHaveLength(beforeArchive.cards.length)
  } finally { app?.materialService.close(); await rm(root, { recursive: true, force: true }) }
})
