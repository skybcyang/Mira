import { afterEach, expect, it, vi } from 'vitest'
import { useV2Canvas } from './v2Store'
import { v2Api } from './v2Api'
import type { BoardV2, ContentCard } from './domain'
const initial = useV2Canvas.getState()
afterEach(() => { useV2Canvas.setState(initial); vi.restoreAllMocks() })
it('adds one material without selecting it or opening a drawer and records undo only once', async () => {
  const board: BoardV2 = { schemaVersion: 2, id: 'board', title: 'test', cards: [], transformations: [], viewport: { x: 0, y: 0, zoom: 1 }, createdAt: 'now', updatedAt: 'now' }
  useV2Canvas.setState({ ...initial, boardId: board.id, board })
  const card: ContentCard = { id: 'material', contentKind: 'markdown', headVersionId: 'version', versions: [], x: 0, y: 0, width: 312, height: 208, createdAt: 'now', updatedAt: 'now' }
  const save = vi.spyOn(v2Api, 'saveMaterial').mockResolvedValue({ card })
  expect(await useV2Canvas.getState().saveMaterial('preview', [{ start: 0, end: 5 }])).toBe('created')
  expect(await useV2Canvas.getState().saveMaterial('preview', [{ start: 0, end: 5 }])).toBe('created')
  expect(save).toHaveBeenCalledTimes(1)
  expect(useV2Canvas.getState().board?.cards).toEqual([card])
  expect(useV2Canvas.getState().historyPast).toHaveLength(1)
  expect(useV2Canvas.getState().selectedCardIds).toEqual([])
  expect(useV2Canvas.getState().drawer).toBeNull()
})
