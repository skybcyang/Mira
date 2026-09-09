import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import { useV2Canvas } from './v2Store'
import { v2Api } from './v2Api'

const timestamp = '2026-09-07T00:00:00.000Z'
const card = (id: string): ContentCard => ({
  id, contentKind: 'markdown', x: 0, y: 0, width: 300, height: 180,
  headVersionId: id + '-v1', createdAt: timestamp, updatedAt: timestamp,
  versions: [{ id: id + '-v1', cardId: id, sequence: 1, content: { kind: 'markdown', markdown: id },
    digest: id, origin: 'human', createdAt: timestamp }],
})
const step = (id: string, sourceCardIds: string[], targetCardId: string) => ({
  id, sourceCardIds, targetCardId, label: id, instruction: id, acceptance: '',
  permissions: { workspaceWrite: false }, createdAt: timestamp, updatedAt: timestamp,
})
function board(): BoardV2 {
  return { schemaVersion: 2, id: 'board', title: 'test', cards: ['a', 'b', 'c', 'target', 'downstream'].map(card),
    transformations: [step('step', ['a'], 'target'), step('next', ['target'], 'downstream')],
    viewport: { x: 0, y: 0, zoom: 1 }, createdAt: timestamp, updatedAt: timestamp }
}
beforeEach(() => {
  useV2Canvas.setState({ board: board(), boardId: 'board', runs: {}, selectedCardIds: ['c'],
    notices: [], sourcePicker: null, drawer: null, loadState: 'ready', historyPast: [], historyFuture: [] })
})
afterEach(() => vi.restoreAllMocks())
const connect = (source: string) => useV2Canvas.getState().onConnect({
  source, target: 'transformation-node:step', sourceHandle: null, targetHandle: null,
})
function mockUpdate() {
  return vi.spyOn(v2Api, 'updateTransformation').mockImplementation(async (_board, id, changes) => ({
    transformation: { ...useV2Canvas.getState().board!.transformations.find(t => t.id === id)!,
      sourceCardIds: changes.sourceRefs!.map(ref => ref.cardId), updatedAt: timestamp + '-next' },
  }))
}
it('appends sources in drop order, deduplicates, preserves target and creates no run or history', async () => {
  const update = mockUpdate()
  const run = vi.spyOn(v2Api, 'startRun')
  await connect('b')
  await connect('c')
  await connect('b')
  expect(update).toHaveBeenCalledTimes(2)
  expect(useV2Canvas.getState().board?.transformations[0]).toMatchObject({ sourceCardIds: ['a', 'b', 'c'], targetCardId: 'target' })
  expect(run).not.toHaveBeenCalled()
  expect(useV2Canvas.getState().historyPast).toEqual([])
})
it.each(['target', 'downstream', 'missing'])('rejects invalid connection %s with a notice and no write', async source => {
  const update = mockUpdate()
  await connect(source)
  expect(update).not.toHaveBeenCalled()
  expect(useV2Canvas.getState().notices.length).toBeGreaterThan(0)
})
it('keeps picker choices local and cancels without changing the board or selection', () => {
  const original = useV2Canvas.getState().board
  useV2Canvas.getState().beginSourcePicker?.('step')
  useV2Canvas.getState().toggleSourcePickerCard?.('b')
  expect(useV2Canvas.getState().sourcePicker?.cardIds).toEqual(['b'])
  expect(useV2Canvas.getState().board).toBe(original)
  useV2Canvas.getState().cancelSourcePicker?.()
  expect(useV2Canvas.getState().sourcePicker).toBeNull()
  expect(useV2Canvas.getState().selectedCardIds).toEqual(['c'])
})
it('confirms multiple picker sources in selection order with the original edit baseline', async () => {
  const update = mockUpdate()
  useV2Canvas.getState().beginSourcePicker?.('step')
  useV2Canvas.getState().toggleSourcePickerCard?.('c')
  useV2Canvas.getState().toggleSourcePickerCard?.('b')
  await useV2Canvas.getState().confirmSourcePicker?.()
  expect(update).toHaveBeenCalledWith('board', 'step', {
    baseUpdatedAt: timestamp, sourceRefs: ['a', 'c', 'b'].map(cardId => ({ cardId, versionId: cardId + '-v1' })),
  })
  expect(useV2Canvas.getState().sourcePicker).toBeNull()
  expect(useV2Canvas.getState().drawer).toEqual({ tab: 'relation', transformationId: 'step' })
})

it.each(['running', 'candidate'])('blocks source edits during %s without a request', async kind => {
  useV2Canvas.setState({ runs: { run: {
    id: 'run', boardId: 'board', transformationId: 'step', targetCardId: 'target',
    status: kind === 'running' ? 'running' : 'succeeded',
    ...(kind === 'candidate' ? { result: { disposition: 'candidate', outputText: 'result' } } : {}),
  } as never } })
  const update = mockUpdate()
  await connect('b')
  expect(update).not.toHaveBeenCalled()
  expect(useV2Canvas.getState().notices.length).toBeGreaterThan(0)
})

it('rejects removing the final source and accepts reordering without modifying the target', async () => {
  const update = mockUpdate()
  expect(await useV2Canvas.getState().updateTransformation('step', { sourceCardIds: [] })).toBe(false)
  expect(update).not.toHaveBeenCalled()
  await connect('b')
  await useV2Canvas.getState().updateTransformation('step', { sourceCardIds: ['b', 'a'] })
  expect(useV2Canvas.getState().board?.transformations[0].sourceCardIds).toEqual(['b', 'a'])
})

it('retains choices and the original baseline on conflict, without silently overwriting a newer edit', async () => {
  useV2Canvas.getState().beginSourcePicker('step')
  useV2Canvas.getState().toggleSourcePickerCard('b')
  const newer = board()
  newer.transformations[0].sourceCardIds = ['a', 'c']
  newer.transformations[0].updatedAt = 'newer'
  vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: newer })
  const update = vi.spyOn(v2Api, 'updateTransformation').mockRejectedValue({ code: 'TRANSFORMATION_CONFLICT' })
  await useV2Canvas.getState().confirmSourcePicker()
  expect(update.mock.calls[0][2].baseUpdatedAt).toBe(timestamp)
  expect(useV2Canvas.getState().sourcePicker).toMatchObject({ cardIds: ['b'], saving: false, baseUpdatedAt: timestamp })
  expect(useV2Canvas.getState().board?.transformations[0].sourceCardIds).toEqual(['a', 'c'])
})

it('ignores late picker navigation when the user opens another detail while saving', async () => {
  let finish!: (value: Awaited<ReturnType<typeof v2Api.updateTransformation>>) => void
  vi.spyOn(v2Api, 'updateTransformation').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  useV2Canvas.getState().beginSourcePicker('step')
  useV2Canvas.getState().toggleSourcePickerCard('b')
  const saving = useV2Canvas.getState().confirmSourcePicker()
  useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'c' })
  finish({ transformation: { ...board().transformations[0], sourceCardIds: ['a', 'b'] } })
  await saving
  expect(useV2Canvas.getState().sourcePicker).toBeNull()
  expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'c' })
})

it('cancels source picking when another canvas task dismisses details', () => {
  useV2Canvas.getState().beginSourcePicker('step')
  useV2Canvas.getState().toggleSourcePickerCard('b')
  useV2Canvas.getState().openDrawer(null)
  expect(useV2Canvas.getState().sourcePicker).toBeNull()
})

it('clears picker choices on board navigation without writing them', async () => {
  const other = { ...board(), id: 'other' }
  vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: other })
  const update = mockUpdate()
  useV2Canvas.getState().beginSourcePicker('step')
  useV2Canvas.getState().toggleSourcePickerCard('b')
  await useV2Canvas.getState().switchBoard('other')
  expect(useV2Canvas.getState().sourcePicker).toBeNull()
  expect(update).not.toHaveBeenCalled()
})

it('rejects overlapping source writes explicitly instead of losing an accepted source', async () => {
  let finish!: (value: Awaited<ReturnType<typeof v2Api.updateTransformation>>) => void
  const update = vi.spyOn(v2Api, 'updateTransformation').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const first = connect('b')
  await connect('c')
  expect(update).toHaveBeenCalledOnce()
  expect(useV2Canvas.getState().message).toContain('正在保存')
  finish({ transformation: { ...board().transformations[0], sourceCardIds: ['a', 'b'] } })
  await first
  expect(useV2Canvas.getState().board?.transformations[0].sourceCardIds).toEqual(['a', 'b'])
})
