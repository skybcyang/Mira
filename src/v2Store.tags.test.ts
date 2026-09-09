import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-09-01T00:00:00.000Z'

function taggedCard(tags: string[], updatedAt = now): ContentCard {
  return {
    id: 'idea',
    contentKind: 'markdown',
    tags,
    x: 100,
    y: 120,
    width: 312,
    height: 208,
    headVersionId: 'idea-v1',
    versions: [{
      id: 'idea-v1',
      cardId: 'idea',
      sequence: 1,
      content: { kind: 'markdown', markdown: 'A reusable idea' },
      digest: 'idea-digest',
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt,
  }
}

function resetStore() {
  const board: BoardV2 = {
    schemaVersion: 2,
    id: 'current',
    title: '当前课题',
    cards: [taggedCard(['主意'])],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
  useV2Canvas.setState({
    boardId: board.id,
    board,
    ...projectV2Board(board, {}),
    selectedCardIds: ['idea'],
    saveState: 'saved',
    message: null,
    historyPast: [],
    historyFuture: [],
  })
}

function updateTagsAction() {
  return (useV2Canvas.getState() as unknown as {
    updateCardTags?: (cardId: string, tags: string[]) => Promise<boolean>
  }).updateCardTags
}

beforeEach(resetStore)
afterEach(() => vi.restoreAllMocks())

describe('card tag metadata', () => {
  it('updates tags without changing Head, versions, selection, or history', async () => {
    const updated = taggedCard(['约束', '技术'], '2026-09-01T01:00:00.000Z')
    const updateCard = vi.spyOn(v2Api, 'updateCard').mockResolvedValue({ card: updated })
    const action = updateTagsAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const saved = await action('idea', [' 约束 ', '技术'])

    expect(updateCard).toHaveBeenCalledWith('current', 'idea', { tags: [' 约束 ', '技术'] })
    expect(saved).toBe(true)
    expect(useV2Canvas.getState().board?.cards[0]).toEqual(updated)
    expect(useV2Canvas.getState().board?.cards[0].headVersionId).toBe('idea-v1')
    expect(useV2Canvas.getState().board?.cards[0].versions).toHaveLength(1)
    expect(useV2Canvas.getState().selectedCardIds).toEqual(['idea'])
    expect(useV2Canvas.getState().historyPast).toEqual([])
    expect(useV2Canvas.getState()).toMatchObject({ saveState: 'saved', message: null })
  })

  it('keeps the existing card when tag persistence fails', async () => {
    vi.spyOn(v2Api, 'updateCard').mockRejectedValue(new Error('tag write failed'))
    const before = structuredClone(useV2Canvas.getState().board)
    const action = updateTagsAction()
    expect(action).toBeTypeOf('function')
    if (!action) return

    const saved = await action('idea', ['事件'])

    expect(saved).toBe(false)
    expect(useV2Canvas.getState().board).toEqual(before)
    expect(useV2Canvas.getState()).toMatchObject({ saveState: 'error' })
    expect(useV2Canvas.getState().message).toContain('tag write failed')
  })
})
