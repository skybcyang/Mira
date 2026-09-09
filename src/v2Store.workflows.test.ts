import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BoardV2,
  ContentCard,
  Transformation,
  WorkflowTemplate,
} from './domain'
import { v2Api } from './v2Api'
import { useV2Canvas } from './v2Store'

const now = '2026-08-23T00:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function card(id: string, versionId: string, x: number, y: number): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x,
    y,
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

function transformation(
  id: string,
  sourceCardIds: string[],
  targetCardId: string,
): Transformation {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: id,
    instruction: `执行 ${id}`,
    acceptance: '',
    permissions: { workspaceWrite: false },
    createdAt: now,
    updatedAt: now,
  }
}

const sourceA = card('source-a', 'version-a', 0, 0)
const sourceB = card('source-b', 'version-b', 400, 200)
const draft = card('draft', 'version-draft', 800, 0)
const final = card('final', 'version-final', 1200, 0)
const first = transformation('collect', ['source-a', 'source-b'], 'draft')
const second = transformation('review', ['draft'], 'final')

function board(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '研究画板',
    cards: [sourceA, sourceB, draft, final],
    transformations: [first, second],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

const workflow: WorkflowTemplate = {
  id: 'workflow-1',
  title: '研究简报',
  description: '',
  steps: [
    { id: 'step-1', label: 'collect', instruction: '执行 collect', acceptance: '' },
    { id: 'step-2', label: 'review', instruction: '执行 review', acceptance: '' },
  ],
  createdAt: now,
  updatedAt: now,
}

const contractedWorkflow: WorkflowTemplate = {
  ...workflow,
  inputs: [
    { id: 'input-brief', name: '需求说明', description: '', required: true, cardinality: 'one' },
    { id: 'input-research', name: '调研资料', description: '', required: true, cardinality: 'many' },
  ],
  steps: [
    { ...workflow.steps[0], sources: [{ kind: 'input', inputId: 'input-brief' }] },
    { ...workflow.steps[1], sources: [{ kind: 'previous-output' }, { kind: 'input', inputId: 'input-research' }] },
  ],
}

beforeEach(() => {
  useV2Canvas.setState({
    boardId: 'board-1',
    board: board(),
    workflows: [],
    workflowState: 'ready',
    applyingWorkflowId: null,
    runningToTransformationId: null,
    workflowDraft: null,
    selectedCardIds: [],
    suggestions: [],
    suggestionState: 'idle',
    branchDraft: null,
    drawer: null,
    message: null,
    notices: [],
    runs: {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workflow store', () => {
  it('refreshes the global library independently from board loading', async () => {
    vi.spyOn(v2Api, 'listWorkflows').mockResolvedValue({ workflows: [workflow] })

    await useV2Canvas.getState().refreshWorkflows()

    expect(useV2Canvas.getState().workflows).toEqual([workflow])
    expect(useV2Canvas.getState().workflowState).toBe('ready')
  })

  it('saves the maximal linear chain as an ordered global template', async () => {
    const create = vi.spyOn(v2Api, 'createWorkflow').mockResolvedValue({ workflow })

    await useV2Canvas.getState().createWorkflowFromTransformation(
      first.id,
      '  研究简报  ',
      '  聚焦可信证据  ',
    )

    expect(create).toHaveBeenCalledWith({
      title: '研究简报',
      description: '聚焦可信证据',
      sourceBoardId: 'board-1',
      transformationIds: ['collect', 'review'],
      inputs: [
        { sourceCardId: 'source-a', name: 'source-a', description: '', required: true, cardinality: 'one' },
        { sourceCardId: 'source-b', name: 'source-b', description: '', required: true, cardinality: 'one' },
      ],
    })
    expect(useV2Canvas.getState().workflows).toEqual([workflow])
  })

  it('saves only the completed prefix when a downstream target Head is empty', async () => {
    const prefixWorkflow = { ...workflow, steps: workflow.steps.slice(0, 1) }
    const create = vi.spyOn(v2Api, 'createWorkflow').mockResolvedValue({ workflow: prefixWorkflow })
    const unverified = board()
    unverified.cards = unverified.cards.map((item) => item.id === 'final'
      ? { ...item, headVersionId: null, versions: [] }
      : item)
    useV2Canvas.setState({ board: unverified })

    await useV2Canvas.getState().createWorkflowFromTransformation(first.id, '研究简报', '')

    expect(create).toHaveBeenCalledWith({
      title: '研究简报',
      description: '',
      sourceBoardId: 'board-1',
      transformationIds: ['collect'],
      inputs: [
        { sourceCardId: 'source-a', name: 'source-a', description: '', required: true, cardinality: 'one' },
        { sourceCardId: 'source-b', name: 'source-b', description: '', required: true, cardinality: 'one' },
      ],
    })
  })

  it('extracts an entire completed plan when saving from a later planned step', async () => {
    const planned = board()
    planned.transformations = planned.transformations.map((item, index) => ({
      ...item,
      planRef: {
        planId: 'plan-1',
        source: 'ad-hoc' as const,
        title: '研究计划',
        stepIndex: index + 1,
        stepTotal: 2,
      },
    }))
    planned.cards.push(card('alternative', 'version-alternative', 1000, 300))
    planned.transformations.push(transformation('explore', ['draft'], 'alternative'))
    useV2Canvas.setState({ board: planned })
    const create = vi.spyOn(v2Api, 'createWorkflow').mockResolvedValue({ workflow })

    await useV2Canvas.getState().createWorkflowFromTransformation(second.id, '研究简报', '')

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      transformationIds: ['collect', 'review'],
    }))
  })

  it('does not save a completed prefix from an unfinished numbered plan', async () => {
    const planned = board()
    planned.transformations = planned.transformations.map((item, index) => ({
      ...item,
      planRef: {
        planId: 'plan-1',
        source: 'ad-hoc' as const,
        title: '研究计划',
        stepIndex: index + 1,
        stepTotal: 2,
      },
    }))
    planned.cards = planned.cards.map((item) => item.id === 'final'
      ? { ...item, headVersionId: null, versions: [] }
      : item)
    useV2Canvas.setState({ board: planned })
    const create = vi.spyOn(v2Api, 'createWorkflow')

    await useV2Canvas.getState().createWorkflowFromTransformation(first.id, '研究简报', '')

    expect(create).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().message).toContain('整个计划')
  })

  it('does not save when the selected first step has no completed target', async () => {
    const create = vi.spyOn(v2Api, 'createWorkflow')
    const unverified = board()
    unverified.cards = unverified.cards.map((item) => item.id === 'draft'
      ? { ...item, headVersionId: null, versions: [] }
      : item)
    useV2Canvas.setState({ board: unverified })

    await useV2Canvas.getState().createWorkflowFromTransformation(first.id, '研究简报', '')

    expect(create).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().message).toContain('完成这一步成果')
  })

  it('places a workflow draft, binds named inputs, then creates a plan without starting a run', async () => {
    const targetA = card('workflow-card-a', 'version-target-a', 840, 100)
    const targetB = card('workflow-card-b', 'version-target-b', 1240, 100)
    const planA = transformation('workflow-transform-a', ['source-b', 'source-a'], targetA.id)
    const planB = transformation('workflow-transform-b', [targetA.id], targetB.id)
    vi.spyOn(v2Api, 'applyWorkflow').mockResolvedValue({
      workflow: contractedWorkflow,
      applicationId: 'application-1',
      transformations: [planA, planB],
      targetCards: [targetA, targetB],
    })
    const startRun = vi.spyOn(v2Api, 'startRun')
    useV2Canvas.setState({ workflows: [contractedWorkflow], selectedCardIds: [] })

    useV2Canvas.getState().beginWorkflowDraft(contractedWorkflow.id, { x: 600, y: 100 })
    await useV2Canvas.getState().onConnect({
      source: 'source-a', target: 'workflow-draft-step:step-1',
      sourceHandle: null, targetHandle: 'workflow-input:input-brief',
    })
    await useV2Canvas.getState().onConnect({
      source: 'source-b', target: 'workflow-draft-step:step-2',
      sourceHandle: null, targetHandle: 'workflow-input:input-research',
    })
    await useV2Canvas.getState().materializeWorkflowDraft()

    expect(v2Api.applyWorkflow).toHaveBeenCalledWith('board-1', contractedWorkflow.id, {
      inputBindings: [
        { inputId: 'input-brief', sourceRefs: [{ cardId: 'source-a', versionId: 'version-a' }] },
        { inputId: 'input-research', sourceRefs: [{ cardId: 'source-b', versionId: 'version-b' }] },
      ],
      targetPosition: { x: 800, y: 372 },
    })
    expect(startRun).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().board?.cards.slice(-2).map((item) => item.id))
      .toEqual(['workflow-card-a', 'workflow-card-b'])
    expect(useV2Canvas.getState().board?.transformations.slice(-2).map((item) => item.id))
      .toEqual(['workflow-transform-a', 'workflow-transform-b'])
    expect(useV2Canvas.getState().drawer).toEqual({
      tab: 'relation',
      transformationId: 'workflow-transform-a',
    })
  })

  it('places an ad-hoc plan draft without guessing bindings, then materializes it atomically', async () => {
    const targetA = { ...card('plan-card-a', 'unused-a', 840, 100), headVersionId: null, versions: [] }
    const targetB = { ...card('plan-card-b', 'unused-b', 1400, 100), headVersionId: null, versions: [] }
    const planA = {
      ...transformation('plan-transform-a', ['source-b', 'source-a'], targetA.id),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '发布判断', stepIndex: 1, stepTotal: 2 },
    }
    const planB = {
      ...transformation('plan-transform-b', [targetA.id], targetB.id),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '发布判断', stepIndex: 2, stepTotal: 2 },
    }
    const createPlan = vi.spyOn(v2Api, 'createPlan').mockResolvedValue({
      planId: 'plan-1',
      title: '发布判断',
      transformations: [planA, planB],
      targetCards: [targetA, targetB],
    })
    const startRun = vi.spyOn(v2Api, 'startRun')
    const createWorkflow = vi.spyOn(v2Api, 'createWorkflow')
    useV2Canvas.setState({ selectedCardIds: ['source-b', 'source-a'] })

    useV2Canvas.getState().beginAdHocPlanDraft({
      title: '  发布判断  ',
      finalOutcome: '形成判断',
      steps: ['  提炼关键证据  ', '形成可发布判断'],
    }, { x: 600, y: 100 })

    expect(useV2Canvas.getState().workflowDraft?.bindings).toEqual({})
    expect(useV2Canvas.getState().nodes.filter((node) => node.type === 'workflowDraftStep'))
      .toHaveLength(2)

    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')
    const draftOrigin = useV2Canvas.getState().workflowDraft!.origin
    await useV2Canvas.getState().materializeWorkflowDraft()

    expect(createPlan).toHaveBeenCalledWith('board-1', {
      title: '发布判断',
      sourceRefs: [
        { cardId: 'source-b', versionId: 'version-b' },
        { cardId: 'source-a', versionId: 'version-a' },
      ],
      steps: [
        { label: '提炼关键证据', instruction: '提炼关键证据', acceptance: '' },
        { label: '形成判断', instruction: '形成可发布判断', acceptance: '' },
      ],
      targetPosition: { x: draftOrigin.x + 200, y: draftOrigin.y },
    })
    expect(startRun).not.toHaveBeenCalled()
    expect(createWorkflow).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().board?.cards.slice(-2).map((item) => item.id))
      .toEqual(['plan-card-a', 'plan-card-b'])
    expect(useV2Canvas.getState().board?.transformations.slice(-2).map((item) => item.id))
      .toEqual(['plan-transform-a', 'plan-transform-b'])
    expect(useV2Canvas.getState().workflowDraft).toBeNull()
    expect(useV2Canvas.getState().drawer).toEqual({
      tab: 'relation',
      transformationId: 'plan-transform-a',
    })
    expect(useV2Canvas.getState().message).toContain('尚未生成')
  })

  it('keeps an ad-hoc draft and the saved board unchanged when atomic creation fails', async () => {
    vi.spyOn(v2Api, 'createPlan').mockRejectedValue(Object.assign(
      new Error('计划没有写入'),
      { code: 'BOARD_V2_WRITE_FAILED' },
    ))
    useV2Canvas.getState().beginAdHocPlanDraft({
      title: '失败计划',
      finalOutcome: '整理结果',
      steps: ['整理材料'],
    }, { x: 600, y: 100 })
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })
    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')
    const before = useV2Canvas.getState().board

    await useV2Canvas.getState().materializeWorkflowDraft()

    expect(useV2Canvas.getState().board).toBe(before)
    expect(useV2Canvas.getState().workflowDraft).not.toBeNull()
    expect(useV2Canvas.getState().message).toContain('计划没有写入')
  })

  it('freezes input bindings while an atomic plan creation request is pending', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const target = { ...card('plan-card', 'unused', 840, 100), headVersionId: null, versions: [] }
    const step = {
      ...transformation('plan-transform', ['source-a'], target.id),
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '整理计划', stepIndex: 1, stepTotal: 1 },
    }
    vi.spyOn(v2Api, 'createPlan').mockImplementation(async () => {
      await gate
      return { planId: 'plan-1', title: '整理计划', transformations: [step], targetCards: [target] }
    })
    useV2Canvas.getState().beginAdHocPlanDraft({
      title: '整理计划',
      finalOutcome: '整理结果',
      steps: ['整理材料'],
    }, { x: 600, y: 100 })
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })
    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')

    const materializing = useV2Canvas.getState().materializeWorkflowDraft()
    expect(useV2Canvas.getState().applyingWorkflowId).not.toBeNull()
    const progress = useV2Canvas.getState().notices.find((notice) =>
      notice.kind === 'progress' && notice.operationId)
    expect(progress).toMatchObject({ kind: 'progress', boardId: 'board-1' })
    const duplicateMaterializing = useV2Canvas.getState().materializeWorkflowDraft()
    expect(v2Api.createPlan).toHaveBeenCalledOnce()
    useV2Canvas.getState().unbindWorkflowInput('ad-hoc-plan-input', 'source-a')
    useV2Canvas.setState({ selectedCardIds: ['source-b'] })
    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')

    expect(useV2Canvas.getState().workflowDraft?.bindings['ad-hoc-plan-input'])
      .toEqual(['source-a'])
    release()
    await Promise.all([materializing, duplicateMaterializing])
    expect(useV2Canvas.getState().notices.filter((notice) =>
      notice.operationId === progress?.operationId)).toEqual([
      expect.objectContaining({ kind: 'success', operationId: progress?.operationId }),
    ])
  })

  it('freezes source versions when cards are bound and requires explicit rebinding after a change', async () => {
    const createPlan = vi.spyOn(v2Api, 'createPlan').mockRejectedValue(Object.assign(
      new Error('source changed'),
      { code: 'SOURCE_VERSION_CHANGED' },
    ))
    useV2Canvas.getState().beginAdHocPlanDraft({
      title: '整理计划',
      finalOutcome: '整理结果',
      steps: ['整理材料'],
    }, { x: 600, y: 100 })
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })
    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')
    const currentBoard = useV2Canvas.getState().board!
    const changedBoard = {
      ...currentBoard,
      cards: currentBoard.cards.map((item) => item.id === 'source-a'
          ? {
            ...item,
            headVersionId: 'version-a-2',
            versions: [...item.versions, {
              ...item.versions[0],
              id: 'version-a-2',
              sequence: 2,
              content: { kind: 'markdown' as const, markdown: '# source-a changed' },
            }],
          }
          : item),
    }
    useV2Canvas.setState({ board: changedBoard })
    const getBoard = vi.spyOn(v2Api, 'getBoard').mockResolvedValue({ board: changedBoard })

    await useV2Canvas.getState().materializeWorkflowDraft()

    expect(createPlan).toHaveBeenCalledWith('board-1', expect.objectContaining({
      sourceRefs: [{ cardId: 'source-a', versionId: 'version-a' }],
    }))
    expect(getBoard).toHaveBeenCalledWith('board-1')
    expect(useV2Canvas.getState().workflowDraft?.bindings['ad-hoc-plan-input'])
      .toEqual(['source-a'])
    useV2Canvas.getState().unbindWorkflowInput('ad-hoc-plan-input', 'source-a')
    useV2Canvas.getState().bindSelectedCardsToWorkflowInput('ad-hoc-plan-input')
    expect(useV2Canvas.getState().workflowDraft?.bindingSourceRefs?.['ad-hoc-plan-input'])
      .toEqual([{ cardId: 'source-a', versionId: 'version-a-2' }])
  })

  it('deletes a workflow from the global library', async () => {
    vi.spyOn(v2Api, 'deleteWorkflow').mockResolvedValue({ deletedWorkflowId: workflow.id })
    useV2Canvas.setState({ workflows: [workflow] })

    await useV2Canvas.getState().deleteWorkflow(workflow.id)

    expect(useV2Canvas.getState().workflows).toEqual([])
    expect(useV2Canvas.getState().message).toContain('已经添加的步骤不受影响')
  })
})

describe('ordinary transformation creation', () => {
  it('keeps a detail drawer opened while step creation is pending', async () => {
    const targetCard = {
      ...card('late-target', 'unused-version', 440, 0),
      headVersionId: null,
      versions: [],
    }
    const createdTransformation = transformation('late-transformation', ['source-a'], targetCard.id)
    const created = deferred<{ transformation: Transformation; targetCard: ContentCard }>()
    vi.spyOn(v2Api, 'createTransformation').mockReturnValue(created.promise)
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })

    const pending = useV2Canvas.getState().generate({
      id: 'custom',
      label: '形成摘要',
      instruction: '把材料整理成摘要',
      acceptance: '',
    })
    useV2Canvas.getState().openDrawer({ tab: 'content', cardId: 'source-b' })
    created.resolve({ transformation: createdTransformation, targetCard })
    await pending

    expect(useV2Canvas.getState().drawer).toEqual({ tab: 'content', cardId: 'source-b' })
  })

  it('creates structure only and never starts a run', async () => {
    const targetCard = {
      ...card('new-target', 'unused-version', 440, 0),
      headVersionId: null,
      versions: [],
    }
    const createdTransformation = transformation('new-transformation', ['source-a'], targetCard.id)
    const create = vi.spyOn(v2Api, 'createTransformation').mockResolvedValue({
      transformation: createdTransformation,
      targetCard,
    })
    const startRun = vi.spyOn(v2Api, 'startRun').mockRejectedValue(
      new Error('a create command must not start a run'),
    )
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })

    await useV2Canvas.getState().generate({
      id: 'custom',
      label: '形成摘要',
      instruction: '把材料整理成摘要',
      acceptance: '保留关键事实',
    })

    expect(create).toHaveBeenCalledOnce()
    expect(startRun).not.toHaveBeenCalled()
    const cards = useV2Canvas.getState().board?.cards || []
    expect(cards[cards.length - 1]?.id).toBe(targetCard.id)
    expect(useV2Canvas.getState().drawer).toEqual({
      tab: 'relation',
      transformationId: createdTransformation.id,
    })
    expect(useV2Canvas.getState().nodes.find((node) => node.id === targetCard.id)?.data)
      .toMatchObject({ waitingExecution: true })
    expect(useV2Canvas.getState().message).toContain('尚未生成')
  })

  it('creates multiple explicit branches through one batch request without starting runs', async () => {
    const targetA = { ...card('target-a', 'unused-a', 440, 0), headVersionId: null, versions: [] }
    const targetB = { ...card('target-b', 'unused-b', 440, 272), headVersionId: null, versions: [] }
    const transformationA = transformation('branch-a', ['source-a'], targetA.id)
    const transformationB = transformation('branch-b', ['source-a'], targetB.id)
    const create = vi.spyOn(v2Api, 'createTransformations').mockResolvedValue({
      transformations: [transformationA, transformationB],
      targetCards: [targetA, targetB],
    })
    const startRun = vi.spyOn(v2Api, 'startRun').mockRejectedValue(
      new Error('a branch create command must not start a run'),
    )
    useV2Canvas.setState({ selectedCardIds: ['source-a'] })

    await useV2Canvas.getState().generateBranches([
      { id: 'branch-a', label: '用户流程', instruction: '拆解用户流程', acceptance: '' },
      { id: 'branch-b', label: '技术方案', instruction: '拆解技术方案', acceptance: '' },
    ])

    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][1].transformations).toHaveLength(2)
    expect(create.mock.calls[0][1].sourceRefs).toEqual([{ cardId: 'source-a', versionId: 'version-a' }])
    expect(create.mock.calls[0][1].transformations.map((item) => item.targetPosition))
      .toEqual([{ x: 596, y: 544 }, { x: 596, y: 816 }])
    expect(startRun).not.toHaveBeenCalled()
    expect(useV2Canvas.getState().board?.cards.slice(-2).map((item) => item.id))
      .toEqual(['target-a', 'target-b'])
    expect(useV2Canvas.getState().drawer).toEqual({
      tab: 'relation',
      transformationId: 'branch-a',
    })
    expect(useV2Canvas.getState().message).toContain('2 个分支')
  })
})
