import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from '../domain'
import { drawerTabTargets, type DrawerTabId } from './drawerTabs'

const now = '2026-09-03T00:00:00.000Z'

function card(id: string): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`, cardId: id, sequence: 1,
      content: { kind: 'markdown', markdown: id }, digest: id,
      origin: 'human', createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function transformation(id: string, targetCardId: string, lastRunId?: string): Transformation {
  return {
    id,
    sourceCardIds: ['source'],
    targetCardId,
    label: `成果 ${id}`,
    instruction: '生成',
    acceptance: '',
    permissions: { workspaceWrite: false },
    ...(lastRunId ? { lastRunId } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function run(id: string, transformationId: string, targetCardId: string): TransformationRun {
  return {
    id,
    boardId: 'board-1',
    transformationId,
    status: 'succeeded',
    sourceSnapshot: [],
    targetCardId,
    targetBaseVersionId: null,
    intent: 'create',
    createdAt: now,
  }
}

function board(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '课题',
    cards: [card('a'), card('b')],
    transformations: [
      transformation('t-1', 'b', 'run-1'),
      transformation('t-2', 'missing-card'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

const runs = { 'run-1': run('run-1', 't-1', 'b') }

function targetMap(
  ...args: Parameters<typeof drawerTabTargets>
): Partial<Record<DrawerTabId, unknown>> {
  return Object.fromEntries(
    drawerTabTargets(...args).map((entry) => [entry.tab, entry.target]),
  )
}

describe('drawerTabTargets', () => {
  it('offers no targets when the drawer is closed', () => {
    const entries = drawerTabTargets(null, board(), runs)
    expect(entries.every((entry) => entry.target === null && !entry.active)).toBe(true)
  })

  it('links content and versions tabs for the same card', () => {
    const boardState = board()
    const targets = targetMap({ tab: 'content', cardId: 'a' }, boardState, runs)
    expect(targets.content).toEqual({ tab: 'content', cardId: 'a' })
    expect(targets.versions).toEqual({ tab: 'versions', cardId: 'a' })
    const versionsTargets = drawerTabTargets({ tab: 'versions', cardId: 'a' }, boardState, runs)
    expect(versionsTargets.find((entry) => entry.tab === 'versions')?.active).toBe(true)
    expect(versionsTargets.find((entry) => entry.tab === 'content')?.active).toBe(false)
  })

  it('reaches the producing transformation and its last run from a target card', () => {
    const targets = targetMap({ tab: 'content', cardId: 'b' }, board(), runs)
    expect(targets.relation).toEqual({ tab: 'relation', transformationId: 't-1' })
    expect(targets.run).toEqual({ tab: 'run', runId: 'run-1' })
  })

  it('reaches the target card and last run from a transformation', () => {
    const targets = targetMap({ tab: 'relation', transformationId: 't-1' }, board(), runs)
    expect(targets.content).toEqual({ tab: 'content', cardId: 'b' })
    expect(targets.versions).toEqual({ tab: 'versions', cardId: 'b' })
    expect(targets.run).toEqual({ tab: 'run', runId: 'run-1' })
    const entries = drawerTabTargets({ tab: 'relation', transformationId: 't-1' }, board(), runs)
    expect(entries.find((entry) => entry.tab === 'relation')?.active).toBe(true)
  })

  it('reaches back to the transformation and target card from a run', () => {
    const targets = targetMap({ tab: 'run', runId: 'run-1' }, board(), runs)
    expect(targets.relation).toEqual({ tab: 'relation', transformationId: 't-1' })
    expect(targets.content).toEqual({ tab: 'content', cardId: 'b' })
    expect(targets.versions).toEqual({ tab: 'versions', cardId: 'b' })
  })

  it('omits targets whose objects no longer exist', () => {
    const boardState = board()
    const cardTargets = targetMap({ tab: 'content', cardId: 'missing' }, boardState, runs)
    expect(cardTargets.content).toBeNull()
    expect(cardTargets.versions).toBeNull()

    const noRun = targetMap({ tab: 'relation', transformationId: 't-2' }, boardState, runs)
    expect(noRun.run).toBeNull()
    expect(noRun.content).toBeNull()

    const staleRun = targetMap(
      { tab: 'relation', transformationId: 't-1' },
      boardState,
      {},
    )
    expect(staleRun.run).toBeNull()
  })
})
