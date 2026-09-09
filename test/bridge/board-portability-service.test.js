import { describe, expect, it, vi } from 'vitest'
import { createBoardPortabilityService } from '../../bridge/board-portability-service.js'
import { projectBoardArtifact, validateBoardArtifact } from '../../bridge/domain/board-artifact.js'
import { BOARD_ARTIFACT_LIMITS } from '../../bridge/domain/portable-format.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { emptyBoardV2 } from '../../bridge/v2-board-store.js'
import { V2BoardStore } from '../../bridge/v2-board-store.js'
import { createV2Handlers } from '../../bridge/v2-http.js'
import { createV2RunStore } from '../../bridge/v2-run-store.js'

const NOW = '2026-09-02T08:00:00.000Z'
const IMPORTED_AT = '2026-09-02T09:00:00.000Z'

function memoryFs() {
  const files = new Map()
  return {
    async readText(path) {
      if (!files.has(path)) throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      if (!files.has(from)) throw Object.assign(new Error(`missing: ${from}`), { code: 'ENOENT' })
      files.set(to, files.get(from))
      files.delete(from)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function card(id, markdown, x) {
  const versionId = `${id}-v1`
  return {
    id,
    contentKind: 'markdown',
    x,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `digest:${versionId}`,
      origin: 'human',
      createdAt: NOW,
    }],
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function board(overrides = {}) {
  const value = emptyBoardV2('board-1', '研究课题', NOW)
  value.cards = [card('source', '# 来源', 0), card('target', '# 结果', 420)]
  value.transformations = [{
    id: 'transformation-1',
    sourceCardIds: ['source'],
    targetCardId: 'target',
    label: '形成结论',
    instruction: '整理来源',
    acceptance: '',
    permissions: { workspaceWrite: false },
    workflowRef: {
      workflowId: 'workflow-1',
      stepId: 'workflow-step-1',
      applicationId: 'application-1',
    },
    createdAt: NOW,
    updatedAt: NOW,
  }]
  return Object.assign(value, overrides)
}

function workflow(overrides = {}) {
  return {
    id: 'workflow-1',
    title: '研究方法',
    description: '从来源形成结论',
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
      instruction: '整理来源',
      acceptance: '',
      sources: [{ kind: 'input', inputId: 'workflow-input-1' }],
    }],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function failedRun(overrides = {}) {
  return {
    id: 'run-1',
    boardId: 'board-1',
    transformationId: 'transformation-1',
    status: 'failed',
    sourceSnapshot: [{
      cardId: 'source',
      versionId: 'source-v1',
      contentKind: 'markdown',
      resolvedContent: '# 来源',
      digest: 'digest:source-v1',
    }],
    targetCardId: 'target',
    targetBaseVersionId: 'target-v1',
    intent: 'update',
    error: { code: 'MODEL_FAILED', message: 'failed', retryable: true },
    createdAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function artifact(overrides = {}) {
  const source = emptyBoardV2('artifact-board', '可导入课题', NOW)
  return projectBoardArtifact({
    board: source,
    runs: [],
    exportedAt: NOW,
    ...overrides,
  })
}

function createService(overrides = {}) {
  const currentBoard = overrides.board || board()
  const boardStore = overrides.boardStore || {
    withLockedBoard: vi.fn(async (_boardId, operation) => operation(currentBoard, {})),
  }
  const runStore = overrides.runStore || { listStrict: vi.fn(async () => [failedRun()]) }
  const workflowStore = overrides.workflowStore || {
    load: vi.fn(async () => workflow()),
  }
  const committer = overrides.committer || {
    commit: vi.fn(async ({ board: importedBoard, runs }) => ({
      boardId: importedBoard.id,
      runIds: runs.map(({ id }) => id),
    })),
  }
  let nextId = 0
  const newId = overrides.newId || ((kind) => `${kind}-new-${++nextId}`)
  return {
    boardStore,
    runStore,
    workflowStore,
    committer,
    service: createBoardPortabilityService({
      boardStore,
      runStore,
      workflowStore,
      committer,
      newId,
      now: () => IMPORTED_AT,
      ...(overrides.measureJsonByteLength
        ? { measureJsonByteLength: overrides.measureJsonByteLength }
        : {}),
    }),
  }
}

describe('Board export', () => {
  it('reads the Board and all owned Runs inside its lifecycle lock', async () => {
    const context = createService()

    const exported = await context.service.exportBoard('board-1')

    expect(context.boardStore.withLockedBoard).toHaveBeenCalledWith(
      'board-1',
      expect.any(Function),
    )
    expect(context.runStore.listStrict).toHaveBeenCalledOnce()
    expect(exported.runs).toEqual([failedRun()])
    expect(() => validateBoardArtifact(exported)).not.toThrow()
  })

  it('exports only referenced, currently existing workflows as non-installing provenance', async () => {
    const method = workflow({
      runtime: { rootSessionId: 'must-not-leak' },
      apiKey: 'must-not-leak',
    })
    const context = createService({ workflowStore: { load: vi.fn(async () => method) } })

    const exported = await context.service.exportBoard('board-1')

    expect(exported.workflowProvenance).toEqual([{
      workflowId: 'workflow-1',
      title: method.title,
      description: method.description,
      inputs: method.inputs,
      steps: method.steps,
    }])
    expect(JSON.stringify(exported.workflowProvenance)).not.toContain('createdAt')
    expect(JSON.stringify(exported.workflowProvenance)).not.toContain('rootSessionId')
    expect(JSON.stringify(exported.workflowProvenance)).not.toContain('apiKey')
  })

  it('records a missing referenced workflow as an external reference', async () => {
    const missing = Object.assign(new Error('missing'), { code: 'WORKFLOW_NOT_FOUND' })
    const context = createService({ workflowStore: { load: vi.fn(async () => { throw missing }) } })

    const exported = await context.service.exportBoard('board-1')

    expect(exported.workflowProvenance).toEqual([])
    expect(exported.externalReferences).toContainEqual({
      kind: 'workflow', workflowId: 'workflow-1', stepId: 'workflow-step-1',
    })
  })

  it('fails closed when a referenced workflow cannot be read', async () => {
    const failure = Object.assign(new Error('disk failed'), { code: 'WORKFLOW_READ_FAILED' })
    const context = createService({ workflowStore: { load: vi.fn(async () => { throw failure }) } })

    await expect(context.service.exportBoard('board-1')).rejects.toBe(failure)
  })

  it.each(['queued', 'running'])('rejects export while an owned Run is %s', async (status) => {
    const runStore = { listStrict: vi.fn(async () => [failedRun({ status })]) }
    const context = createService({ runStore })

    await expect(context.service.exportBoard('board-1')).rejects.toMatchObject({
      code: 'EXPORT_BUSY',
    })
  })

  it('ignores terminal Runs owned by other Boards', async () => {
    const runStore = {
      listStrict: vi.fn(async () => [failedRun(), failedRun({ id: 'other-run', boardId: 'other' })]),
    }
    const context = createService({ runStore })

    await expect(context.service.exportBoard('board-1')).resolves.toMatchObject({
      runs: [{ id: 'run-1' }],
    })
  })

  it('accepts the exact HTTP import envelope byte boundary', async () => {
    const measureJsonByteLength = vi.fn(() => BOARD_ARTIFACT_LIMITS.maxBytes)
    const context = createService({ measureJsonByteLength })

    const exported = await context.service.exportBoard('board-1')

    expect(measureJsonByteLength).toHaveBeenCalledWith({ artifact: exported })
  })

  it('rejects export when the artifact fits but its HTTP import envelope exceeds 64 MiB', async () => {
    const measureJsonByteLength = vi.fn(({ artifact: projected }) => {
      expect(() => validateBoardArtifact(projected, { operation: 'export' })).not.toThrow()
      return BOARD_ARTIFACT_LIMITS.maxBytes + 1
    })
    const context = createService({ measureJsonByteLength })

    await expect(context.service.exportBoard('board-1')).rejects.toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: expect.objectContaining({ category: 'bytes' }),
    })
    expect(measureJsonByteLength).toHaveBeenCalledOnce()
  })

  it('serializes export with Run start on the shared Board lock', async () => {
    const fs = memoryFs()
    const coordinator = createStorageCoordinator()
    const boardStore = new V2BoardStore(fs, 'boards-v2', { coordinator })
    const runStore = createV2RunStore(fs, 'runs-v2', { coordinator })
    await boardStore.save('board-1', board())
    const listEntered = deferred()
    const releaseList = deferred()
    const originalListStrict = runStore.listStrict.bind(runStore)
    vi.spyOn(runStore, 'listStrict').mockImplementationOnce(async () => {
      listEntered.resolve()
      await releaseList.promise
      return originalListStrict()
    })
    const service = createBoardPortabilityService({
      boardStore,
      runStore,
      workflowStore: { load: vi.fn(async () => workflow()) },
      committer: { commit: vi.fn() },
      newId: (kind) => `${kind}-unused`,
      now: () => NOW,
    })
    const handlers = createV2Handlers({
      store: boardStore,
      runStore,
      newId: () => 'run-started',
      now: () => NOW,
      executeModel: () => new Promise(() => {}),
    })

    const exporting = service.exportBoard('board-1')
    await listEntered.promise
    const starting = handlers.startRun('board-1', 'transformation-1')
    releaseList.resolve()

    await expect(exporting).resolves.toMatchObject({ runs: [] })
    await expect(starting).resolves.toMatchObject({
      run: { id: 'run-started', status: 'running' },
    })
    await expect(boardStore.load('board-1')).resolves.toMatchObject({
      transformations: [{ lastRunId: 'run-started' }],
    })
  })
})

describe('Board import', () => {
  it('validates and remaps the full artifact before committing Board and Runs', async () => {
    const context = createService()
    const source = artifact()

    const result = await context.service.importBoard({ artifact: source })

    expect(context.committer.commit).toHaveBeenCalledOnce()
    const committed = context.committer.commit.mock.calls[0][0]
    expect(committed.board).toMatchObject({
      id: expect.not.stringMatching(/^artifact-board$/),
      revision: 0,
      lifecycle: { state: 'active' },
      createdAt: IMPORTED_AT,
    })
    expect(result).toEqual({
      boardId: committed.board.id,
      board: committed.board,
      imported: { runCount: 0, externalReferenceCount: 0 },
    })
  })

  it('imports the same artifact twice with disjoint identities', async () => {
    const context = createService()
    const source = artifact()

    const first = await context.service.importBoard({ artifact: source })
    const second = await context.service.importBoard({ artifact: source })

    expect(first.boardId).not.toBe(second.boardId)
    expect(context.committer.commit).toHaveBeenCalledTimes(2)
  })

  it('never reads or installs a WorkflowTemplate while importing provenance', async () => {
    const source = projectBoardArtifact({
      board: board(),
      runs: [failedRun()],
      workflowProvenance: [{
        workflowId: 'workflow-1',
        title: '研究方法',
        description: '从来源形成结论',
        inputs: workflow().inputs,
        steps: workflow().steps,
      }],
      exportedAt: NOW,
    })
    const workflowStore = { load: vi.fn(), save: vi.fn() }
    const context = createService({ workflowStore })

    await expect(context.service.importBoard({ artifact: source })).resolves.toMatchObject({
      imported: { runCount: 1 },
    })
    expect(workflowStore.load).not.toHaveBeenCalled()
    expect(workflowStore.save).not.toHaveBeenCalled()
  })

  it('rejects a malicious artifact before any persistence write', async () => {
    const source = artifact()
    source.formatVersion = 999
    const context = createService()

    await expect(context.service.importBoard({ artifact: source })).rejects.toMatchObject({
      code: 'BOARD_IMPORT_INVALID',
    })
    expect(context.committer.commit).not.toHaveBeenCalled()
  })

  it('rejects a detached pending Candidate before any persistence write', async () => {
    const source = projectBoardArtifact({
      board: board(),
      runs: [failedRun()],
      workflowProvenance: [{
        workflowId: 'workflow-1',
        title: '研究方法',
        description: '从来源形成结论',
        inputs: workflow().inputs,
        steps: workflow().steps,
      }],
      exportedAt: NOW,
    })
    source.runs[0].status = 'succeeded'
    source.runs[0].result = {
      output: '# 待比较',
      digest: 'digest:candidate',
      disposition: 'candidate',
    }
    delete source.runs[0].error
    const context = createService()

    await expect(context.service.importBoard({ artifact: source })).rejects.toMatchObject({
      code: 'BOARD_IMPORT_INVALID',
    })
    expect(context.committer.commit).not.toHaveBeenCalled()
  })
})
