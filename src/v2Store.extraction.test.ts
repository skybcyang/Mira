import { afterEach, describe, expect, it, vi } from 'vitest'
import { useV2Canvas } from './v2Store'
import { v2Api } from './v2Api'
import type { BoardV2, ContentCard } from './domain'

const source: ContentCard = { id: 'source', contentKind: 'markdown', x: 0, y: 0, width: 312, height: 208, headVersionId: 'v1', versions: [{ id: 'v1', cardId: 'source', sequence: 1, content: { kind: 'markdown', markdown: '材料' }, digest: 'd', origin: 'human', createdAt: 'now' }], createdAt: 'now', updatedAt: 'now' }
const initial = useV2Canvas.getState()
function setup() {
  const board: BoardV2 = { schemaVersion: 2, id: 'board', title: '验证', cards: [source], transformations: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 'now', updatedAt: 'now' }
  useV2Canvas.setState({ ...initial, boardId: board.id, board, drawer: { tab: 'content', cardId: source.id }, selectedCardIds: [source.id], historyPast: [], historyFuture: [] })
}
afterEach(() => { vi.restoreAllMocks(); useV2Canvas.setState(initial) })

describe('extraction commands', () => {
  it('records one version-aware history command and restores provenance on undo and redo', async () => {
    setup()
    const saved = { ...source, headVersionId: 'v2', versions: [...source.versions, { ...source.versions[0], id: 'v2', sequence: 2, content: { kind: 'markdown' as const, markdown: '更新' }, extractionSources: [{ boardId: 'board', cardId: 'list', versionId: 'list-v2', itemId: 'a' }] }] }
    vi.spyOn(v2Api, 'reviseExtractionCard').mockResolvedValue({ card: saved, noop: false })
    expect(await useV2Canvas.getState().reviseExtractionCard('source', 'v1', { cardId: 'list', versionId: 'list-v2', itemIds: ['a'] }, '更新')).toBe('created')
    expect(useV2Canvas.getState().historyPast).toMatchObject([{ kind: 'content', beforeVersionId: 'v1', afterVersionId: 'v2' }])
    const restore = vi.spyOn(v2Api, 'restoreVersion').mockResolvedValue({ card: { ...source, headVersionId: 'v3' } })
    await useV2Canvas.getState().undo()
    expect(restore).toHaveBeenLastCalledWith('board', 'source', 'v1', 'v2')
    restore.mockResolvedValue({ card: { ...saved, headVersionId: 'v4' } })
    await useV2Canvas.getState().redo()
    expect(restore).toHaveBeenLastCalledWith('board', 'source', 'v2', 'v3')
  })
  it('distinguishes a rejected step from an uncertain receipt and does not mutate the board', async () => {
    setup()
    const request = vi.spyOn(v2Api, 'createTransformation').mockRejectedValue(Object.assign(new Error('source changed'), { status: 409 }))
    expect(await useV2Canvas.getState().createExtractionStep('source', 'rejected', '提取')).toBe('failed')
    request.mockResolvedValue({} as never)
    expect(await useV2Canvas.getState().createExtractionStep('source', 'missing-receipt', '提取')).toBe('uncertain')
    expect(useV2Canvas.getState().board?.cards).toEqual([source])
  })
  it('creates a single extraction step without running and preserves the source', async () => {
    setup()
    const target = { ...source, id: 'target', headVersionId: null, versions: [] }
    vi.spyOn(v2Api, 'createTransformation').mockResolvedValue({ targetCard: target, transformation: { id: 'step', sourceCardIds: ['source'], targetCardId: 'target', label: '提取清单', instruction: '要求', acceptance: '', permissions: { workspaceWrite: false }, createdAt: 'now', updatedAt: 'now' } })
    const start = vi.spyOn(v2Api, 'startRun')
    expect(useV2Canvas.getState().createExtractionStep).toBeTypeOf('function')
    expect(await useV2Canvas.getState().createExtractionStep('source', 'v1', '提取不同观点')).toBe('created')
    expect(v2Api.createTransformation).toHaveBeenCalledWith('board', expect.objectContaining({ sourceRefs: [{ cardId: 'source', versionId: 'v1' }], instruction: expect.stringContaining('mira:extraction:v1') }))
    expect(start).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().board?.cards[0]).toEqual(source)
    expect(useV2Canvas.getState().board?.cards).toHaveLength(2)
  })
  it('does not blindly retry an uncertain split request and leaves history unchanged', async () => {
    setup()
    expect(useV2Canvas.getState().splitExtraction).toBeTypeOf('function')
    const request = vi.spyOn(v2Api, 'extractCards').mockRejectedValue(new TypeError('network lost'))
    const items = [{ itemId: 'one', title: '标题', markdown: '正文' }]
    expect(await useV2Canvas.getState().splitExtraction('source', 'v1', items)).toBe('uncertain')
    expect(await useV2Canvas.getState().splitExtraction('source', 'v1', items)).toBe('uncertain')
    expect(request).toHaveBeenCalledTimes(1)
    expect(useV2Canvas.getState().historyPast).toEqual([])
    expect(useV2Canvas.getState().board?.cards).toEqual([source])
  })
})
