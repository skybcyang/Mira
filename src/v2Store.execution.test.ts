import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-08-30T00:00:00.000Z'

function card(id: string, versionId: string | null): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: versionId,
    versions: versionId ? [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown: `# ${id}` },
      digest: `digest-${versionId}`,
      origin: 'human',
      createdAt: now,
    }] : [],
    createdAt: now,
    updatedAt: now,
  }
}

function transformation(
  id: string,
  sourceCardIds: string[],
  targetCardId: string,
  runId?: string,
): Transformation {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: id,
    instruction: id,
    acceptance: '',
    permissions: { workspaceWrite: false },
    ...(runId ? { lastRunId: runId, lastAppliedRunId: runId } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function appliedRun(
  id: string,
  transformationId: string,
  targetCardId: string,
  sourceCardId: string,
  sourceVersionId: string,
): TransformationRun {
  return {
    id,
    boardId: 'board-1',
    transformationId,
    targetCardId,
    sourceSnapshot: [{
      cardId: sourceCardId,
      versionId: sourceVersionId,
      contentKind: 'markdown',
      resolvedContent: `# ${sourceCardId}`,
      digest: `digest-${sourceVersionId}`,
    }],
    targetBaseVersionId: null,
    intent: 'update',
    modelSnapshot: { provider: 'test', model: 'test' },
    status: 'succeeded',
    result: { output: `# ${targetCardId}`, digest: targetCardId, disposition: 'applied' },
    createdAt: now,
  }
}

function queuedRun(id: string, transformationId: string, targetCardId: string): TransformationRun {
  return {
    id,
    boardId: 'board-1',
    transformationId,
    targetCardId,
    sourceSnapshot: [],
    targetBaseVersionId: null,
    intent: 'update',
    modelSnapshot: { provider: 'test', model: 'test' },
    status: 'queued',
    progress: { phase: 'queued', label: '等待', updatedAt: now },
    createdAt: now,
  }
}

function executionBoard(
  draftVersion = 'draft-v1',
  finalVersion: string | null = 'final-v1',
): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '顺序执行',
    cards: [card('raw', 'raw-v2'), card('draft', draftVersion), card('final', finalVersion)],
    transformations: [
      transformation('step-1', ['raw'], 'draft', 'old-run-1'),
      transformation('step-2', ['draft'], 'final', 'old-run-2'),
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

function reset(board: BoardV2, runs: Record<string, TransformationRun>) {
  useV2Canvas.setState({
    boardId: board.id,
    board,
    boards: [{ id: board.id, title: board.title }],
    ...projectV2Board(board, runs),
    runs,
    selectedCardIds: [],
    drawer: null,
    message: null,
    notices: [],
    runningToTransformationId: null,
    loadState: 'ready',
  })
}

async function runTo(transformationId: string) {
  const action = (useV2Canvas.getState() as unknown as {
    runToTransformation?: (id: string) => Promise<void>
  }).runToTransformation
  await action?.(transformationId)
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('run to transformation', () => {
  it('runs stale dependencies in order and ignores a duplicate click', async () => {
    const oldRun1 = appliedRun('old-run-1', 'step-1', 'draft', 'raw', 'raw-v1')
    const oldRun2 = appliedRun('old-run-2', 'step-2', 'final', 'draft', 'draft-v1')
    const initial = executionBoard()
    reset(initial, { [oldRun1.id]: oldRun1, [oldRun2.id]: oldRun2 })

    const newRun1 = queuedRun('new-run-1', 'step-1', 'draft')
    const newRun2 = queuedRun('new-run-2', 'step-2', 'final')
    const afterStep1 = executionBoard('draft-v2')
    afterStep1.transformations[0] = {
      ...afterStep1.transformations[0], lastRunId: newRun1.id, lastAppliedRunId: newRun1.id,
    }
    const afterStep2 = executionBoard('draft-v2', 'final-v2')
    afterStep2.transformations[0] = afterStep1.transformations[0]
    afterStep2.transformations[1] = {
      ...afterStep2.transformations[1], lastRunId: newRun2.id, lastAppliedRunId: newRun2.id,
    }
    vi.spyOn(v2Api, 'startRun')
      .mockResolvedValueOnce({ run: newRun1 })
      .mockResolvedValueOnce({ run: newRun2 })
    vi.spyOn(v2Api, 'getRun')
      .mockResolvedValueOnce({ run: { ...newRun1, status: 'succeeded', result: { output: '# draft', digest: 'draft-v2', disposition: 'applied' } } })
      .mockResolvedValueOnce({ run: { ...newRun2, status: 'succeeded', result: { output: '# final', digest: 'final-v2', disposition: 'applied' } } })
    vi.spyOn(v2Api, 'getBoard')
      .mockResolvedValueOnce({ board: afterStep1 })
      .mockResolvedValueOnce({ board: afterStep2 })

    const first = runTo('step-2')
    const duplicate = runTo('step-2')
    await flush()
    const progress = useV2Canvas.getState().notices.find((notice) => notice.kind === 'progress')
    expect(progress).toMatchObject({
      operationId: 'run-to:step-2', boardId: 'board-1', kind: 'progress',
      message: '正在运行第 1/2 步：“step-1”…',
    })
    expect(v2Api.startRun).toHaveBeenCalledTimes(1)
    expect(v2Api.startRun).toHaveBeenNthCalledWith(1, 'board-1', 'step-1')

    await vi.advanceTimersByTimeAsync(500)
    await flush()
    expect(v2Api.startRun).toHaveBeenNthCalledWith(2, 'board-1', 'step-2')
    expect(useV2Canvas.getState().notices.find((notice) => notice.kind === 'progress'))
      .toMatchObject({ message: '正在运行第 2/2 步：“step-2”…' })

    await vi.advanceTimersByTimeAsync(500)
    await Promise.all([first, duplicate])

    expect(v2Api.startRun).toHaveBeenCalledTimes(2)
    expect(useV2Canvas.getState().message).toContain('已更新到')
    expect(useV2Canvas.getState().notices.filter((notice) =>
      notice.operationId === progress?.operationId)).toEqual([
      expect.objectContaining({ kind: 'success', operationId: progress?.operationId }),
    ])
  })

  it('does not create a Run when every result is current', async () => {
    const run1 = appliedRun('old-run-1', 'step-1', 'draft', 'raw', 'raw-v2')
    const run2 = appliedRun('old-run-2', 'step-2', 'final', 'draft', 'draft-v1')
    reset(executionBoard(), { [run1.id]: run1, [run2.id]: run2 })
    const startRun = vi.spyOn(v2Api, 'startRun')

    await runTo('step-2')

    expect(startRun).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().message).toContain('已经是最新')
  })

  it('keeps the dependency-path position when an earlier step is already current', async () => {
    const currentUpstream = appliedRun('old-run-1', 'step-1', 'draft', 'raw', 'raw-v2')
    const staleTarget = appliedRun('old-run-2', 'step-2', 'final', 'draft', 'draft-v0')
    const initial = executionBoard()
    reset(initial, { [currentUpstream.id]: currentUpstream, [staleTarget.id]: staleTarget })

    const newRun = queuedRun('new-run-2', 'step-2', 'final')
    const completed = executionBoard('draft-v1', 'final-v2')
    completed.transformations[1] = {
      ...completed.transformations[1], lastRunId: newRun.id, lastAppliedRunId: newRun.id,
    }
    vi.spyOn(v2Api, 'startRun').mockResolvedValue({ run: newRun })
    vi.spyOn(v2Api, 'getRun').mockResolvedValue({
      run: {
        ...newRun,
        status: 'succeeded',
        result: { output: '# final', digest: 'final-v2', disposition: 'applied' },
      },
    })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: completed })

    const pending = runTo('step-2')
    await flush()

    expect(v2Api.startRun).toHaveBeenCalledTimes(1)
    expect(v2Api.startRun).toHaveBeenCalledWith('board-1', 'step-2')
    expect(useV2Canvas.getState().notices.find((notice) => notice.kind === 'progress'))
      .toMatchObject({ message: '正在运行第 2/2 步：“step-2”…' })

    await vi.advanceTimersByTimeAsync(500)
    await pending
  })

  it('stops before starting when an upstream Candidate needs a decision', async () => {
    const candidate = {
      ...appliedRun('candidate-run', 'step-1', 'draft', 'raw', 'raw-v1'),
      result: { output: '# candidate', digest: 'candidate', disposition: 'candidate' as const },
    }
    const canvas = executionBoard()
    canvas.transformations[0] = { ...canvas.transformations[0], lastRunId: candidate.id }
    reset(canvas, { [candidate.id]: candidate })
    const startRun = vi.spyOn(v2Api, 'startRun')

    await runTo('step-2')

    expect(startRun).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'run', runId: candidate.id })
    expect(useV2Canvas.getState().message).toContain('待比较')
  })

  it('stops the sequence when an upstream Run fails', async () => {
    const oldRun1 = appliedRun('old-run-1', 'step-1', 'draft', 'raw', 'raw-v1')
    const oldRun2 = appliedRun('old-run-2', 'step-2', 'final', 'draft', 'draft-v1')
    reset(executionBoard(), { [oldRun1.id]: oldRun1, [oldRun2.id]: oldRun2 })
    const failed = queuedRun('failed-run', 'step-1', 'draft')
    vi.spyOn(v2Api, 'startRun').mockResolvedValue({ run: failed })
    vi.spyOn(v2Api, 'getRun').mockResolvedValue({
      run: {
        ...failed,
        status: 'failed',
        error: { code: 'MODEL_FAILED', message: '生成失败', retryable: true },
      },
    })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: executionBoard() })

    const pending = runTo('step-2')
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    await pending

    expect(v2Api.startRun).toHaveBeenCalledTimes(1)
    expect(useV2Canvas.getState().message).toContain('生成失败')
  })
})

describe('interrupt run', () => {
  it('immediately refreshes projected node status after polling has stopped', async () => {
    const running = {
      ...queuedRun('active-run', 'step-1', 'draft'),
      status: 'running' as const,
    }
    const board = executionBoard()
    board.transformations[0] = {
      ...board.transformations[0],
      lastRunId: running.id,
      lastAppliedRunId: undefined,
    }
    reset(board, { [running.id]: running })
    vi.spyOn(v2Api, 'interruptRun').mockResolvedValue({
      run: { ...running, status: 'interrupted', finishedAt: now },
    })

    await useV2Canvas.getState().interruptRun(running.id)

    expect(useV2Canvas.getState().runs[running.id].status).toBe('interrupted')
    expect(useV2Canvas.getState().nodes.find((node) => node.id === 'draft')?.data.runStatus)
      .toBe('interrupted')
    expect(useV2Canvas.getState().nodes.find((node) => node.id === 'transformation-node:step-1')?.data.status)
      .toBe('interrupted')
  })
})
