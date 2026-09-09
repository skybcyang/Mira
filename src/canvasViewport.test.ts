import { describe, expect, it } from 'vitest'
import * as canvasOperations from './canvasOperations'
import {
  inspirationCanvasFocus,
  materializedPlanCanvasFocus,
  type MaterializedPlanFocusIntent,
} from './canvasViewport'

const { canvasMinimumZoom, shouldFitCanvasBoard } = canvasOperations

describe('large canvas viewport policy', () => {
  it('allows a complete overview once a board grows beyond 30 nodes', () => {
    expect(canvasMinimumZoom(30)).toBe(0.2)
    expect(canvasMinimumZoom(31)).toBe(0.08)
    expect(canvasMinimumZoom(86)).toBe(0.08)
  })

  it('fits each board once instead of refitting when drawers or panels change', () => {
    expect(shouldFitCanvasBoard(null, 'board-a', 'ready', 46)).toBe(true)
    expect(shouldFitCanvasBoard('board-a', 'board-a', 'ready', 46)).toBe(false)
    expect(shouldFitCanvasBoard('board-a', 'board-b', 'ready', 46)).toBe(true)
    expect(shouldFitCanvasBoard('board-a', 'board-b', 'loading', 46)).toBe(false)
    expect(shouldFitCanvasBoard('board-a', 'board-b', 'ready', 0)).toBe(false)
  })

  it('opens a populated board on a readable first stage instead of a tiny overview', () => {
    const initialFocus = (canvasOperations as unknown as {
      canvasInitialFocusNodeIds?: (
        nodes: Array<{ id: string; type?: string; position: { x: number; y: number } }>,
        viewportWidth: number,
      ) => string[]
    }).canvasInitialFocusNodeIds
    const nodes = [
      ...Array.from({ length: 31 }, (_, index) => ({
        id: `card-${index}`,
        type: 'contentCard',
        position: { x: index < 6 ? 0 : 520, y: (index % 6) * 300 },
      })),
      { id: 'junction:1', type: 'junction', position: { x: 0, y: 150 } },
    ]

    expect(initialFocus).toBeTypeOf('function')
    expect(initialFocus?.(nodes, 390)).toEqual(['card-0', 'card-1'])
    expect(initialFocus?.(nodes, 1280)).toEqual(['card-0', 'card-1', 'card-2'])
    expect(initialFocus?.(nodes.slice(0, 6), 390)).toEqual([])
  })
})

const node = (
  id: string,
  type: string,
  x: number,
  y: number,
  width = 312,
  height = 208,
) => ({ id, type, position: { x, y }, width, height })

describe('canvas viewport intents', () => {
  it('focuses only the real first source, transformation, and target after a plan lands', () => {
    const intent: MaterializedPlanFocusIntent = {
      boardId: 'board-1',
      viewportRevision: 4,
      previousTransformationIds: ['old-step'],
    }
    const board = {
      transformations: [
        { id: 'old-step', sourceCardIds: ['old'], targetCardId: 'old-target' },
        {
          id: 'plan-step-2',
          sourceCardIds: ['plan-target-1'],
          targetCardId: 'plan-target-2',
          planRef: { stepIndex: 2, stepTotal: 3 },
        },
        {
          id: 'plan-step-1',
          sourceCardIds: ['source-b', 'source-a'],
          targetCardId: 'plan-target-1',
          planRef: { stepIndex: 1, stepTotal: 3 },
        },
      ],
    }
    const nodes = [
      node('source-a', 'contentCard', 0, 0),
      node('source-b', 'contentCard', 0, 240),
      node('transformation-node:plan-step-1', 'transformation', 360, 0, 156, 92),
      node('plan-target-1', 'contentCard', 560, 0, 360, 240),
      node('transformation-node:plan-step-2', 'transformation', 960, 0, 156, 92),
      node('plan-target-2', 'contentCard', 1160, 0, 360, 240),
    ]

    expect(materializedPlanCanvasFocus(intent, {
      boardId: 'board-1',
      viewportRevision: 4,
      board,
      nodes,
    })).toEqual({
      nodeIds: ['source-b', 'transformation-node:plan-step-1', 'plan-target-1'],
    })
  })

  it('invalidates plan focus after board navigation or a user viewport move', () => {
    const intent: MaterializedPlanFocusIntent = {
      boardId: 'board-1',
      viewportRevision: 4,
      previousTransformationIds: [],
    }
    const board = {
      transformations: [{
        id: 'step-1',
        sourceCardIds: ['source'],
        targetCardId: 'target',
        planRef: { stepIndex: 1, stepTotal: 1 },
      }],
    }
    const nodes = [
      node('source', 'contentCard', 0, 0),
      node('transformation-node:step-1', 'transformation', 360, 0),
      node('target', 'contentCard', 560, 0),
    ]

    expect(materializedPlanCanvasFocus(intent, {
      boardId: 'board-2', viewportRevision: 4, board, nodes,
    })).toBeNull()
    expect(materializedPlanCanvasFocus(intent, {
      boardId: 'board-1', viewportRevision: 5, board, nodes,
    })).toBeNull()
  })

  it('keeps an inspiration group only while every selected card remains readable', () => {
    const nearby = [
      node('first', 'contentCard', 0, 0),
      node('second', 'contentCard', 344, 0),
      node('third', 'contentCard', 688, 0),
    ]
    expect(inspirationCanvasFocus(nearby, ['second', 'first', 'third'], {
      width: 1440, height: 900,
    })).toEqual({ nodeIds: ['second', 'first', 'third'], group: true })

    const spreadOut = [
      node('first', 'contentCard', 0, 0),
      node('second', 'contentCard', 2000, 0),
      node('third', 'contentCard', 5000, 0),
    ]
    expect(inspirationCanvasFocus(spreadOut, ['second', 'first', 'third'], {
      width: 1440, height: 900,
    })).toEqual({ nodeIds: ['second'], group: false })
  })

  it('uses the first selected current-board card as the narrow-screen primary target', () => {
    const nodes = [
      node('first', 'contentCard', 0, 0),
      node('second', 'contentCard', 344, 0),
    ]

    expect(inspirationCanvasFocus(nodes, ['second', 'first'], {
      width: 390, height: 844,
    })).toEqual({ nodeIds: ['second'], group: false })
  })

  it('waits for every selected inspiration card before resolving ordered focus', () => {
    expect(inspirationCanvasFocus([
      node('second', 'contentCard', 344, 0),
    ], ['first', 'second'], {
      width: 1440, height: 900,
    })).toBeNull()
  })
})
