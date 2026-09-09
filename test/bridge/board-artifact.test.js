import { describe, expect, it, vi } from 'vitest'
import {
  projectBoardArtifact,
  remapBoardArtifact,
  validateBoardArtifact,
} from '../../bridge/domain/board-artifact.js'
import { BOARD_ARTIFACT_LIMITS } from '../../bridge/domain/portable-format.js'

const NOW = '2026-09-02T08:00:00.000Z'
const IMPORTED_AT = '2026-09-02T09:00:00.000Z'

function version(id, cardId, content, overrides = {}) {
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

function card(id, content, overrides = {}) {
  const head = version(`${id}-v1`, id, content)
  return {
    id,
    contentKind: content.kind,
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

function sourceCard() {
  return card('source', { kind: 'markdown', markdown: '# 来源' }, {
    inspirationRef: {
      boardId: 'external-board',
      cardId: 'external-card',
      versionId: 'external-version',
    },
  })
}

function targetCard() {
  const first = version('target-v1', 'target', { kind: 'markdown', markdown: '# 结果' }, {
    origin: 'ai',
    sourceRunId: 'run-1',
  })
  const restored = {
    ...version('target-v2', 'target', { kind: 'markdown', markdown: '# 恢复结果' }, {
      origin: 'restore',
      restoredFromVersionId: 'deleted-version',
    }),
    sequence: 2,
  }
  return card('target', { kind: 'markdown', markdown: '# ignored' }, {
    headVersionId: restored.id,
    versions: [first, restored],
  })
}

function fileCard(path = 'notes/source.md') {
  const first = version(
    'file-v1',
    'file-card',
    { kind: 'file-reference', path, readonly: true, body: 'must-not-export' },
  )
  const second = {
    ...version(
      'file-v2',
      'file-card',
      { kind: 'file-reference', path, readonly: true, contents: 'must-not-export-either' },
    ),
    sequence: 2,
  }
  return card('file-card', { kind: 'file-reference', path, readonly: true }, {
    headVersionId: second.id,
    versions: [first, second],
  })
}

function board(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '研究课题',
    revision: 9,
    lifecycle: { state: 'archived', archivedAt: NOW },
    cards: [sourceCard(), targetCard(), fileCard()],
    transformations: [{
      id: 'transformation-1',
      sourceCardIds: ['source', 'file-card'],
      targetCardId: 'target',
      label: '形成结论',
      instruction: '整理来源形成结论',
      acceptance: '',
      permissions: { workspaceWrite: false },
      planRef: {
        planId: 'application-1',
        source: 'template',
        title: '研究方法',
        stepIndex: 1,
        stepTotal: 1,
      },
      workflowRef: {
        workflowId: 'workflow-1',
        stepId: 'workflow-step-1',
        applicationId: 'application-1',
      },
      lastRunId: 'run-1',
      lastAppliedRunId: 'run-1',
      createdAt: NOW,
      updatedAt: NOW,
    }],
    viewport: { x: 0, y: 0, zoom: 1 },
    runtime: { rootSessionId: 'runtime-secret', harmless: 'kept' },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function terminalRun(overrides = {}) {
  return {
    id: 'run-1',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    status: 'succeeded',
    sourceSnapshot: [
      {
        cardId: 'source',
        versionId: 'source-v1',
        contentKind: 'markdown',
        resolvedContent: '# 来源',
        digest: 'digest:source-v1',
      },
      {
        cardId: 'file-card',
        versionId: 'file-v2',
        contentKind: 'file-reference',
        resolvedContent: 'actual workspace file body',
        digest: 'digest:file-v2',
      },
    ],
    targetCardId: 'target',
    targetBaseVersionId: null,
    intent: 'update',
    modelSnapshot: { provider: 'test', model: 'test-model' },
    result: {
      output: '# 结果',
      digest: 'digest:result',
      disposition: 'applied',
      appliedVersionId: 'target-v1',
    },
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function historicalRun(overrides = {}) {
  return terminalRun({
    id: 'run-historical',
    transformationId: 'deleted-transformation',
    sourceSnapshot: [{
      cardId: 'deleted-source-card',
      versionId: 'deleted-source-version',
      contentKind: 'markdown',
      resolvedContent: '# 历史来源',
      digest: 'digest:historical-source',
    }],
    targetCardId: 'deleted-target-card',
    targetBaseVersionId: 'deleted-target-base-version',
    result: {
      output: '# 历史结果',
      digest: 'digest:historical-result',
      disposition: 'applied',
      appliedVersionId: 'deleted-applied-version',
    },
    ...overrides,
  })
}

function provenance(overrides = {}) {
  return {
    workflowId: 'workflow-1',
    title: '研究方法',
    description: '从材料形成结论',
    inputs: [{
      id: 'workflow-input-1',
      name: '材料',
      description: '',
      required: true,
      cardinality: 'many',
    }],
    steps: [{
      id: 'workflow-step-1',
      label: '形成结论',
      instruction: '整理来源形成结论',
      acceptance: '',
      sources: [{ kind: 'input', inputId: 'workflow-input-1' }],
    }],
    ...overrides,
  }
}

function artifact(overrides = {}) {
  return projectBoardArtifact({
    board: board(),
    runs: [terminalRun(), historicalRun()],
    workflowProvenance: [provenance()],
    exportedAt: NOW,
    ...overrides,
  })
}

function sequenceIds(prefix) {
  let index = 0
  return () => `${prefix}-${++index}`
}

describe('BoardArtifact export projection', () => {
  it('preserves independent names when exporting and remapping identities', () => {
    const source = board()
    source.cards[0].name = '独立名称'
    const exported = artifact({ board: source })
    expect(exported.board.cards[0].name).toBe('独立名称')
    const imported = remapBoardArtifact(exported, { generateId: sequenceIds('named'), now: () => IMPORTED_AT })
    expect(imported.board.cards[0].name).toBe('独立名称')
    expect(imported.board.cards[0].id).not.toBe(source.cards[0].id)
    exported.board.cards[0].name = '\n非法名称'
    expect(() => validateBoardArtifact(exported)).toThrow()
  })

  it('creates a versioned immediately importable envelope with dependencies and no file bodies', () => {
    const projected = artifact()

    expect(projected).toMatchObject({
      format: 'mira-board',
      formatVersion: 1,
      exportedAt: NOW,
      board: {
        id: 'board-1',
        revision: 9,
        lifecycle: { state: 'archived', archivedAt: NOW },
        runtime: { harmless: 'kept' },
      },
      fileDependencies: [{ path: 'notes/source.md', occurrenceCount: 2 }],
      workflowProvenance: [{ workflowId: 'workflow-1' }],
    })
    expect(projected.externalReferences).toEqual(expect.arrayContaining([
      {
        kind: 'inspiration',
        boardId: 'external-board',
        cardId: 'external-card',
        versionId: 'external-version',
      },
      { kind: 'historical', objectKind: 'version', objectId: 'deleted-version' },
      { kind: 'historical', objectKind: 'version', objectId: 'deleted-target-base-version' },
    ]))
    const serialized = JSON.stringify(projected)
    expect(serialized).not.toContain('runtime-secret')
    expect(serialized).not.toContain('must-not-export')
    expect(serialized).not.toContain('actual workspace file body')
    expect(projected.runs[0].sourceSnapshot[1]).not.toHaveProperty('resolvedContent')
    expect(() => validateBoardArtifact(projected)).not.toThrow()
  })

  it.each([
    '/etc/passwd',
    '../outside.md',
    'notes/../outside.md',
    String.raw`notes\source.md`,
    'C:/Users/name/source.md',
    `notes/${String.fromCharCode(0)}source.md`,
  ])('fails export on a dangerous historical file path: %j', (path) => {
    const unsafeBoard = board({ cards: [sourceCard(), targetCard(), fileCard(path)] })

    expect(() => projectBoardArtifact({
      board: unsafeBoard,
      runs: [terminalRun()],
      workflowProvenance: [provenance()],
      exportedAt: NOW,
    })).toThrowError(expect.objectContaining({
      code: 'BOARD_EXPORT_INVALID',
      details: expect.objectContaining({
        affected: expect.arrayContaining([{ cardId: 'file-card', versionId: 'file-v1', path }]),
      }),
    }))
  })

  it('fails export when a current Transformation Run reference is not packaged', () => {
    expect(() => projectBoardArtifact({
      board: board(),
      runs: [],
      workflowProvenance: [provenance()],
      exportedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: 'BOARD_EXPORT_INVALID' }))
  })

  it('maps malformed projection input to BOARD_EXPORT_INVALID', () => {
    expect(() => projectBoardArtifact({
      board: board({ cards: {} }),
      runs: [terminalRun()],
      workflowProvenance: [provenance()],
      exportedAt: NOW,
    })).toThrowError(expect.objectContaining({ code: 'BOARD_EXPORT_INVALID' }))
  })

  it('rejects an export that exceeds the importer byte limit before returning an artifact', () => {
    expect(() => validateBoardArtifact(artifact(), {
      operation: 'export',
      byteLength: BOARD_ARTIFACT_LIMITS.maxBytes + 1,
    })).toThrowError(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }))
  })
})

describe('BoardArtifact validation', () => {
  it.each([
    ['wrong format', { format: 'mira-backup' }],
    ['unknown version', { formatVersion: 2 }],
    ['missing timestamp', { exportedAt: '' }],
    ['missing Board object', { board: null }],
    ['runs not an array', { runs: {} }],
    ['provenance not an array', { workflowProvenance: {} }],
    ['dependencies not an array', { fileDependencies: {} }],
    ['external references not an array', { externalReferences: {} }],
  ])('rejects an envelope with %s', (_label, change) => {
    const input = { ...artifact(), ...change }
    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it.each(['cards', 'transformations'])(
    'returns BOARD_IMPORT_INVALID when Board %s is not an array',
    (field) => {
      const input = artifact()
      input.board[field] = {}

      expect(() => validateBoardArtifact(input)).toThrowError(
        expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
      )
    },
  )

  it('maps non-JSON artifact members to BOARD_IMPORT_INVALID', () => {
    const input = artifact()
    input.unsupportedInteger = 1n

    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it.each(['queued', 'running'])('rejects a non-terminal %s Run', (status) => {
    const input = artifact()
    input.runs[0].status = status
    delete input.runs[0].result
    delete input.runs[0].finishedAt

    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it('exports, validates, and remaps a terminal pending Candidate with a current owner', () => {
    const candidateBoard = board()
    candidateBoard.transformations[0].lastRunId = 'run-candidate'
    const candidateRun = terminalRun({
      id: 'run-candidate',
      targetBaseVersionId: 'target-v1',
      result: {
        output: '# 待比较',
        digest: 'digest:candidate',
        disposition: 'candidate',
      },
    })
    const input = projectBoardArtifact({
      board: candidateBoard,
      runs: [terminalRun(), candidateRun, historicalRun()],
      workflowProvenance: [provenance()],
      exportedAt: NOW,
    })

    expect(() => validateBoardArtifact(input)).not.toThrow()
    const remapped = remapBoardArtifact(input, {
      generateId: sequenceIds('candidate-fresh'),
      now: () => IMPORTED_AT,
    })
    const remappedCandidate = remapped.runs.find(
      (run) => run.result?.disposition === 'candidate',
    )
    expect(remapped.board.transformations[0].lastRunId).toBe(remappedCandidate.id)
    expect(remapped.board.transformations[0].lastAppliedRunId).not.toBe(remappedCandidate.id)
  })

  it('rejects a detached historical Run changed to Candidate before generating fresh identities', () => {
    const input = artifact()
    const historical = input.runs.find((run) => run.id === 'run-historical')
    historical.result.disposition = 'candidate'
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it('rejects dependency summaries that do not exactly match all historical file Versions', () => {
    const input = artifact()
    input.fileDependencies[0].occurrenceCount = 1

    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it.each([
    ['a duplicate path', (input) => input.fileDependencies.push({ ...input.fileDependencies[0] })],
    ['an omitted path', (input) => { input.fileDependencies = [] }],
    ['an unreported extra path', (input) => input.fileDependencies.push({
      path: 'notes/not-used.md', occurrenceCount: 1,
    })],
    ['an imprecise occurrence count', (input) => { input.fileDependencies[0].occurrenceCount += 1 }],
  ])('rejects fileDependencies with %s before fresh IDs are generated', (_label, corrupt) => {
    const input = artifact()
    corrupt(input)
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it('rejects undeclared package-external provenance', () => {
    const input = artifact()
    input.externalReferences = []

    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it('rejects a workflow step reference missing from its non-installing provenance snapshot', () => {
    const input = artifact()
    input.workflowProvenance[0].steps[0].id = 'other-step'

    expect(() => validateBoardArtifact(input)).toThrowError(
      expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }),
    )
  })

  it('rejects an unrelated provenance snapshot not referenced by any current Transformation', () => {
    const input = artifact()
    input.workflowProvenance.push(provenance({
      workflowId: 'workflow-unrelated',
      inputs: [{
        ...input.workflowProvenance[0].inputs[0],
        id: 'workflow-unrelated-input',
      }],
      steps: [{
        ...input.workflowProvenance[0].steps[0],
        id: 'workflow-unrelated-step',
        sources: [{ kind: 'input', inputId: 'workflow-unrelated-input' }],
      }],
    }))
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it.each([
    ['duplicate workflow identities', (input) => {
      input.workflowProvenance.push(structuredClone(input.workflowProvenance[0]))
    }],
    ['duplicate input identities', (input) => {
      input.workflowProvenance[0].inputs.push(structuredClone(input.workflowProvenance[0].inputs[0]))
    }],
    ['duplicate step identities', (input) => {
      input.workflowProvenance[0].steps.push(structuredClone(input.workflowProvenance[0].steps[0]))
    }],
    ['an unclosed input source', (input) => {
      input.workflowProvenance[0].steps[0].sources[0].inputId = 'missing-input'
    }],
    ['secret-bearing workflow data', (input) => {
      input.workflowProvenance[0].credentials = { clientSecret: 'must-not-cross-portable-boundary' }
    }],
  ])('rejects provenance with %s before fresh IDs are generated', (_label, corrupt) => {
    const input = artifact()
    corrupt(input)
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })
})

describe('BoardArtifact fresh-ID remapping', () => {
  it.each([
    ['a dangling Transformation source', (input) => {
      input.board.transformations[0].sourceCardIds[0] = 'missing-card'
    }],
    ['a dangling Transformation target', (input) => {
      input.board.transformations[0].targetCardId = 'missing-card'
    }],
    ['a dangling current lastRunId', (input) => {
      input.board.transformations[0].lastRunId = 'missing-run'
    }],
    ['a dangling current lastAppliedRunId', (input) => {
      input.board.transformations[0].lastAppliedRunId = 'missing-run'
    }],
  ])('rejects current structure containing %s before generating identities', (_label, corrupt) => {
    const input = artifact()
    corrupt(input)
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it.each([
    ['a dangling current Run transformation', (input) => {
      input.runs[0].transformationId = 'missing-current-transformation'
      input.externalReferences.push({
        kind: 'historical', objectKind: 'transformation', objectId: 'missing-current-transformation',
      })
    }],
    ['a dangling current source snapshot Card', (input) => {
      input.runs[0].sourceSnapshot[0].cardId = 'missing-current-source-card'
      input.externalReferences.push({
        kind: 'historical', objectKind: 'card', objectId: 'missing-current-source-card',
      })
    }],
    ['a dangling current source snapshot Version', (input) => {
      input.runs[0].sourceSnapshot[0].versionId = 'missing-current-source-version'
      input.externalReferences.push({
        kind: 'historical', objectKind: 'version', objectId: 'missing-current-source-version',
      })
    }],
    ['a dangling current target Card', (input) => {
      input.runs[0].targetCardId = 'missing-current-target-card'
      input.externalReferences.push({
        kind: 'historical', objectKind: 'card', objectId: 'missing-current-target-card',
      })
    }],
    ['a dangling current applied Version', (input) => {
      input.runs[0].result.appliedVersionId = 'missing-current-applied-version'
      input.externalReferences.push({
        kind: 'historical', objectKind: 'version', objectId: 'missing-current-applied-version',
      })
    }],
  ])('rejects %s even when it is falsely declared historical', (_label, corrupt) => {
    const input = artifact()
    corrupt(input)
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it('remaps every owned and opaque identity while closing current structural references', () => {
    const original = artifact()
    const untouched = structuredClone(original)
    const remapped = remapBoardArtifact(original, {
      generateId: sequenceIds('fresh'),
      now: () => IMPORTED_AT,
    })

    expect(original).toEqual(untouched)
    expect(remapped.board).toMatchObject({
      lifecycle: { state: 'active' },
      revision: 0,
      createdAt: IMPORTED_AT,
      updatedAt: IMPORTED_AT,
    })
    expect(remapped.board.lifecycle).not.toHaveProperty('archivedAt')
    expect(remapped.board.id).not.toBe(original.board.id)

    const oldCards = new Set(original.board.cards.map(({ id }) => id))
    const newCards = new Set(remapped.board.cards.map(({ id }) => id))
    const oldVersions = new Set(original.board.cards.flatMap(({ versions }) => versions.map(({ id }) => id)))
    const newVersions = new Set(remapped.board.cards.flatMap(({ versions }) => versions.map(({ id }) => id)))
    expect([...newCards].some((id) => oldCards.has(id))).toBe(false)
    expect([...newVersions].some((id) => oldVersions.has(id))).toBe(false)

    const source = remapped.board.cards.find((item) => item.contentKind === 'markdown' && item.inspirationRef)
    const target = remapped.board.cards.find((item) => item.versions.length === 2)
    const file = remapped.board.cards.find((item) => item.contentKind === 'file-reference')
    const transformation = remapped.board.transformations[0]
    const run = remapped.runs[0]
    const workflow = remapped.workflowProvenance[0]

    expect('relations' in remapped.board).toBe(false)
    expect(transformation.sourceCardIds).toEqual([source.id, file.id])
    expect(transformation.targetCardId).toBe(target.id)
    expect(transformation.lastRunId).toBe(run.id)
    expect(transformation.lastAppliedRunId).toBe(run.id)
    expect(transformation.planRef.planId).toBe(transformation.workflowRef.applicationId)
    expect(transformation.planRef.planId).not.toBe('application-1')
    expect(transformation.workflowRef.workflowId).toBe(workflow.workflowId)
    expect(transformation.workflowRef.stepId).toBe(workflow.steps[0].id)
    expect(workflow.steps[0].sources[0].inputId).toBe(workflow.inputs[0].id)

    expect(run.boardId).toBe(remapped.board.id)
    expect(run.transformationId).toBe(transformation.id)
    expect(run.targetCardId).toBe(target.id)
    expect(run.sourceSnapshot.map(({ cardId }) => cardId)).toEqual([source.id, file.id])
    expect(run.sourceSnapshot.map(({ versionId }) => versionId)).toEqual([
      source.versions[0].id,
      file.versions[1].id,
    ])
    expect(run.result.appliedVersionId).toBe(target.versions[0].id)
    expect(target.versions[0].sourceRunId).toBe(run.id)
    expect(target.versions[1].restoredFromVersionId).not.toBe('deleted-version')
    expect(run.targetBaseVersionId).toBe(null)
    expect(source.inspirationRef).not.toEqual(original.board.cards[0].inspirationRef)

    expect(remapped.externalReferences).toEqual(expect.arrayContaining([
      { kind: 'historical', objectKind: 'version', objectId: target.versions[1].restoredFromVersionId },
      { kind: 'inspiration', ...source.inspirationRef },
    ]))
    expect(() => validateBoardArtifact(remapped)).not.toThrow()
  })

  it('imports a legacy artifact carrying relations by silently dropping them', () => {
    const input = artifact()
    input.board.relations = [
      { id: 'fresh-1', fromCardId: 'source', toCardId: 'target', kind: 'reference' },
    ]

    const remapped = remapBoardArtifact(input, {
      generateId: sequenceIds('fresh'),
      now: () => IMPORTED_AT,
    })

    expect('relations' in remapped.board).toBe(false)
    expect(() => validateBoardArtifact(remapped)).not.toThrow()
  })

  it('retains a detached historical Run only through fresh opaque identities', () => {
    const remapped = remapBoardArtifact(artifact(), {
      generateId: sequenceIds('fresh'),
      now: () => IMPORTED_AT,
    })
    const historical = remapped.runs.find((item) => item.id !== remapped.board.transformations[0].lastRunId)

    expect(historical.transformationId).not.toBe('deleted-transformation')
    expect(historical.sourceSnapshot[0].cardId).not.toBe('deleted-source-card')
    expect(historical.sourceSnapshot[0].versionId).not.toBe('deleted-source-version')
    expect(historical.targetCardId).not.toBe('deleted-target-card')
    expect(historical.targetBaseVersionId).not.toBe('deleted-target-base-version')
    expect(historical.result.appliedVersionId).not.toBe('deleted-applied-version')
    expect(remapped.externalReferences).toEqual(expect.arrayContaining([
      { kind: 'historical', objectKind: 'transformation', objectId: historical.transformationId },
      { kind: 'historical', objectKind: 'card', objectId: historical.targetCardId },
      { kind: 'historical', objectKind: 'version', objectId: historical.result.appliedVersionId },
    ]))
  })

  it('produces disjoint identities when the same artifact is imported repeatedly', () => {
    const input = artifact()
    const generateId = sequenceIds('global-fresh')
    const first = remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT })
    const second = remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT })
    const collectIds = (value) => new Set([
      value.board.id,
      ...value.board.cards.map(({ id }) => id),
      ...value.board.cards.flatMap(({ versions }) => versions.map(({ id }) => id)),
      ...value.board.transformations.map(({ id }) => id),
      ...value.runs.map(({ id }) => id),
      ...value.workflowProvenance.map(({ workflowId }) => workflowId),
    ])
    const firstIds = collectIds(first)
    const secondIds = collectIds(second)

    expect([...firstIds].some((id) => secondIds.has(id))).toBe(false)
  })

  it.each([
    ['Card', (input) => input.board.cards.push(structuredClone(input.board.cards[0]))],
    ['Version', (input) => input.board.cards[1].versions[0].id = input.board.cards[0].versions[0].id],
    ['Transformation', (input) => input.board.transformations.push(structuredClone(input.board.transformations[0]))],
    ['Run', (input) => input.runs.push(structuredClone(input.runs[0]))],
    ['workflow provenance', (input) => input.workflowProvenance.push(structuredClone(input.workflowProvenance[0]))],
  ])('rejects a duplicate %s ID before generating any new identity', (_label, duplicate) => {
    const input = artifact()
    duplicate(input)
    const generateId = vi.fn(sequenceIds('must-not-run'))

    expect(() => remapBoardArtifact(input, { generateId, now: () => IMPORTED_AT }))
      .toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
    expect(generateId).not.toHaveBeenCalled()
  })

  it('rejects a generator that repeats a supposedly fresh identity', () => {
    expect(() => remapBoardArtifact(artifact(), {
      generateId: () => 'same-id',
      now: () => IMPORTED_AT,
    })).toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
  })

  it('rejects a generator that merely echoes every packaged identity', () => {
    expect(() => remapBoardArtifact(artifact(), {
      generateId: (_kind, oldId) => oldId,
      now: () => IMPORTED_AT,
    })).toThrowError(expect.objectContaining({ code: 'BOARD_IMPORT_INVALID' }))
  })
})
