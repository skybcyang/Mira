import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard } from './domain'
import {
  cardSelectionDeleteBlocker,
  canvasActiveBranchElementIds,
  canvasKeyboardIntent,
  collisionFreeCanvasCardPosition,
  copyCards,
  pastedCardInputs,
  workflowDraftFocusNodeIds,
} from './canvasOperations'

const now = '2026-08-23T00:00:00.000Z'

function markdownCard(
  id: string,
  x: number,
  y: number,
  versions: Array<{ id: string; markdown: string }>,
): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x,
    y,
    width: 300,
    height: 180,
    headVersionId: versions[versions.length - 1]?.id || null,
    versions: versions.map((version, index) => ({
      id: version.id,
      cardId: id,
      sequence: index + 1,
      content: { kind: 'markdown', markdown: version.markdown },
      digest: `${id}-${index + 1}`,
      origin: 'human',
      createdAt: now,
    })),
    createdAt: now,
    updatedAt: now,
  }
}

function fileCard(id: string, x: number, y: number): ContentCard {
  return {
    id,
    contentKind: 'file-reference',
    x,
    y,
    width: 280,
    height: 160,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`,
      cardId: id,
      sequence: 1,
      content: { kind: 'file-reference', path: 'docs/source.md', readonly: true },
      digest: `${id}-digest`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function board(cards: ContentCard[]): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards,
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

describe('canvas card operations', () => {
  it('centers new cards on the intent anchor and deterministically avoids collisions', () => {
    const anchor = { x: 600, y: 400 }
    const first = collisionFreeCanvasCardPosition(anchor, [])
    const second = collisionFreeCanvasCardPosition(anchor, [
      { ...first, width: 312, height: 208 },
    ])
    const third = collisionFreeCanvasCardPosition(anchor, [
      { ...first, width: 312, height: 208 },
      { ...second, width: 312, height: 208 },
    ])

    expect(first).toEqual({ x: 444, y: 296 })
    expect(second).toEqual({ x: 780, y: 296 })
    expect(third).toEqual({ x: 444, y: 528 })
    expect(collisionFreeCanvasCardPosition(anchor, [
      { ...first, width: 312, height: 208 },
      { ...second, width: 312, height: 208 },
    ])).toEqual(third)
  })

  it('focuses only the selected card and its immediate transformation branch', () => {
    const nodes = [
      { id: 'source', position: { x: 0, y: 0 } },
      { id: 'step-1', position: { x: 300, y: 0 } },
      { id: 'target', position: { x: 600, y: 0 } },
      { id: 'step-2', position: { x: 900, y: 0 } },
      { id: 'final', position: { x: 1200, y: 0 } },
      { id: 'unrelated', position: { x: 0, y: 500 } },
    ]
    const edges = [
      { id: 'edge-1', source: 'source', target: 'step-1' },
      { id: 'edge-2', source: 'step-1', target: 'target' },
      { id: 'edge-3', source: 'target', target: 'step-2' },
      { id: 'edge-4', source: 'step-2', target: 'final' },
    ]

    expect(canvasActiveBranchElementIds(nodes, edges, ['source'])).toEqual({
      nodeIds: ['source', 'step-1', 'target'],
      edgeIds: ['edge-1', 'edge-2'],
    })
    expect(canvasActiveBranchElementIds(nodes, edges, [])).toEqual({
      nodeIds: [],
      edgeIds: [],
    })
  })

  it('focuses a workflow draft on one nearby content card and its first step', () => {
    const nodes = [
      { id: 'content-far', type: 'contentCard', position: { x: 0, y: 0 }, selected: true },
      { id: 'content-near', type: 'contentCard', position: { x: 380, y: 40 }, selected: true },
      { id: 'workflow-draft-step-0', type: 'workflowDraftStep', position: { x: 700, y: 40 } },
      { id: 'workflow-draft-target-0', type: 'workflowDraftTarget', position: { x: 1040, y: 40 } },
      { id: 'workflow-draft-step-1', type: 'workflowDraftStep', position: { x: 1380, y: 40 } },
    ]

    expect(workflowDraftFocusNodeIds(nodes, { x: 700, y: 40 })).toEqual([
      'content-near',
      'workflow-draft-step-0',
    ])

    expect(workflowDraftFocusNodeIds(
      nodes.map((node) => ({ ...node, selected: false })),
      { x: 700, y: 40 },
    )).toEqual(['workflow-draft-step-0'])
  })

  it('maps canvas shortcuts without stealing browser commands or arrow movement', () => {
    expect(canvasKeyboardIntent({ key: 'z', metaKey: true }, 0)).toBe('undo')
    expect(canvasKeyboardIntent({ key: 'z', ctrlKey: true, shiftKey: true }, 0)).toBe('redo')
    expect(canvasKeyboardIntent({ key: 'y', ctrlKey: true }, 0)).toBe('redo')
    expect(canvasKeyboardIntent({ key: 'a', metaKey: true }, 2)).toBe('select-all')
    expect(canvasKeyboardIntent({ key: 'c', ctrlKey: true }, 2)).toBe('copy')
    expect(canvasKeyboardIntent({ key: 'v', metaKey: true }, 0)).toBe('paste')
    expect(canvasKeyboardIntent({ key: 'd', ctrlKey: true }, 1)).toBe('duplicate')
    expect(canvasKeyboardIntent({ key: 'Delete' }, 1)).toBe('delete')
    expect(canvasKeyboardIntent({ key: 'n' }, 0)).toBe('create')
    expect(canvasKeyboardIntent({ key: 'n', metaKey: true }, 0)).toBeNull()
    expect(canvasKeyboardIntent({ key: 'Enter' }, 1)).toBe('edit')
    expect(canvasKeyboardIntent({ key: 'Enter' }, 2)).toBeNull()
    expect(canvasKeyboardIntent({ key: 'ArrowRight', shiftKey: true }, 1)).toBeNull()
  })

  it('copies only the current visible Head and preserves relative layout', () => {
    const first = markdownCard('first', 100, 80, [
      { id: 'first-v1', markdown: '# 旧稿' },
      { id: 'first-v2', markdown: '# 当前稿' },
    ])
    first.name = '独立名称'
    const second = fileCard('second', 460, 260)

    expect(copyCards(board([first, second]), ['second', 'first'])).toEqual({
      items: [
        {
          contentKind: 'file-reference',
          filePath: 'docs/source.md',
          readonly: true,
          width: 280,
          height: 160,
          offsetX: 40,
          offsetY: 10,
        },
        {
          contentKind: 'markdown',
          markdown: '# 当前稿',
          name: '独立名称',
          width: 300,
          height: 180,
          offsetX: -320,
          offsetY: -170,
        },
      ],
      pasteCount: 0,
    })
  })

  it('centers a pasted group and offsets each repeated paste without copying identity', () => {
    const clipboard = copyCards(board([
      { ...markdownCard('a', 100, 100, [{ id: 'a-v1', markdown: 'A' }]), name: '保留名字' },
      markdownCard('b', 440, 280, [{ id: 'b-v1', markdown: 'B' }]),
    ]), ['a', 'b'])!

    expect(pastedCardInputs(clipboard, { x: 800, y: 500 })).toEqual([
      { contentKind: 'markdown', markdown: 'A', name: '保留名字', x: 480, y: 320, width: 300, height: 180 },
      { contentKind: 'markdown', markdown: 'B', x: 820, y: 500, width: 300, height: 180 },
    ])
    expect(pastedCardInputs({ ...clipboard, pasteCount: 2 }, { x: 800, y: 500 })[0])
      .toMatchObject({ x: 528, y: 368 })
  })

  it('explains why a selection cannot be deleted without partially deleting it', () => {
    const canvas = board([
      markdownCard('free', 0, 0, [{ id: 'free-v1', markdown: 'free' }]),
      markdownCard('source', 0, 0, [{ id: 'source-v1', markdown: 'source' }]),
      markdownCard('target', 0, 0, [{ id: 'target-v1', markdown: 'target' }]),
    ])
    canvas.transformations.push({
      id: 'transformation-1',
      sourceCardIds: ['source'],
      targetCardId: 'target',
      label: '形成成果',
      instruction: '形成成果',
      acceptance: '',
      permissions: { workspaceWrite: false },
      createdAt: now,
      updatedAt: now,
    })

    expect(cardSelectionDeleteBlocker(canvas, ['free'])).toBeNull()
    expect(cardSelectionDeleteBlocker(canvas, ['free', 'source'])).toEqual({
      cardIds: ['source'],
      reason: 'related',
    })
  })
})
