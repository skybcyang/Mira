import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from './domain'
import { v2Api } from './v2Api'
import { projectV2Board } from './v2Projection'
import { useV2Canvas } from './v2Store'

const now = '2026-08-23T00:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function card(id: string, versionId: string): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown: `# ${id}` },
      digest: `digest-${id}`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

const original: Transformation = {
  id: 'transformation-1',
  sourceCardIds: ['source-a'],
  targetCardId: 'target',
  label: '旧成果',
  instruction: '旧目标',
  acceptance: '旧标准',
  permissions: { workspaceWrite: false },
  workflowRef: { workflowId: 'workflow-1', stepId: 'step-1', applicationId: 'application-1' },
  lastRunId: 'run-1',
  createdAt: now,
  updatedAt: now,
}

const existingRun: TransformationRun = {
  id: 'run-1',
  boardId: 'board-1',
  transformationId: original.id,
  status: 'succeeded',
  sourceSnapshot: [],
  targetCardId: original.targetCardId,
  targetBaseVersionId: 'target-v1',
  intent: 'update',
  result: { output: '# 结果', digest: 'result', disposition: 'applied', appliedVersionId: 'target-v1' },
  createdAt: now,
}

function canvas(id = 'board-1'): BoardV2 {
  return {
    schemaVersion: 2,
    id,
    title: id,
    cards: [card('source-a', 'source-a-v1'), card('source-b', 'source-b-v2'), card('target', 'target-v1')],
    transformations: id === 'board-1' ? [original] : [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  const board = canvas()
  const runs = { [existingRun.id]: existingRun }
  useV2Canvas.setState({
    boardId: board.id,
    board,
    ...projectV2Board(board, runs),
    runs,
    selectedCardIds: ['source-b', 'source-a'],
    drawer: { tab: 'relation', transformationId: original.id },
    message: null,
    loadState: 'ready',
  })
  const memory = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('transformation structure editing', () => {
  it('reconciles a decision using current Run and Board facts without navigating', async () => {
    const refresh = (useV2Canvas.getState() as unknown as { refreshCandidate?: (id: string) => Promise<boolean> }).refreshCandidate
    expect(refresh).toBeTypeOf('function')
    if (!refresh) return
    vi.spyOn(v2Api, 'getRun').mockResolvedValue({ run: existingRun })
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas() })
    const before = useV2Canvas.getState().drawer
    expect(await refresh(existingRun.id)).toBe(true)
    expect(useV2Canvas.getState().runs[existingRun.id].result?.disposition).toBe('applied')
    expect(useV2Canvas.getState().drawer).toEqual(before)
  })
  it('adopts only against the version the reader compared, retaining a conflicting candidate', async () => {
    const candidate: TransformationRun = { ...existingRun, result: { output: 'candidate', digest: 'candidate', disposition: 'candidate' } }
    const changed = canvas()
    changed.cards = changed.cards.map((item) => item.id === 'target' ? card('target', 'target-v2') : item)
    useV2Canvas.setState({ board: changed, runs: { [candidate.id]: candidate }, drawer: { tab: 'run', runId: candidate.id } })
    const adopt = vi.spyOn(v2Api, 'adoptCandidate').mockRejectedValue(Object.assign(new Error('conflict'), { code: 'CARD_VERSION_CONFLICT', status: 409 }))
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: changed })
    vi.spyOn(v2Api, 'getRun').mockResolvedValue({ run: candidate })
    const action = useV2Canvas.getState().adoptCandidate as (id: string, base: string | null) => Promise<unknown>
    await action(candidate.id, 'target-v1')
    expect(adopt).toHaveBeenCalledWith(candidate.id, 'target-v1')
    expect(useV2Canvas.getState().board?.cards.find((item) => item.id === 'target')?.headVersionId).toBe('target-v2')
    expect(useV2Canvas.getState().runs[candidate.id].result?.disposition).toBe('candidate')
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'run', runId: candidate.id })
  })

  it('refreshes transformation provenance before opening versions after adopting a candidate', async () => {
    const candidateRun: TransformationRun = {
      ...existingRun,
      id: 'run-candidate',
      result: { output: '# 待采用结果', digest: 'candidate', disposition: 'candidate' },
    }
    const adoptedRun: TransformationRun = {
      ...candidateRun,
      result: {
        output: '# 已采用结果',
        digest: 'adopted',
        disposition: 'applied',
        appliedVersionId: 'target-v2',
      },
    }
    const initialBoard = canvas()
    initialBoard.transformations = [{
      ...original,
      lastRunId: candidateRun.id,
      lastAppliedRunId: existingRun.id,
    }]
    const adoptedCard = card('target', 'target-v2')
    const refreshedBoard: BoardV2 = {
      ...initialBoard,
      cards: initialBoard.cards.map((item) => item.id === adoptedCard.id ? adoptedCard : item),
      transformations: initialBoard.transformations.map((item) => ({
        ...item,
        lastAppliedRunId: candidateRun.id,
        updatedAt: '2026-08-23T01:00:00.000Z',
      })),
    }
    const initialRuns = { [existingRun.id]: existingRun, [candidateRun.id]: candidateRun }
    useV2Canvas.setState({
      boardId: initialBoard.id,
      board: initialBoard,
      ...projectV2Board(initialBoard, initialRuns),
      runs: initialRuns,
      drawer: { tab: 'run', runId: candidateRun.id },
    })
    const adopt = vi.spyOn(v2Api, 'adoptCandidate').mockResolvedValue({
      card: adoptedCard,
      run: adoptedRun,
    })
    const refresh = vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: refreshedBoard })

    await useV2Canvas.getState().adoptCandidate(candidateRun.id, 'target-v1')

    expect(adopt).toHaveBeenCalledWith(candidateRun.id, 'target-v1')
    expect(refresh).toHaveBeenCalledWith(initialBoard.id)
    expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(refresh.mock.invocationCallOrder[0])
    expect(useV2Canvas.getState().board?.transformations[0].lastAppliedRunId)
      .toBe(candidateRun.id)
    expect(useV2Canvas.getState().board?.transformations[0].updatedAt)
      .toBe('2026-08-23T01:00:00.000Z')
    expect(useV2Canvas.getState().runs[candidateRun.id]).toEqual(adoptedRun)
    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'versions', cardId: adoptedCard.id })
  })

  it('does not replace a detail drawer opened while Candidate adoption is pending', async () => {
    const candidateRun: TransformationRun = {
      ...existingRun,
      id: 'run-candidate-late',
      result: { output: '# 待采用结果', digest: 'candidate', disposition: 'candidate' },
    }
    const adoptedRun: TransformationRun = {
      ...candidateRun,
      result: {
        output: '# 已采用结果',
        digest: 'adopted',
        disposition: 'applied',
        appliedVersionId: 'target-v2',
      },
    }
    const initialBoard = canvas()
    const adoptedCard = card('target', 'target-v2')
    const response = deferred<{ card: ContentCard; run: TransformationRun }>()
    useV2Canvas.setState({
      board: initialBoard,
      runs: { [candidateRun.id]: candidateRun },
      drawer: { tab: 'run', runId: candidateRun.id },
    })
    vi.spyOn(v2Api, 'adoptCandidate').mockReturnValue(response.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: initialBoard })

    const pending = useV2Canvas.getState().adoptCandidate(candidateRun.id, 'target-v1')
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'source-a' })
    response.resolve({ card: adoptedCard, run: adoptedRun })
    await pending

    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'source-a' })
  })

  it('does not close a detail drawer opened while Candidate discard is pending', async () => {
    const candidateRun: TransformationRun = {
      ...existingRun,
      id: 'run-candidate-discard',
      result: { output: '# 待丢弃结果', digest: 'candidate', disposition: 'candidate' },
    }
    const discardedRun: TransformationRun = {
      ...candidateRun,
      result: { ...candidateRun.result!, disposition: 'discarded' },
    }
    const response = deferred<{ run: TransformationRun }>()
    useV2Canvas.setState({
      runs: { [candidateRun.id]: candidateRun },
      drawer: { tab: 'run', runId: candidateRun.id },
    })
    vi.spyOn(v2Api, 'discardCandidate').mockReturnValue(response.promise)

    const pending = useV2Canvas.getState().discardCandidate(candidateRun.id)
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'source-b' })
    response.resolve({ run: discardedRun })
    await pending

    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'source-b' })
  })

  it('updates editable fields and replaces sources with ordered current Head refs', async () => {
    const updated: Transformation = {
      ...original,
      sourceCardIds: ['source-b', 'source-a'],
      label: '形成建议',
      instruction: '综合材料形成建议',
      acceptance: '建议可执行',
      updatedAt: '2026-08-23T01:00:00.000Z',
    }
    const patch = vi.spyOn(v2Api, 'updateTransformation').mockResolvedValue({ transformation: updated })

    const saved = await useV2Canvas.getState().updateTransformation(original.id, {
      label: updated.label,
      instruction: updated.instruction,
      acceptance: updated.acceptance,
      sourceCardIds: ['source-b', 'source-a'],
    })

    expect(patch).toHaveBeenCalledWith('board-1', original.id, {
      baseUpdatedAt: original.updatedAt,
      label: updated.label,
      instruction: updated.instruction,
      acceptance: updated.acceptance,
      sourceRefs: [
        { cardId: 'source-b', versionId: 'source-b-v2' },
        { cardId: 'source-a', versionId: 'source-a-v1' },
      ],
    })
    expect(saved).toBe(true)
    expect(useV2Canvas.getState().board?.transformations[0]).toEqual(updated)
    expect(useV2Canvas.getState().board?.cards.map((item) => item.id))
      .toEqual(['source-a', 'source-b', 'target'])
    expect(useV2Canvas.getState().runs).toEqual({ 'run-1': existingRun })
    expect(useV2Canvas.getState().message).toBe('已调整当前步骤，保存的方法保持不变。')
  })

  it('keeps the generic update message for an ordinary transformation', async () => {
    const plain = { ...original, id: 'plain-transformation', workflowRef: undefined }
    const currentBoard = canvas()
    currentBoard.transformations = [plain]
    useV2Canvas.setState({
      board: currentBoard,
      ...projectV2Board(currentBoard, { [existingRun.id]: existingRun }),
    })
    vi.spyOn(v2Api, 'updateTransformation').mockResolvedValue({
      transformation: { ...plain, label: '普通转化已更新' },
    })

    const saved = await useV2Canvas.getState().updateTransformation(plain.id, {
      label: '普通转化已更新',
    })

    expect(saved).toBe(true)
    expect(useV2Canvas.getState().message).toBe('转化已更新。')
  })

  it('does not apply a late transformation patch to a different board', async () => {
    const response = deferred<{ transformation: Transformation }>()
    vi.spyOn(v2Api, 'updateTransformation').mockReturnValue(response.promise)
    vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: canvas('board-2') })

    const updatePending = useV2Canvas.getState().updateTransformation(original.id, { label: '迟到结果' })
    await useV2Canvas.getState().switchBoard('board-2')
    response.resolve({ transformation: { ...original, label: '迟到结果' } })
    await updatePending

    expect(useV2Canvas.getState().boardId).toBe('board-2')
    expect(useV2Canvas.getState().board?.transformations).toEqual([])
    expect(useV2Canvas.getState().message).toBeNull()
  })

  it('explains that a pending candidate must be resolved before structure changes', async () => {
    vi.spyOn(v2Api, 'updateTransformation').mockRejectedValue(Object.assign(
      new Error('backend rejected the mutation'),
      { code: 'CANDIDATE_PENDING' },
    ))

    const saved = await useV2Canvas.getState().updateTransformation(original.id, {
      label: '不应保存',
    })

    expect(saved).toBe(false)
    expect(useV2Canvas.getState().message)
      .toBe('先采用或丢弃待比较结果，再修改、删除或重新生成。')
  })

  it('refreshes a conflicting transformation while keeping its detail context recoverable', async () => {
    const remoteBoard = canvas()
    remoteBoard.transformations = [{
      ...original,
      label: '其他窗口的新名称',
      updatedAt: '2026-08-23T02:00:00.000Z',
    }]
    vi.spyOn(v2Api, 'updateTransformation').mockRejectedValue(Object.assign(
      new Error('conflict'),
      { code: 'TRANSFORMATION_CONFLICT', status: 409 },
    ))
    const refresh = vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: remoteBoard })

    const saved = await useV2Canvas.getState().updateTransformation(original.id, {
      label: '本地尚未保存的名称',
    })

    expect(saved).toBe(false)
    expect(refresh).toHaveBeenCalledWith('board-1')
    expect(useV2Canvas.getState().board?.transformations[0].label).toBe('其他窗口的新名称')
    expect(useV2Canvas.getState().drawer).toEqual({
      tab: 'relation',
      transformationId: original.id,
    })
    expect(useV2Canvas.getState().message)
      .toBe('转化已在其他窗口更新，请刷新后重试')
  })

  it('deletes only the transformation and preserves target content, versions, and runs', async () => {
    vi.spyOn(v2Api, 'deleteTransformation').mockResolvedValue({ deletedTransformationId: original.id })

    const deleted = await useV2Canvas.getState().deleteTransformation(original.id)

    expect(deleted).toBe(true)
    expect(useV2Canvas.getState().board?.transformations).toEqual([])
    expect(useV2Canvas.getState().board?.cards.find((item) => item.id === 'target')?.headVersionId)
      .toBe('target-v1')
    expect(useV2Canvas.getState().runs).toEqual({ 'run-1': existingRun })
    expect(useV2Canvas.getState().drawer).toBeNull()
    expect(useV2Canvas.getState().message).toContain('目标卡、版本和已有运行均已保留')
  })
})
