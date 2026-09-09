import { describe, expect, it, vi } from 'vitest'
import {
  createSourceSnapshots,
  createTransformationRun,
  isStale,
} from '../../bridge/domain/snapshots.js'
import {
  adoptCandidate,
  applyRunOutput,
  discardCandidate,
} from '../../bridge/domain/runApplication.js'
import { appendVersion } from '../../bridge/domain/versioning.js'

function markdown(markdown) {
  return { kind: 'markdown', markdown }
}

function versionedCard(id, text, versionId = `${id}-v1`) {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    headVersionId: versionId,
    versions: [
      {
        id: versionId,
        cardId: id,
        sequence: 1,
        content: markdown(text),
        digest: `stored-${id}`,
        origin: 'human',
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    ],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function emptyCard(id = 'target') {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    headVersionId: null,
    versions: [],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function runningRun(overrides = {}) {
  return {
    id: 'run-1',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    status: 'running',
    sourceSnapshot: [],
    targetCardId: 'target',
    targetBaseVersionId: null,
    intent: 'create',
    createdAt: '2026-08-23T00:00:00.000Z',
    startedAt: '2026-08-23T00:00:01.000Z',
    ...overrides,
  }
}

describe('v2 run snapshots', () => {
  it('creates a run by freezing source versions and the target head together', async () => {
    const source = versionedCard('source', '输入')
    const target = versionedCard('target', '当前产物', 'target-v3')

    const run = await createTransformationRun(
      {
        id: 'run-2',
        boardId: 'board-1',
        transformation: {
          id: 'transformation-2',
          sourceCardIds: ['source'],
          targetCardId: 'target',
        },
        cards: [source, target],
        sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
        intent: 'update',
        createdAt: '2026-08-23T00:00:02.000Z',
      },
      {},
    )

    expect(run).toMatchObject({
      id: 'run-2',
      boardId: 'board-1',
      transformationId: 'transformation-2',
      status: 'queued',
      targetCardId: 'target',
      targetBaseVersionId: 'target-v3',
      intent: 'update',
      createdAt: '2026-08-23T00:00:02.000Z',
      sourceSnapshot: [
        {
          cardId: 'source',
          versionId: 'source-v1',
          resolvedContent: '输入',
        },
      ],
    })
  })

  it('freezes ordered markdown and file contents before execution', async () => {
    const markdownCard = versionedCard('notes', '访谈内容')
    const fileCard = {
      ...versionedCard('brief', ''),
      contentKind: 'file-reference',
      versions: [
        {
          id: 'brief-v1',
          cardId: 'brief',
          sequence: 1,
          content: { kind: 'file-reference', path: 'brief.md', readonly: true },
          digest: 'stored-brief',
          origin: 'human',
          createdAt: '2026-08-23T00:00:00.000Z',
        },
      ],
    }
    const resolveFileContent = vi.fn().mockResolvedValue('文件的实际正文')

    const snapshots = await createSourceSnapshots(
      [markdownCard, fileCard],
      [
        { cardId: 'brief', versionId: 'brief-v1' },
        { cardId: 'notes', versionId: 'notes-v1' },
      ],
      { resolveFileContent },
    )

    expect(snapshots.map((snapshot) => snapshot.cardId)).toEqual(['brief', 'notes'])
    expect(snapshots[0]).toMatchObject({
      cardId: 'brief',
      versionId: 'brief-v1',
      contentKind: 'file-reference',
      resolvedContent: '文件的实际正文',
    })
    expect(snapshots[0].digest).toMatch(/^fnv1a:/)
    expect(snapshots[1]).toMatchObject({
      contentKind: 'markdown',
      resolvedContent: '访谈内容',
    })
    expect(resolveFileContent).toHaveBeenCalledWith('brief.md')
  })

  it('rejects a stale source ref before reading any partial context', async () => {
    const resolveFileContent = vi.fn()

    await expect(
      createSourceSnapshots(
        [versionedCard('notes', '内容')],
        [{ cardId: 'notes', versionId: 'notes-v0' }],
        { resolveFileContent },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_VERSION_CHANGED' })
    expect(resolveFileContent).not.toHaveBeenCalled()
  })

  it.each([
    [
      'blank markdown',
      versionedCard('source', '   '),
      'source-v1',
    ],
    [
      'a dangling Head',
      { ...versionedCard('source', 'content'), headVersionId: 'source-missing' },
      'source-missing',
    ],
    [
      'an empty file path',
      {
        ...versionedCard('source', ''),
        contentKind: 'file-reference',
        versions: [
          {
            id: 'source-v1',
            cardId: 'source',
            sequence: 1,
            content: { kind: 'file-reference', path: '   ', readonly: true },
            digest: 'stored-source',
            origin: 'human',
            createdAt: '2026-08-23T00:00:00.000Z',
          },
        ],
      },
      'source-v1',
    ],
  ])('rejects %s before resolving source content', async (_case, source, versionId) => {
    const resolveFileContent = vi.fn().mockResolvedValue('should not be read')

    await expect(
      createSourceSnapshots(
        [source],
        [{ cardId: source.id, versionId }],
        { resolveFileContent },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
    expect(resolveFileContent).not.toHaveBeenCalled()
  })

  it('reports a single source read failure without returning a partial snapshot', async () => {
    const fileCard = {
      ...versionedCard('file', ''),
      contentKind: 'file-reference',
      versions: [
        {
          id: 'file-v1',
          cardId: 'file',
          sequence: 1,
          content: { kind: 'file-reference', path: 'missing.md', readonly: true },
          digest: 'stored-file',
          origin: 'human',
          createdAt: '2026-08-23T00:00:00.000Z',
        },
      ],
    }

    await expect(
      createSourceSnapshots(
        [versionedCard('notes', '内容'), fileCard],
        [
          { cardId: 'notes', versionId: 'notes-v1' },
          { cardId: 'file', versionId: 'file-v1' },
        ],
        { resolveFileContent: vi.fn().mockRejectedValue(new Error('ENOENT')) },
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
  })
})

describe('v2 run result application', () => {
  it('appends an AI version when the target still matches its frozen base', () => {
    const result = applyRunOutput(emptyCard(), runningRun(), '生成结果', {
      versionId: 'target-v1',
      finishedAt: '2026-08-23T00:01:00.000Z',
    })

    expect(result.card.headVersionId).toBe('target-v1')
    expect(result.card.versions[0]).toMatchObject({
      content: markdown('生成结果'),
      origin: 'ai',
      sourceRunId: 'run-1',
    })
    expect(result.run).toMatchObject({
      status: 'succeeded',
      finishedAt: '2026-08-23T00:01:00.000Z',
      result: {
        output: '生成结果',
        disposition: 'applied',
        appliedVersionId: 'target-v1',
      },
    })
  })

  it('keeps an intervening human edit and stores the output as a candidate', () => {
    const current = versionedCard('target', '人工决策', 'target-human-v1')
    const before = structuredClone(current)
    const result = applyRunOutput(current, runningRun(), '模型旧结果', {
      versionId: 'unused-version',
      finishedAt: '2026-08-23T00:01:00.000Z',
    })

    expect(result.card).toEqual(before)
    expect(result.run.result).toMatchObject({
      output: '模型旧结果',
      disposition: 'candidate',
    })
    expect(result.run.result).not.toHaveProperty('appliedVersionId')
  })

  it('adopts a candidate as a new version only against the current base', () => {
    const current = versionedCard('target', '人工决策', 'target-human-v1')
    const candidate = applyRunOutput(current, runningRun(), '候选结果', {
      versionId: 'unused-version',
      finishedAt: '2026-08-23T00:01:00.000Z',
    }).run

    const adopted = adoptCandidate(current, candidate, {
      baseVersionId: 'target-human-v1',
      versionId: 'target-v2',
      createdAt: '2026-08-23T00:02:00.000Z',
    })

    expect(adopted.card.headVersionId).toBe('target-v2')
    expect(adopted.card.versions[1]).toMatchObject({
      content: markdown('候选结果'),
      sourceRunId: 'run-1',
    })
    expect(adopted.run.result).toMatchObject({
      disposition: 'applied',
      appliedVersionId: 'target-v2',
    })
    expect(() =>
      adoptCandidate(current, candidate, {
        baseVersionId: null,
        versionId: 'target-v3',
        createdAt: '2026-08-23T00:03:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'CARD_VERSION_CONFLICT' }))
  })

  it('discards a candidate while retaining its full output', () => {
    const run = {
      ...runningRun({ status: 'succeeded' }),
      result: {
        output: '仍可审计的输出',
        digest: 'fnv1a:12345678',
        disposition: 'candidate',
      },
    }

    expect(discardCandidate(run).result).toEqual({
      output: '仍可审计的输出',
      digest: 'fnv1a:12345678',
      disposition: 'discarded',
    })
  })
})

describe('v2 stale derivation', () => {
  it('derives stale from source heads and resolved file digests without side effects', () => {
    const notes = versionedCard('notes', '旧内容')
    const other = versionedCard('other', '补充内容')
    const updatedNotes = appendVersion(notes, {
      baseVersionId: 'notes-v1',
      versionId: 'notes-v2',
      content: markdown('新内容'),
      origin: 'human',
      createdAt: '2026-08-23T00:02:00.000Z',
    })
    const appliedRun = {
      ...runningRun({ status: 'succeeded' }),
      sourceSnapshot: [
        {
          cardId: 'notes',
          versionId: 'notes-v1',
          contentKind: 'markdown',
          resolvedContent: '旧内容',
          digest: 'fnv1a:old',
        },
      ],
      result: {
        output: '产物',
        digest: 'fnv1a:output',
        disposition: 'applied',
        appliedVersionId: 'target-v1',
      },
    }
    const transformation = { sourceCardIds: ['notes'] }

    expect(isStale([notes], transformation, undefined)).toBe(false)
    expect(isStale([notes], transformation, appliedRun)).toBe(false)
    expect(isStale([updatedNotes], transformation, appliedRun)).toBe(true)
    expect(
      isStale([notes, other], { sourceCardIds: ['notes', 'other'] }, appliedRun),
    ).toBe(true)

    const twoSourceRun = {
      ...appliedRun,
      sourceSnapshot: [
        appliedRun.sourceSnapshot[0],
        {
          cardId: 'other',
          versionId: 'other-v1',
          contentKind: 'markdown',
          resolvedContent: '补充内容',
          digest: 'fnv1a:other',
        },
      ],
    }
    expect(
      isStale(
        [notes, other],
        { sourceCardIds: ['other', 'notes'] },
        twoSourceRun,
      ),
    ).toBe(true)

    const fileCard = {
      ...versionedCard('file', ''),
      contentKind: 'file-reference',
    }
    const fileRun = {
      ...appliedRun,
      sourceSnapshot: [
        {
          cardId: 'file',
          versionId: 'file-v1',
          contentKind: 'file-reference',
          resolvedContent: '旧文件',
          digest: 'fnv1a:file-old',
        },
      ],
    }
    const fileTransformation = { sourceCardIds: ['file'] }
    expect(
      isStale([fileCard], fileTransformation, fileRun, { file: 'fnv1a:file-old' }),
    ).toBe(false)
    expect(
      isStale([fileCard], fileTransformation, fileRun, { file: 'fnv1a:file-new' }),
    ).toBe(true)
  })
})
