import { describe, expect, it, vi } from 'vitest'
import { emptyBoardV2, V2BoardStore } from '../../bridge/v2-board-store.js'
import { appendVersion } from '../../bridge/domain/versioning.js'
import { validateBoardV2 } from '../../bridge/domain/validation.js'
import { createStorageCoordinator } from '../../bridge/storage-coordinator.js'
import { createWorkflowService } from '../../bridge/workflow-service.js'
import { WorkflowStore } from '../../bridge/workflow-store.js'

const NOW = '2026-08-23T04:00:00.000Z'

function memoryFs() {
  const files = new Map()
  return {
    files,
    async readText(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
      return files.get(path)
    },
    async writeText(path, content) {
      files.set(path, content)
    },
    async replace(from, to) {
      if (!files.has(from)) throw new Error(`missing temp: ${from}`)
      files.set(to, files.get(from))
      files.delete(from)
    },
    async remove(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`missing: ${path}`), { code: 'ENOENT' })
      }
      files.delete(path)
    },
    async listJson(dir) {
      return [...files.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.json'))
        .map((path) => path.slice(dir.length + 1))
    },
  }
}

function ids() {
  const counts = new Map()
  return (prefix) => {
    const next = (counts.get(prefix) || 0) + 1
    counts.set(prefix, next)
    return `${prefix}-${next}`
  }
}

function deferred() {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function hasClearance(left, right, gap = 32) {
  return (
    left.x + left.width + gap <= right.x ||
    right.x + right.width + gap <= left.x ||
    left.y + left.height + gap <= right.y ||
    right.y + right.height + gap <= left.y
  )
}

function card(id, markdown) {
  const base = {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: null,
    versions: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
  if (markdown === undefined) return base
  return appendVersion(base, {
    baseVersionId: null,
    versionId: `${id}-v1`,
    content: { kind: 'markdown', markdown },
    origin: 'human',
    createdAt: NOW,
  })
}

function fileCard(id, path) {
  const base = {
    id,
    contentKind: 'file-reference',
    x: 0,
    y: 0,
    width: 312,
    height: 208,
    headVersionId: null,
    versions: [],
    createdAt: NOW,
    updatedAt: NOW,
  }
  return appendVersion(base, {
    baseVersionId: null,
    versionId: `${id}-v1`,
    content: { kind: 'file-reference', path, readonly: true },
    origin: 'human',
    createdAt: NOW,
  })
}

function transformation(id, sourceCardIds, targetCardId, semantic = {}) {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: semantic.label || id,
    instruction: semantic.instruction || `执行 ${id}`,
    acceptance: semantic.acceptance || '',
    ...(semantic.modelId ? { modelId: semantic.modelId } : {}),
    permissions: { workspaceWrite: false },
    createdAt: NOW,
    updatedAt: NOW,
  }
}

function linearBoard() {
  const board = emptyBoardV2('board-1', '研究课题', NOW)
  board.cards.push(
    card('source-a', '材料 A'),
    card('source-b', '材料 B'),
    card('middle', '人工提炼的问题'),
    card('final', '人工确认的决策'),
  )
  board.transformations.push(
    transformation('transformation-source', ['source-a', 'source-b'], 'middle', {
      label: '提炼问题',
      instruction: '从材料中提炼核心问题',
      acceptance: '包含问题和约束',
      modelId: 'reasoning-model',
    }),
    transformation('transformation-final', ['middle'], 'final', {
      label: '形成决策',
      instruction: '把问题推进成决策',
      acceptance: '包含选择和依据',
    }),
  )
  return board
}

function template(overrides = {}) {
  return {
    id: 'workflow-research',
    title: '研究到决策',
    description: '把材料推进成决策',
    steps: [
      {
        id: 'workflow-step-a',
        label: '提炼问题',
        instruction: '从材料中提炼核心问题',
        acceptance: '包含问题和约束',
        modelId: 'reasoning-model',
      },
      {
        id: 'workflow-step-b',
        label: '形成决策',
        instruction: '把问题推进成决策',
        acceptance: '包含选择和依据',
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function contractedTemplate(overrides = {}) {
  return template({
    inputs: [
      { id: 'input-brief', name: '需求说明', description: '', required: true, cardinality: 'one' },
      { id: 'input-evidence', name: '证据材料', description: '', required: true, cardinality: 'many' },
    ],
    steps: [
      {
        ...template().steps[0],
        sources: [
          { kind: 'input', inputId: 'input-brief' },
          { kind: 'input', inputId: 'input-evidence' },
        ],
      },
      {
        ...template().steps[1],
        sources: [
          { kind: 'previous-output' },
          { kind: 'input', inputId: 'input-evidence' },
        ],
      },
    ],
    ...overrides,
  })
}

function directPlan(overrides = {}) {
  return {
    title: '访谈到简报',
    sourceRefs: [
      { cardId: 'source-b', versionId: 'source-b-v1' },
      { cardId: 'source-a', versionId: 'source-a-v1' },
    ],
    steps: [
      {
        label: '提取证据',
        instruction: '从访谈中提取关键证据',
        acceptance: '包含原话和来源',
        modelId: 'reasoning-model',
      },
      {
        label: '形成洞察',
        instruction: '将证据整理为用户洞察',
        acceptance: '包含问题和机会',
      },
      {
        label: '生成简报',
        instruction: '把洞察组织成一页简报',
        acceptance: '包含结论和下一步',
      },
    ],
    targetPosition: { x: 600, y: 120 },
    ...overrides,
  }
}

async function fixture(board = linearBoard()) {
  const fs = memoryFs()
  const coordinator = createStorageCoordinator()
  const boardStore = new V2BoardStore(fs, 'boards-v2', {
    coordinator,
    now: () => NOW,
  })
  const workflowStore = new WorkflowStore(fs, 'workflows-v2', { coordinator })
  await boardStore.save(board.id, board)
  const service = createWorkflowService({
    boardStore,
    workflowStore,
    newId: ids(),
    now: () => NOW,
  })
  return { fs, boardStore, workflowStore, service }
}

describe('workflow service', () => {
  it.each(['archived', 'trashed'])('rejects extraction, direct plans, and applications on %s boards', async (state) => {
    const board = linearBoard()
    board.lifecycle = { state }
    const { boardStore, workflowStore, service } = await fixture(board)
    await workflowStore.save('workflow-research', template())

    await expect(service.create({
      title: '研究到决策',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-source', 'transformation-final'],
    })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    await expect(service.createPlan('board-1', directPlan()))
      .rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    await expect(service.apply('board-1', 'workflow-research', {
      sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
      targetPosition: { x: 600, y: 120 },
    })).rejects.toMatchObject({ code: 'BOARD_READ_ONLY' })
    expect(await workflowStore.list()).toEqual([template()])
    expect((await boardStore.load('board-1')).revision).toBe(0)
  })

  it('creates a global template by copying only ordered semantic step configuration', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    const sourceBefore = await boardStore.load('board-1')

    const created = await service.create({
      title: ' 研究到决策 ',
      description: ' 把材料推进成决策 ',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-source', 'transformation-final'],
    })

    expect(created).toEqual({
      id: 'workflow-1',
      title: '研究到决策',
      description: '把材料推进成决策',
      steps: [
        {
          id: 'workflow-step-1',
          label: '提炼问题',
          instruction: '从材料中提炼核心问题',
          acceptance: '包含问题和约束',
          modelId: 'reasoning-model',
        },
        {
          id: 'workflow-step-2',
          label: '形成决策',
          instruction: '把问题推进成决策',
          acceptance: '包含选择和依据',
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    })
    expect(await workflowStore.load(created.id)).toEqual(created)
    expect(await boardStore.load('board-1')).toEqual(sourceBefore)
  })

  it('holds the source board stable until verified template creation commits', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    const saveStarted = deferred()
    const saveMayFinish = deferred()
    const originalSave = workflowStore.save.bind(workflowStore)
    vi.spyOn(workflowStore, 'save').mockImplementation(async (...args) => {
      saveStarted.resolve()
      await saveMayFinish.promise
      return originalSave(...args)
    })

    const create = service.create({
      title: '研究到决策',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-source', 'transformation-final'],
    })
    await saveStarted.promise

    let boardUpdateEntered = false
    const invalidateTarget = boardStore.update('board-1', async (board) => {
      boardUpdateEntered = true
      board.cards = board.cards.map((item) => item.id === 'final'
        ? { ...item, headVersionId: null, versions: [] }
        : item)
      return board
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(boardUpdateEntered).toBe(false)
    saveMayFinish.resolve()
    await expect(create).resolves.toMatchObject({ title: '研究到决策' })
    await invalidateTarget
  })

  it('rejects empty, duplicate, missing, or disconnected transformation selections', async () => {
    const disconnected = linearBoard()
    disconnected.transformations[1] = transformation(
      'transformation-final',
      ['source-a'],
      'final',
    )
    const { workflowStore, service } = await fixture(disconnected)
    const base = { title: '流程', sourceBoardId: 'board-1' }

    await expect(
      service.create({ ...base, transformationIds: [] }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' })
    await expect(
      service.create({
        ...base,
        transformationIds: ['transformation-source', 'transformation-source'],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_INVALID' })
    await expect(
      service.create({ ...base, transformationIds: ['missing'] }),
    ).rejects.toMatchObject({ code: 'TRANSFORMATION_NOT_FOUND' })
    await expect(
      service.create({
        ...base,
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_NOT_LINEAR' })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('rejects a selected chain whose last target feeds its first step', async () => {
    const cyclic = linearBoard()
    cyclic.transformations[0] = transformation(
      'transformation-source',
      ['source-a', 'final'],
      'middle',
      {
        label: '提炼问题',
        instruction: '从材料中提炼核心问题',
        acceptance: '包含问题和约束',
      },
    )
    const { workflowStore, service } = await fixture(cyclic)

    await expect(
      service.create({
        title: '循环流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_NOT_LINEAR' })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('rejects selected fan-out instead of guessing a path and accepts configured external inputs', async () => {
    const fanOut = linearBoard()
    fanOut.cards.push(card('branch', '另一条人工成果'))
    fanOut.transformations.push(
      transformation('transformation-branch', ['middle'], 'branch'),
    )
    const fanOutFixture = await fixture(fanOut)
    await expect(
      fanOutFixture.service.create({
        title: '分叉流程',
        sourceBoardId: 'board-1',
        transformationIds: [
          'transformation-source',
          'transformation-final',
          'transformation-branch',
        ],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_NOT_LINEAR' })
    await expect(fanOutFixture.workflowStore.list()).resolves.toEqual([])

    const merge = linearBoard()
    merge.transformations[1] = transformation(
      'transformation-final',
      ['middle', 'source-b'],
      'final',
    )
    const mergeFixture = await fixture(merge)
    const created = await mergeFixture.service.create({
        title: '合流流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
        inputs: [
          { sourceCardId: 'source-a', name: '主要材料', description: '', required: true, cardinality: 'one' },
          { sourceCardId: 'source-b', name: '补充材料', description: '', required: true, cardinality: 'many' },
        ],
      })
    expect(created.inputs).toEqual([
      expect.objectContaining({ id: 'workflow-input-1', name: '主要材料', cardinality: 'one' }),
      expect.objectContaining({ id: 'workflow-input-2', name: '补充材料', cardinality: 'many' }),
    ])
    expect(created.steps.map((step) => step.sources)).toEqual([
      [
        { kind: 'input', inputId: 'workflow-input-1' },
        { kind: 'input', inputId: 'workflow-input-2' },
      ],
      [
        { kind: 'previous-output' },
        { kind: 'input', inputId: 'workflow-input-2' },
      ],
    ])
  })

  it('requires every selected target to have a current Head before saving a template', async () => {
    const unverified = linearBoard()
    unverified.cards = unverified.cards.map((item) =>
      item.id === 'final' ? card('final') : item,
    )
    const { workflowStore, service } = await fixture(unverified)

    await expect(
      service.create({
        title: '未验证流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_STEP_UNVERIFIED',
      message: expect.stringContaining('transformation-final'),
    })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('rejects saving only a verified prefix or suffix of a numbered plan', async () => {
    const planned = linearBoard()
    planned.transformations = planned.transformations.map((item, index) => ({
      ...item,
      planRef: {
        planId: 'plan-1',
        source: 'ad-hoc',
        title: '研究计划',
        stepIndex: index + 1,
        stepTotal: 2,
      },
    }))
    const { workflowStore, service } = await fixture(planned)

    await expect(service.create({
      title: '不完整计划',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-source'],
    })).rejects.toMatchObject({ code: 'WORKFLOW_PLAN_INCOMPLETE' })
    await expect(service.create({
      title: '不完整计划',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-final'],
    })).rejects.toMatchObject({ code: 'WORKFLOW_PLAN_INCOMPLETE' })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('rejects a selected target whose current Head markdown is only whitespace', async () => {
    const blankHead = linearBoard()
    blankHead.cards = blankHead.cards.map((item) =>
      item.id === 'final' ? card('final', ' \n\t ') : item,
    )
    const { workflowStore, service } = await fixture(blankHead)

    await expect(
      service.create({
        title: '空白成果流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).rejects.toMatchObject({
      code: 'WORKFLOW_STEP_UNVERIFIED',
      message: expect.stringContaining('transformation-final'),
    })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('rejects a selected target whose current Head file reference has a blank path', async () => {
    const blankFileHead = linearBoard()
    blankFileHead.cards = blankFileHead.cards.map((item) =>
      item.id === 'final' ? fileCard('final', ' \t ') : item,
    )
    const { workflowStore, service } = await fixture(blankFileHead)

    await expect(
      service.create({
        title: '空白文件成果流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).rejects.toMatchObject({ code: 'WORKFLOW_STEP_UNVERIFIED' })
    await expect(workflowStore.list()).resolves.toEqual([])
  })

  it('accepts a selected target backed by a valid current Head file reference', async () => {
    const fileHead = linearBoard()
    fileHead.cards = fileHead.cards.map((item) =>
      item.id === 'final' ? fileCard('final', 'artifacts/decision.md') : item,
    )
    const { service } = await fixture(fileHead)

    await expect(
      service.create({
        title: '文件成果流程',
        sourceBoardId: 'board-1',
        transformationIds: ['transformation-source', 'transformation-final'],
      }),
    ).resolves.toMatchObject({ title: '文件成果流程' })
  })

  it('lists, gets, and deletes templates through one service contract', async () => {
    const { workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())

    await expect(service.list()).resolves.toEqual([template()])
    await expect(service.get('workflow-research')).resolves.toEqual(template())
    await expect(service.delete('workflow-research')).resolves.toEqual({
      deletedWorkflowId: 'workflow-research',
    })
    await expect(service.get('workflow-research')).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    })
  })

  it('atomically creates a direct three-step plan as ordinary empty cards and transformations', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    const save = vi.spyOn(boardStore, 'save')
    save.mockClear()

    const created = await service.createPlan('board-1', directPlan())

    expect(Object.keys(created).sort()).toEqual([
      'planId',
      'targetCards',
      'title',
      'transformations',
    ])
    expect(created.planId).toEqual(expect.any(String))
    expect(created.title).toBe('访谈到简报')
    expect(created.targetCards).toEqual([
      expect.objectContaining({ id: 'card-1', x: 600, y: 120, headVersionId: null, versions: [] }),
      expect.objectContaining({ id: 'card-2', x: 1192, y: 120, headVersionId: null, versions: [] }),
      expect.objectContaining({ id: 'card-3', x: 1784, y: 120, headVersionId: null, versions: [] }),
    ])
    expect(created.transformations).toEqual([
      expect.objectContaining({
        id: 'transformation-1',
        sourceCardIds: ['source-b', 'source-a'],
        targetCardId: 'card-1',
        label: '提取证据',
        instruction: '从访谈中提取关键证据',
        acceptance: '包含原话和来源',
        modelId: 'reasoning-model',
        planRef: {
          planId: created.planId,
          source: 'ad-hoc',
          title: '访谈到简报',
          stepIndex: 1,
          stepTotal: 3,
        },
      }),
      expect.objectContaining({
        id: 'transformation-2',
        sourceCardIds: ['card-1'],
        targetCardId: 'card-2',
        planRef: {
          planId: created.planId,
          source: 'ad-hoc',
          title: '访谈到简报',
          stepIndex: 2,
          stepTotal: 3,
        },
      }),
      expect.objectContaining({
        id: 'transformation-3',
        sourceCardIds: ['card-2'],
        targetCardId: 'card-3',
        planRef: {
          planId: created.planId,
          source: 'ad-hoc',
          title: '访谈到简报',
          stepIndex: 3,
          stepTotal: 3,
        },
      }),
    ])
    expect(created.transformations.every((item) => !item.workflowRef)).toBe(true)
    expect(created.transformations.every((item) => !item.lastRunId && !item.lastAppliedRunId)).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(await workflowStore.list()).toEqual([])

    const persisted = await boardStore.load('board-1')
    expect(persisted.cards.slice(-3)).toEqual(created.targetCards)
    expect(persisted.transformations.slice(-3)).toEqual(created.transformations)
    expect(validateBoardV2(persisted)).toEqual([])
  })

  it.each([
    ['a blank title', { title: '   ' }],
    ['no steps', { steps: [] }],
    ['a blank step instruction', {
      steps: [{ label: '提取证据', instruction: '   ', acceptance: '' }],
    }],
    ['a non-finite target position', { targetPosition: { x: Number.NaN, y: 120 } }],
  ])('rejects a direct plan with %s without writing the Board', async (_case, overrides) => {
    const { boardStore, service } = await fixture()
    const before = await boardStore.load('board-1')
    const save = vi.spyOn(boardStore, 'save')
    save.mockClear()

    await expect(service.createPlan('board-1', directPlan(overrides))).rejects.toMatchObject({
      code: 'PLAN_INVALID',
    })
    expect(save).not.toHaveBeenCalled()
    expect(await boardStore.load('board-1')).toEqual(before)
  })

  it('atomically applies a template as ordinary empty cards and linear transformations', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())
    const save = vi.spyOn(boardStore, 'save')
    save.mockClear()

    const applied = await service.apply('board-1', 'workflow-research', {
      sourceRefs: [
        { cardId: 'source-b', versionId: 'source-b-v1' },
        { cardId: 'source-a', versionId: 'source-a-v1' },
      ],
      targetPosition: { x: 600, y: 120 },
    })

    expect(Object.keys(applied).sort()).toEqual([
      'applicationId',
      'targetCards',
      'transformations',
      'workflow',
    ])
    expect(applied.workflow).toEqual(template())
    expect(applied.applicationId).toBe('workflow-application-1')
    expect(applied.targetCards).toEqual([
      expect.objectContaining({
        id: 'card-1',
        x: 600,
        y: 120,
        headVersionId: null,
        versions: [],
      }),
      expect.objectContaining({
        id: 'card-2',
        x: 1192,
        y: 120,
        headVersionId: null,
        versions: [],
      }),
    ])
    expect(applied.transformations).toEqual([
      expect.objectContaining({
        id: 'transformation-1',
        sourceCardIds: ['source-b', 'source-a'],
        targetCardId: 'card-1',
        label: '提炼问题',
        instruction: '从材料中提炼核心问题',
        acceptance: '包含问题和约束',
        modelId: 'reasoning-model',
        workflowRef: {
          workflowId: 'workflow-research',
          stepId: 'workflow-step-a',
          applicationId: 'workflow-application-1',
        },
      }),
      expect.objectContaining({
        id: 'transformation-2',
        sourceCardIds: ['card-1'],
        targetCardId: 'card-2',
        label: '形成决策',
        instruction: '把问题推进成决策',
        acceptance: '包含选择和依据',
        workflowRef: {
          workflowId: 'workflow-research',
          stepId: 'workflow-step-b',
          applicationId: 'workflow-application-1',
        },
      }),
    ])
    expect(applied.transformations.every((item) => !('lastRunId' in item))).toBe(true)
    expect(applied.transformations.every((item) => !('lastAppliedRunId' in item))).toBe(true)
    expect(applied.transformations.map((item) => item.planRef)).toEqual([
      {
        planId: 'workflow-application-1',
        source: 'template',
        title: '研究到决策',
        stepIndex: 1,
        stepTotal: 2,
      },
      {
        planId: 'workflow-application-1',
        source: 'template',
        title: '研究到决策',
        stepIndex: 2,
        stepTotal: 2,
      },
    ])
    expect(save).toHaveBeenCalledTimes(1)

    const persisted = await boardStore.load('board-1')
    expect(persisted.cards.slice(-2)).toEqual(applied.targetCards)
    expect(persisted.transformations.slice(-2)).toEqual(applied.transformations)
    expect(validateBoardV2(persisted)).toEqual([])

    const malformed = structuredClone(persisted)
    malformed.transformations.at(-1).workflowRef.stepId = ''
    expect(validateBoardV2(malformed)).toContain(
      'transformation transformation-2 has invalid workflowRef',
    )
  })

  it('expands explicit input bindings in each step source order without starting runs', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', contractedTemplate())

    const applied = await service.apply('board-1', 'workflow-research', {
      inputBindings: [
        { inputId: 'input-brief', sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }] },
        { inputId: 'input-evidence', sourceRefs: [{ cardId: 'source-b', versionId: 'source-b-v1' }] },
      ],
      targetPosition: { x: 600, y: 120 },
    })

    expect(applied.transformations.map((item) => item.sourceCardIds)).toEqual([
      ['source-a', 'source-b'],
      ['card-1', 'source-b'],
    ])
    expect(applied.transformations.every((item) => !item.lastRunId)).toBe(true)
    expect((await boardStore.load('board-1')).transformations.slice(-2))
      .toEqual(applied.transformations)
  })

  it('rejects incomplete named input bindings without writing partial plan objects', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', contractedTemplate())
    const before = await boardStore.load('board-1')

    await expect(service.apply('board-1', 'workflow-research', {
      inputBindings: [{
        inputId: 'input-brief',
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
      }],
      targetPosition: { x: 600, y: 120 },
    })).rejects.toMatchObject({ code: 'WORKFLOW_BINDING_INVALID' })
    expect(await boardStore.load('board-1')).toEqual(before)
  })

  it('keeps the requested plan position when every target card clears the Board', async () => {
    const { workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())

    const applied = await service.apply('board-1', 'workflow-research', {
      sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
      targetPosition: { x: 600, y: 120 },
    })

    expect(applied.targetCards.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 600, y: 120 },
      { x: 1192, y: 120 },
    ])
  })

  it('moves the whole plan down to the first row that clears every existing card', async () => {
    const crowded = linearBoard()
    const requestedRowBlocker = {
      ...card('blocker-requested', '已有成果'),
      x: 600,
      y: 120,
      width: 360,
      height: 240,
    }
    const firstShiftBlocker = {
      ...card('blocker-first-shift', '另一份已有成果'),
      x: 1040,
      y: 392,
      width: 360,
      height: 240,
    }
    crowded.cards.push(requestedRowBlocker, firstShiftBlocker)
    const existingCards = structuredClone(crowded.cards)
    const { workflowStore, service } = await fixture(crowded)
    await workflowStore.save('workflow-research', template())

    const applied = await service.apply('board-1', 'workflow-research', {
      sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
      targetPosition: { x: 600, y: 120 },
    })

    expect(applied.targetCards.map(({ x, y }) => ({ x, y }))).toEqual([
      { x: 600, y: 664 },
      { x: 1192, y: 664 },
    ])
    for (const target of applied.targetCards) {
      expect(existingCards.every((existing) => hasClearance(target, existing))).toBe(true)
    }
    expect(hasClearance(applied.targetCards[0], applied.targetCards[1])).toBe(true)
  })

  it('waits for an in-flight application Board commit before deleting its template', async () => {
    const { fs, boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())
    const commitEntered = deferred()
    const releaseCommit = deferred()
    const events = []
    const replace = fs.replace.bind(fs)
    fs.replace = vi.fn(async (from, to) => {
      if (to === 'boards-v2/board-1.json') {
        commitEntered.resolve()
        await releaseCommit.promise
        const result = await replace(from, to)
        events.push('board-committed')
        return result
      }
      return replace(from, to)
    })
    const remove = fs.remove.bind(fs)
    fs.remove = vi.fn(async (path) => {
      const result = await remove(path)
      events.push('workflow-deleted')
      return result
    })

    const applyPromise = service.apply('board-1', 'workflow-research', {
      sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
      targetPosition: { x: 600, y: 120 },
    })
    await commitEntered.promise
    const deletePromise = service.delete('workflow-research')
    await new Promise((resolve) => setTimeout(resolve, 0))
    releaseCommit.resolve()

    const [applied, deleted] = await Promise.all([applyPromise, deletePromise])
    expect(events).toEqual(['board-committed', 'workflow-deleted'])
    expect(applied.workflow.id).toBe('workflow-research')
    expect(deleted).toEqual({ deletedWorkflowId: 'workflow-research' })
    await expect(workflowStore.load('workflow-research')).rejects.toMatchObject({
      code: 'WORKFLOW_NOT_FOUND',
    })
    expect((await boardStore.load('board-1')).cards).toHaveLength(6)
  })

  it('rejects an application without writing its Board when deletion owns the lock first', async () => {
    const { fs, boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())
    const before = await boardStore.load('board-1')
    const deleteEntered = deferred()
    const releaseDelete = deferred()
    const remove = fs.remove.bind(fs)
    fs.remove = vi.fn(async (path) => {
      deleteEntered.resolve()
      await releaseDelete.promise
      return remove(path)
    })
    const update = vi.spyOn(boardStore, 'update')

    const deletePromise = service.delete('workflow-research')
    await deleteEntered.promise
    const applyOutcomePromise = service
      .apply('board-1', 'workflow-research', {
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
        targetPosition: { x: 600, y: 120 },
      })
      .then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const boardWritesBeforeDelete = update.mock.calls.length
    releaseDelete.resolve()

    await expect(deletePromise).resolves.toEqual({
      deletedWorkflowId: 'workflow-research',
    })
    const outcome = await applyOutcomePromise
    expect(boardWritesBeforeDelete).toBe(0)
    expect(outcome).toMatchObject({
      status: 'rejected',
      reason: { code: 'WORKFLOW_NOT_FOUND' },
    })
    expect(update).not.toHaveBeenCalled()
    expect(await boardStore.load('board-1')).toEqual(before)
  })

  it('rejects non-head source refs before saving any application objects', async () => {
    const { boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())
    const save = vi.spyOn(boardStore, 'save')
    save.mockClear()

    await expect(
      service.apply('board-1', 'workflow-research', {
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-old' }],
        targetPosition: { x: 600, y: 120 },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_VERSION_CHANGED' })
    await expect(
      service.apply('board-1', 'workflow-research', {
        sourceRefs: [],
        targetPosition: { x: 600, y: 120 },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_REQUIRED' })
    expect(save).not.toHaveBeenCalled()
    const board = await boardStore.load('board-1')
    expect(board.cards).toHaveLength(4)
    expect(board.transformations).toHaveLength(2)
  })

  it.each([
    ['blank markdown', card('source-a', '   ')],
    ['an empty file path', fileCard('source-a', '   ')],
  ])('rejects %s as an application source before writing the Board', async (_case, source) => {
    const board = linearBoard()
    board.cards = board.cards.map((item) => item.id === 'source-a' ? source : item)
    const { boardStore, workflowStore, service } = await fixture(board)
    await workflowStore.save('workflow-research', template())
    const save = vi.spyOn(boardStore, 'save')
    save.mockClear()

    await expect(
      service.apply('board-1', 'workflow-research', {
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
        targetPosition: { x: 600, y: 120 },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects a dangling application Head as SOURCE_READ_FAILED', async () => {
    const board = linearBoard()
    const source = board.cards.find((item) => item.id === 'source-a')
    source.headVersionId = 'source-missing'
    const boardStore = {
      update: vi.fn(async (_boardId, change) => change(structuredClone(board))),
      withLockedBoard: vi.fn(async (_boardId, change) => change(structuredClone(board))),
    }
    const workflowStore = {
      withLockedWorkflow: vi.fn(async (_workflowId, change) => change(template())),
    }
    const service = createWorkflowService({
      boardStore,
      workflowStore,
      newId: ids(),
      now: () => NOW,
    })

    await expect(
      service.apply('board-1', 'workflow-research', {
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-missing' }],
        targetPosition: { x: 600, y: 120 },
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_READ_FAILED' })
  })

  it('leaves the previous board intact when the single atomic application save fails', async () => {
    const { fs, boardStore, workflowStore, service } = await fixture()
    await workflowStore.save('workflow-research', template())
    const before = fs.files.get('boards-v2/board-1.json')
    const replace = fs.replace.bind(fs)
    fs.replace = vi.fn(async (from, to) => {
      if (to === 'boards-v2/board-1.json') throw new Error('disk unavailable')
      return replace(from, to)
    })

    await expect(
      service.apply('board-1', 'workflow-research', {
        sourceRefs: [{ cardId: 'source-a', versionId: 'source-a-v1' }],
        targetPosition: { x: 600, y: 120 },
      }),
    ).rejects.toMatchObject({ code: 'BOARD_V2_WRITE_FAILED' })
    expect(fs.files.get('boards-v2/board-1.json')).toBe(before)
    const board = await boardStore.load('board-1')
    expect(board.cards).toHaveLength(4)
    expect(board.transformations).toHaveLength(2)
  })
})
