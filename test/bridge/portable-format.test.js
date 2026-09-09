import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BOARD_ARTIFACT_LIMITS,
  MIRA_BACKUP_LIMITS,
  assertPortableByteLength,
  assertPortableObjectLimits,
  countPortableBoards,
  normalizePortableBoard,
  utf8JsonByteLength,
  validateWorkspaceRelativePath,
} from '../../bridge/domain/portable-format.js'
import { projectBoardArtifact } from '../../bridge/domain/board-artifact.js'
import {
  projectWorkspaceBackup,
  validateWorkspaceBackup,
} from '../../bridge/domain/workspace-backup.js'

const NOW = '2026-09-02T08:00:00.000Z'

function version(id, cardId, content = { kind: 'markdown', markdown: '# 内容' }, overrides = {}) {
  return {
    id,
    cardId,
    sequence: 1,
    content,
    digest: `digest:${id}`,
    origin: 'human',
    createdAt: NOW,
    ...overrides,
  }
}

function card(id, overrides = {}) {
  const head = version(`${id}-v1`, id)
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: head.id,
    versions: [head],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function board(id = 'board-1', overrides = {}) {
  return {
    schemaVersion: 2,
    id,
    title: `Board ${id}`,
    revision: 7,
    lifecycle: { state: 'archived', archivedAt: NOW },
    cards: [card(`${id}-card-1`)],
    transformations: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    runtime: { rootSessionId: 'session-secret', harmless: 'kept' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function run(id = 'run-1', boardId = 'board-1', overrides = {}) {
  return {
    id,
    boardId,
    transformationId: 'historical-transformation',
    status: 'failed',
    sourceSnapshot: [],
    targetCardId: 'historical-target',
    targetBaseVersionId: null,
    intent: 'update',
    error: { code: 'MODEL_FAILED', message: 'failed', retryable: true },
    createdAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function pendingCandidateClosure() {
  const source = card('source')
  const target = card('target')
  const pending = run('run-candidate', 'board-1', {
    transformationId: 'transformation-current',
    status: 'succeeded',
    sourceSnapshot: [{
      cardId: source.id,
      versionId: source.headVersionId,
      contentKind: 'markdown',
      resolvedContent: '# 内容',
      digest: `digest:${source.headVersionId}`,
    }],
    targetCardId: target.id,
    result: { output: 'candidate', digest: 'digest:candidate', disposition: 'candidate' },
    error: undefined,
  })
  const currentBoard = board('board-1', {
    runtime: { harmless: 'kept' },
    cards: [source, target],
    transformations: [{
      id: 'transformation-current',
      sourceCardIds: [source.id],
      targetCardId: target.id,
      label: '形成结论',
      instruction: '整理来源',
      acceptance: '',
      permissions: { workspaceWrite: false },
      lastRunId: pending.id,
      createdAt: NOW,
      updatedAt: NOW,
    }],
  })
  return { currentBoard, pending }
}

function workflow(id = 'workflow-1', overrides = {}) {
  return {
    id,
    title: '研究方法',
    description: '把材料整理成结论',
    inputs: [{
      id: `${id}-input-1`,
      name: '材料',
      description: '',
      required: true,
      cardinality: 'many',
    }],
    steps: [{
      id: `${id}-step-1`,
      label: '形成结论',
      instruction: '整理材料',
      acceptance: '',
      sources: [{ kind: 'input', inputId: `${id}-input-1` }],
    }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function backup(overrides = {}) {
  return {
    format: 'mira-backup',
    formatVersion: 1,
    exportedAt: NOW,
    boards: [board('board-1', { runtime: { harmless: 'kept' } })],
    runs: [run()],
    workflows: [workflow()],
    ...overrides,
  }
}

function checkpoint(id = 'checkpoint-1', boardValue = board('board-1', { runtime: { harmless: 'kept' } }), overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    boardId: boardValue.id,
    title: `Checkpoint ${id}`,
    baseBoardRevision: boardValue.revision,
    artifact: projectBoardArtifact({ board: boardValue, runs: [], exportedAt: NOW }),
    createdAt: NOW,
    metadataUpdatedAt: NOW,
    ...overrides,
  }
}

describe('portable format limits', () => {
  it('omits Markdown Card file bindings from portable boards', () => {
    const normalized = normalizePortableBoard(board('board-1', {
      cards: [card('card-1', {
        fileBinding: {
          path: 'docs/spec.md',
          lastSyncedVersionId: 'card-1-v1',
          lastSyncedFileDigest: 'fnv1a:test',
          lastSyncedAt: NOW,
        },
      })],
    }))

    expect(normalized.cards[0]).not.toHaveProperty('fileBinding')
  })

  it('keeps portable domain modules independent from WorkflowStore', async () => {
    const modules = await Promise.all([
      readFile(new URL('../../bridge/domain/portable-format.js', import.meta.url), 'utf8'),
      readFile(new URL('../../bridge/domain/board-artifact.js', import.meta.url), 'utf8'),
    ])

    expect(modules.join('\n')).not.toContain('workflow-store')
  })

  it('keeps portable primitives independent from BoardCheckpoint validation', async () => {
    const portable = await readFile(
      new URL('../../bridge/domain/portable-format.js', import.meta.url),
      'utf8',
    )

    expect(portable).not.toContain("from './board-checkpoint.js'")
  })

  it.each([
    ['mira-board', BOARD_ARTIFACT_LIMITS.maxBytes, 'PAYLOAD_TOO_LARGE'],
    ['mira-backup', MIRA_BACKUP_LIMITS.maxBytes, 'BACKUP_TOO_LARGE'],
  ])('accepts the exact %s UTF-8 byte boundary and rejects one byte more', (format, limit, code) => {
    expect(() => assertPortableByteLength(format, limit)).not.toThrow()
    expect(() => assertPortableByteLength(format, limit + 1)).toThrowError(
      expect.objectContaining({ code, details: expect.objectContaining({ category: 'bytes' }) }),
    )
  })

  it('measures UTF-8 JSON bytes rather than JavaScript character count', () => {
    const value = { text: '你' }
    expect(utf8JsonByteLength(value)).toBe(new TextEncoder().encode(JSON.stringify(value)).length)
    expect(utf8JsonByteLength(value)).toBeGreaterThan(JSON.stringify(value).length)
  })

  it('no longer counts or limits relations', () => {
    const legacyBoard = {
      cards: [], transformations: [],
      relations: [{ id: 'r1' }, { id: 'r2' }],
    }
    const counts = countPortableBoards([legacyBoard])
    expect('relations' in counts).toBe(false)
    expect(BOARD_ARTIFACT_LIMITS).not.toHaveProperty('relations')
    expect(MIRA_BACKUP_LIMITS).not.toHaveProperty('relations')
  })

  it('omits legacy relations from normalized portable boards', () => {
    const normalized = normalizePortableBoard({
      id: 'board-1',
      title: '课题',
      cards: [],
      transformations: [],
      relations: [{ id: 'legacy-relation' }],
    })
    expect('relations' in normalized).toBe(false)
  })

  const artifactBoundaries = [
    ['boards', 1],
    ['cards', 10_000],
    ['versions', 100_000],
    ['transformations', 50_000],
    ['runs', 100_000],
    ['workflowProvenance', 1_000],
  ]

  it.each(artifactBoundaries)(
    'enforces the mira-board %s count without allocating the represented objects',
    (category, limit) => {
      expect(() => assertPortableObjectLimits('mira-board', { [category]: limit })).not.toThrow()
      expect(() => assertPortableObjectLimits('mira-board', { [category]: limit + 1 }))
        .toThrowError(expect.objectContaining({
          code: 'PAYLOAD_TOO_LARGE',
          details: expect.objectContaining({ category }),
        }))
    },
  )

  const backupBoundaries = [
    ['boards', 1_000],
    ['cards', 100_000],
    ['versions', 1_000_000],
    ['transformations', 500_000],
    ['runs', 1_000_000],
    ['workflows', 10_000],
  ]

  it.each(backupBoundaries)(
    'enforces the mira-backup %s count without allocating the represented objects',
    (category, limit) => {
      expect(() => assertPortableObjectLimits('mira-backup', { [category]: limit })).not.toThrow()
      expect(() => assertPortableObjectLimits('mira-backup', { [category]: limit + 1 }))
        .toThrowError(expect.objectContaining({
          code: 'BACKUP_TOO_LARGE',
          details: expect.objectContaining({ category }),
        }))
    },
  )
})

describe('workspace-relative file paths', () => {
  it.each([
    'notes/brief.md',
    'brief.md',
    '资料/访谈.md',
  ])('accepts a normalized workspace-relative path: %s', (path) => {
    expect(validateWorkspaceRelativePath(path)).toBe(path)
  })

  it.each([
    '',
    '/etc/passwd',
    '../outside.md',
    'notes/../../outside.md',
    'notes/../brief.md',
    './brief.md',
    'notes//brief.md',
    'C:/Users/name/secret.txt',
    'C:Users/name/secret.txt',
    String.raw`C:\Users\name\secret.txt`,
    String.raw`notes\brief.md`,
    `notes/${String.fromCharCode(0)}secret.md`,
  ])('rejects an unsafe or ambiguous path: %j', (path) => {
    expect(() => validateWorkspaceRelativePath(path)).toThrowError(
      expect.objectContaining({ code: 'PORTABLE_PATH_INVALID' }),
    )
  })
})

describe('MiraBackup validation and projection', () => {
  it.each([
    ['wrong format', { format: 'mira-board' }],
    ['unknown version', { formatVersion: 3 }],
    ['missing timestamp', { exportedAt: '' }],
    ['boards not an array', { boards: {} }],
    ['runs not an array', { runs: {} }],
    ['workflows not an array', { workflows: {} }],
  ])('strictly rejects an envelope with %s', (_label, change) => {
    expect(() => validateWorkspaceBackup(backup(change))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_INVALID' }),
    )
  })

  it('accepts MiraBackup V1 as a backup with zero checkpoints', () => {
    expect(() => validateWorkspaceBackup(backup())).not.toThrow()
  })

  it('projects MiraBackup V2 with every checkpoint', () => {
    const boardValue = board('board-1', { runtime: { harmless: 'kept' } })
    const checkpoints = [checkpoint('checkpoint-1', boardValue), checkpoint('checkpoint-2', boardValue)]

    const projected = projectWorkspaceBackup({
      boards: [boardValue],
      runs: [run()],
      workflows: [workflow()],
      checkpoints,
      exportedAt: NOW,
    })

    expect(projected).toMatchObject({
      format: 'mira-backup',
      formatVersion: 2,
      checkpoints: [
        { id: 'checkpoint-1', boardId: 'board-1' },
        { id: 'checkpoint-2', boardId: 'board-1' },
      ],
    })
    expect(() => validateWorkspaceBackup(projected)).not.toThrow()
  })

  it.each([
    ['missing checkpoints', { formatVersion: 2 }],
    ['duplicate checkpoint ID', {
      formatVersion: 2,
      checkpoints: [checkpoint(), checkpoint()],
    }],
    ['checkpoint without a packaged Board', {
      formatVersion: 2,
      checkpoints: [checkpoint('checkpoint-other', board('board-other'))],
    }],
    ['checkpoint whose artifact revision differs from its baseline', {
      formatVersion: 2,
      checkpoints: [checkpoint('checkpoint-1', board('board-1'), { baseBoardRevision: 6 })],
    }],
  ])('strictly rejects MiraBackup V2 with %s', (_label, change) => {
    expect(() => validateWorkspaceBackup(backup(change))).toThrowError(
      expect.objectContaining({ code: 'BACKUP_INVALID' }),
    )
  })

  it('rejects more than twenty checkpoints for one Board', () => {
    const boardValue = board('board-1', { runtime: { harmless: 'kept' } })
    const checkpoints = Array.from(
      { length: 21 },
      (_, index) => checkpoint(`checkpoint-${index + 1}`, boardValue),
    )

    expect(() => validateWorkspaceBackup(backup({ formatVersion: 2, checkpoints })))
      .toThrowError(expect.objectContaining({
        code: 'BACKUP_TOO_LARGE',
        details: expect.objectContaining({ category: 'checkpoints' }),
      }))
  })

  it('maps non-JSON backup members to BACKUP_INVALID', () => {
    const input = backup()
    input.unsupportedInteger = 1n

    expect(() => validateWorkspaceBackup(input)).toThrowError(
      expect.objectContaining({ code: 'BACKUP_INVALID' }),
    )
  })

  it('preserves managed IDs, revision, lifecycle and healthy runtime metadata', () => {
    const projected = projectWorkspaceBackup({
      boards: [board()],
      runs: [run()],
      workflows: [workflow()],
      exportedAt: NOW,
    })

    expect(projected).toMatchObject({
      format: 'mira-backup',
      formatVersion: 2,
      exportedAt: NOW,
      boards: [{
        id: 'board-1',
        revision: 7,
        lifecycle: { state: 'archived', archivedAt: NOW },
        runtime: { harmless: 'kept' },
      }],
      runs: [{ id: 'run-1', boardId: 'board-1' }],
      workflows: [{ id: 'workflow-1' }],
      checkpoints: [],
    })
    expect(() => validateWorkspaceBackup(projected)).not.toThrow()
  })

  it('preserves validated public Run progress events and accepts legacy mirrors', () => {
    const progressEvents = [{
      sequence: 1,
      phase: 'failed',
      label: '生成未完成',
      occurredAt: NOW,
    }]
    const projected = projectWorkspaceBackup({
      boards: [board()],
      runs: [run('run-1', 'board-1', {
        progress: { phase: 'failed', label: '生成未完成', updatedAt: NOW },
        progressEvents,
      })],
      workflows: [workflow()],
      exportedAt: NOW,
    })

    expect(projected.runs[0].progressEvents).toEqual(progressEvents)
    expect(() => validateWorkspaceBackup(projected)).not.toThrow()
    expect(() => validateWorkspaceBackup(backup({
      runs: [run('legacy', 'board-1', {
        progress: { phase: 'failed', label: '生成未完成', updatedAt: NOW },
      })],
    }))).not.toThrow()
  })

  it('rejects a terminal portable Run whose latest event is not its fixed terminal state', () => {
    expect(() => validateWorkspaceBackup(backup({
      runs: [run('run-1', 'board-1', {
        progress: { phase: 'generating', label: '仍在生成', updatedAt: NOW },
        progressEvents: [{
          sequence: 1,
          phase: 'generating',
          label: '仍在生成',
          occurredAt: NOW,
        }],
      })],
    }))).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('rejects detail text on a portable fixed terminal progress event', () => {
    expect(() => validateWorkspaceBackup(backup({
      runs: [run('run-1', 'board-1', {
        progress: {
          phase: 'failed',
          label: '生成未完成',
          detail: 'private diagnostic',
          updatedAt: NOW,
        },
        progressEvents: [{
          sequence: 1,
          phase: 'failed',
          label: '生成未完成',
          detail: 'private diagnostic',
          occurredAt: NOW,
        }],
      })],
    }))).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it.each([
    ['more than twenty events', {
      progressEvents: Array.from({ length: 21 }, (_, index) => ({
        sequence: index + 1,
        phase: 'failed',
        label: '生成未完成',
        occurredAt: NOW,
      })),
    }],
    ['non-increasing sequences', {
      progressEvents: [
        { sequence: 3, phase: 'failed', label: '生成未完成', occurredAt: NOW },
        { sequence: 2, phase: 'failed', label: '生成未完成', occurredAt: NOW },
      ],
    }],
    ['an unknown event field', {
      progressEvents: [{
        sequence: 1,
        phase: 'failed',
        label: '生成未完成',
        occurredAt: NOW,
        reasoning: 'private',
      }],
    }],
    ['an over-length event field', {
      progress: { phase: 'failed', label: 'l'.repeat(161), updatedAt: NOW },
      progressEvents: [{
        sequence: 1,
        phase: 'failed',
        label: 'l'.repeat(161),
        occurredAt: NOW,
      }],
    }],
    ['a progress mirror with an unknown field', {
      progress: {
        phase: 'failed',
        label: '生成未完成',
        updatedAt: NOW,
        rawEvent: { apiKey: 'private' },
      },
      progressEvents: [{
        sequence: 1,
        phase: 'failed',
        label: '生成未完成',
        occurredAt: NOW,
      }],
    }],
    ['a latest event inconsistent with progress', {
      progressEvents: [{
        sequence: 1,
        phase: 'completed',
        label: '生成完成',
        occurredAt: NOW,
      }],
    }],
  ])('rejects portable Run progress history with %s', (_case, change) => {
    expect(() => validateWorkspaceBackup(backup({
      runs: [run('run-1', 'board-1', {
        progress: { phase: 'failed', label: '生成未完成', updatedAt: NOW },
        ...change,
      })],
    }))).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('normalizes legacy Board metadata without changing its identity', () => {
    const legacy = board('board-legacy')
    delete legacy.revision
    delete legacy.lifecycle

    const projected = projectWorkspaceBackup({
      boards: [legacy],
      runs: [],
      workflows: [],
      exportedAt: NOW,
    })

    expect(projected.boards[0]).toMatchObject({
      id: 'board-legacy',
      revision: 0,
      lifecycle: { state: 'active' },
    })
  })

  it('removes runtime sessions, secret properties and file-reference bodies without reading files', () => {
    const fileVersion = version(
      'file-v1',
      'file-card',
      {
        kind: 'file-reference',
        path: 'notes/source.md',
        readonly: true,
        body: 'must-not-leak',
      },
    )
    const fileCard = card('file-card', {
      contentKind: 'file-reference',
      headVersionId: fileVersion.id,
      versions: [fileVersion],
    })
    const input = board('board-1', {
      apiKey: 'top-level-secret',
      runtime: { rootSessionId: 'session-secret', accessToken: 'token-secret', harmless: 'kept' },
      cards: [fileCard],
    })
    const fileRun = run('run-file', 'board-1', {
      sourceSnapshot: [{
        cardId: 'file-card',
        versionId: 'file-v1',
        contentKind: 'file-reference',
        resolvedContent: 'actual file body',
        digest: 'digest:file',
      }],
    })

    const projected = projectWorkspaceBackup({
      boards: [input],
      runs: [fileRun],
      workflows: [],
      exportedAt: NOW,
    })
    const serialized = JSON.stringify(projected)

    expect(serialized).not.toContain('session-secret')
    expect(serialized).not.toContain('token-secret')
    expect(serialized).not.toContain('top-level-secret')
    expect(serialized).not.toContain('must-not-leak')
    expect(serialized).not.toContain('actual file body')
    expect(projected.boards[0].runtime).toEqual({ harmless: 'kept' })
    expect(projected.runs[0].sourceSnapshot[0]).not.toHaveProperty('resolvedContent')
  })

  it('maps projection-time serialization failures to BACKUP_INVALID', () => {
    const cyclicBoard = board()
    cyclicBoard.cycle = cyclicBoard

    expect(() => projectWorkspaceBackup({
      boards: [cyclicBoard],
      runs: [run()],
      workflows: [workflow()],
      exportedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it.each(['queued', 'running'])('rejects an active %s Run', (status) => {
    expect(() => validateWorkspaceBackup(backup({ runs: [run('run-active', 'board-1', { status })] })))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('accepts a terminal pending Candidate owned by its matching Transformation lastRunId', () => {
    const { currentBoard, pending } = pendingCandidateClosure()

    expect(() => validateWorkspaceBackup(backup({
      boards: [currentBoard],
      runs: [pending],
    }))).not.toThrow()
  })

  it('rejects a detached terminal pending Candidate that would lose its UI owner after restore', () => {
    const { currentBoard, pending } = pendingCandidateClosure()
    delete currentBoard.transformations[0].lastRunId

    expect(() => validateWorkspaceBackup(backup({
      boards: [currentBoard],
      runs: [pending],
    }))).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('rejects a dangling reference in a Run used by current Board structure', () => {
    const source = card('source')
    const target = card('target')
    const currentBoard = board('board-1', {
      runtime: { harmless: 'kept' },
      cards: [source, target],
      transformations: [{
        id: 'transformation-current',
        sourceCardIds: ['source'],
        targetCardId: 'target',
        label: '形成结论',
        instruction: '整理来源',
        acceptance: '',
        permissions: { workspaceWrite: false },
        lastRunId: 'run-current',
        lastAppliedRunId: 'run-current',
        createdAt: NOW,
        updatedAt: NOW,
      }],
    })
    const currentRun = run('run-current', 'board-1', {
      transformationId: 'transformation-current',
      status: 'succeeded',
      sourceSnapshot: [{
        cardId: 'source',
        versionId: 'missing-current-version',
        contentKind: 'markdown',
        resolvedContent: '# 内容',
        digest: 'digest:source',
      }],
      targetCardId: 'target',
      result: {
        output: '# 结果',
        digest: 'digest:result',
        disposition: 'applied',
        appliedVersionId: 'target-v1',
      },
      error: undefined,
    })

    expect(() => validateWorkspaceBackup(backup({
      boards: [currentBoard],
      runs: [currentRun],
    }))).toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('rejects duplicate primary IDs and a Run that belongs to no packaged Board', () => {
    expect(() => validateWorkspaceBackup(backup({ boards: [board(), board()] })))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
    expect(() => validateWorkspaceBackup(backup({ runs: [run('run-1'), run('run-1')] })))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
    expect(() => validateWorkspaceBackup(backup({ workflows: [workflow(), workflow()] })))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
    expect(() => validateWorkspaceBackup(backup({ runs: [run('run-other', 'missing-board')] })))
      .toThrowError(expect.objectContaining({ code: 'BACKUP_INVALID' }))
  })

  it('uses a supplied pre-parse byte count for the 256 MiB restore boundary', () => {
    expect(() => validateWorkspaceBackup(backup(), {
      byteLength: MIRA_BACKUP_LIMITS.maxBytes + 1,
    })).toThrowError(expect.objectContaining({ code: 'BACKUP_TOO_LARGE' }))
  })
})
