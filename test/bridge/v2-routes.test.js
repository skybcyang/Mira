import { describe, expect, it, vi } from 'vitest'
import { dispatchV2Route } from '../../bridge/v2-routes.js'

describe('v2 route dispatcher', () => {
  it('routes the complete BoardCheckpoint surface before generic Board routes', async () => {
    const checkpointService = {
      list: vi.fn(async () => ({ checkpoints: [] })),
      create: vi.fn(async () => ({ checkpoint: { id: 'checkpoint-1' } })),
      get: vi.fn(async () => ({ checkpoint: { id: 'checkpoint-1' } })),
      update: vi.fn(async () => ({ checkpoint: { id: 'checkpoint-1', title: '新名称' } })),
      remove: vi.fn(async () => ({ deletedCheckpointId: 'checkpoint-1' })),
      fork: vi.fn(async () => ({ boardId: 'board-copy' })),
      exportArtifact: vi.fn(async () => ({ format: 'mira-board', formatVersion: 1 })),
    }
    const dependencies = { checkpointService, store: { load: vi.fn() } }
    const base = ['v2', 'boards', 'board-1', 'checkpoints']

    await expect(dispatchV2Route('GET', base, undefined, dependencies))
      .resolves.toMatchObject({ status: 200, body: { checkpoints: [] } })
    await expect(dispatchV2Route('POST', base, { title: '版本', baseRevision: 2 }, dependencies))
      .resolves.toMatchObject({ status: 201 })
    await dispatchV2Route('GET', [...base, 'checkpoint-1'], undefined, dependencies)
    await dispatchV2Route('PATCH', [...base, 'checkpoint-1'], { title: '新名称' }, dependencies)
    await dispatchV2Route('DELETE', [...base, 'checkpoint-1'], { confirmation: 'delete-checkpoint' }, dependencies)
    await dispatchV2Route('POST', [...base, 'checkpoint-1', 'forks'], { title: '副本' }, dependencies)
    await expect(dispatchV2Route('GET', [...base, 'checkpoint-1', 'export'], undefined, dependencies))
      .resolves.toMatchObject({ status: 200, body: { format: 'mira-board' } })

    expect(checkpointService.list).toHaveBeenCalledWith('board-1')
    expect(checkpointService.create).toHaveBeenCalledWith('board-1', { title: '版本', baseRevision: 2 })
    expect(checkpointService.get).toHaveBeenCalledWith('board-1', 'checkpoint-1')
    expect(checkpointService.update).toHaveBeenCalledWith('board-1', 'checkpoint-1', { title: '新名称' })
    expect(checkpointService.remove).toHaveBeenCalledWith('board-1', 'checkpoint-1', { confirmation: 'delete-checkpoint' })
    expect(checkpointService.fork).toHaveBeenCalledWith('board-1', 'checkpoint-1', { title: '副本' })
    expect(checkpointService.exportArtifact).toHaveBeenCalledWith('board-1', 'checkpoint-1')
    expect(dependencies.store.load).not.toHaveBeenCalled()
  })

  it('dispatches the permanent board purge command', async () => {
    const handlers = {
      purgeBoard: vi.fn().mockResolvedValue({ deletedBoardId: 'board-1', deletedRunIds: [] }),
    }
    const result = await dispatchV2Route('POST', ['v2', 'boards', 'board-1', 'purge'], {
      baseRevision: 3,
      confirmation: 'permanently-delete',
    }, { handlers })
    expect(result).toEqual({ status: 200, body: { deletedBoardId: 'board-1', deletedRunIds: [] } })
    expect(handlers.purgeBoard).toHaveBeenCalledWith('board-1', {
      baseRevision: 3,
      confirmation: 'permanently-delete',
    })
  })

  it('routes current board, card, and run commands without old aliases', async () => {
    const handlers = {
      createCard: vi.fn(async () => ({ card: { id: 'card-1' } })),
      deleteCard: vi.fn(async () => ({ deletedCardId: 'card-1' })),
      startRun: vi.fn(async () => ({ run: { id: 'run-1' } })),
      adoptCandidate: vi.fn(async () => ({ run: { id: 'run-1' } })),
    }
    const store = {
      listSummaries: vi.fn(async () => [{ id: 'board-1', title: '课题' }]),
      load: vi.fn(async () => ({ id: 'board-1' })),
    }
    const dependencies = { store, handlers }

    await expect(
      dispatchV2Route('GET', ['v2', 'boards'], undefined, dependencies),
    ).resolves.toMatchObject({ status: 200, body: { boards: [{ id: 'board-1' }] } })
    await dispatchV2Route(
      'POST',
      ['v2', 'boards', 'board-1', 'cards'],
      { markdown: '内容' },
      dependencies,
    )
    expect(handlers.createCard).toHaveBeenCalledWith('board-1', { markdown: '内容' })
    await dispatchV2Route(
      'DELETE',
      ['v2', 'boards', 'board-1', 'cards', 'card-1'],
      undefined,
      dependencies,
    )
    expect(handlers.deleteCard).toHaveBeenCalledWith('board-1', 'card-1')
    await dispatchV2Route(
      'POST',
      ['v2', 'boards', 'board-1', 'transformations', 'transformation-1', 'runs'],
      {},
      dependencies,
    )
    expect(handlers.startRun).toHaveBeenCalledWith('board-1', 'transformation-1', {})
    await dispatchV2Route(
      'POST',
      ['v2', 'runs', 'run-1', 'candidate', 'adopt'],
      { baseVersionId: 'v2' },
      dependencies,
    )
    expect(handlers.adoptCandidate).toHaveBeenCalledWith('run-1', { baseVersionId: 'v2' })
    await expect(dispatchV2Route(
      'POST',
      ['v2', 'migrations', 'legacy', 'preview'],
      {},
      dependencies,
    )).resolves.toMatchObject({ status: 404 })
  })

  it('returns null for non-v2 routes', async () => {
    await expect(dispatchV2Route('GET', ['boards'], undefined, {})).resolves.toBeNull()
  })

  it('routes board catalog, rename, archive, trash, and restore commands', async () => {
    const store = {
      listCatalogSummaries: vi.fn(async () => [{ id: 'board-1', state: 'archived' }]),
    }
    const handlers = {
      renameBoard: vi.fn(async () => ({ board: { id: 'board-1', title: '新标题' } })),
      archiveBoard: vi.fn(async () => ({ board: { id: 'board-1' } })),
      trashBoard: vi.fn(async () => ({ board: { id: 'board-1' } })),
      restoreBoard: vi.fn(async () => ({ board: { id: 'board-1' } })),
    }
    const dependencies = { store, handlers }

    await expect(dispatchV2Route(
      'GET', ['v2', 'boards', 'catalog'], undefined, dependencies,
    )).resolves.toMatchObject({ status: 200, body: { boards: [{ state: 'archived' }] } })
    await dispatchV2Route(
      'PATCH', ['v2', 'boards', 'board-1'], { title: '新标题', baseRevision: 2 }, dependencies,
    )
    for (const command of ['archive', 'trash', 'restore']) {
      await dispatchV2Route(
        'POST', ['v2', 'boards', 'board-1', command], { baseRevision: 2 }, dependencies,
      )
    }

    expect(handlers.renameBoard).toHaveBeenCalledWith('board-1', {
      title: '新标题', baseRevision: 2,
    })
    expect(handlers.archiveBoard).toHaveBeenCalledWith('board-1', { baseRevision: 2 })
    expect(handlers.trashBoard).toHaveBeenCalledWith('board-1', { baseRevision: 2 })
    expect(handlers.restoreBoard).toHaveBeenCalledWith('board-1', { baseRevision: 2 })
  })

  it('routes Board export/import and workspace backup before generic Board IDs', async () => {
    const artifact = { format: 'mira-board', formatVersion: 1 }
    const backup = { format: 'mira-backup', formatVersion: 1 }
    const boardPortabilityService = {
      exportBoard: vi.fn(async () => artifact),
      importBoard: vi.fn(async () => ({ boardId: 'imported-board', board: { id: 'imported-board' } })),
    }
    const backupService = { exportBackup: vi.fn(async () => backup) }
    const store = { load: vi.fn() }
    const dependencies = { boardPortabilityService, backupService, store }

    await expect(dispatchV2Route(
      'GET', ['v2', 'boards', 'board-1', 'export'], undefined, dependencies,
    )).resolves.toEqual({ status: 200, body: artifact })
    await expect(dispatchV2Route(
      'POST', ['v2', 'boards', 'imports'], { artifact }, dependencies,
    )).resolves.toMatchObject({ status: 201, body: { boardId: 'imported-board' } })
    await expect(dispatchV2Route(
      'GET', ['v2', 'backup'], undefined, dependencies,
    )).resolves.toEqual({ status: 200, body: backup })

    expect(boardPortabilityService.exportBoard).toHaveBeenCalledWith('board-1')
    expect(boardPortabilityService.importBoard).toHaveBeenCalledWith({ artifact })
    expect(backupService.exportBackup).toHaveBeenCalledOnce()
    expect(store.load).not.toHaveBeenCalled()
  })

  it('routes atomic card group creation, movement, and deletion', async () => {
    const handlers = {
      createCards: vi.fn(async () => ({ cards: [] })),
      restoreCards: vi.fn(async () => ({ cards: [{ id: 'card-1' }] })),
      readCardContent: vi.fn(async () => ({ content: '# Source' })),
      updateCards: vi.fn(async () => ({ cards: [] })),
      deleteCards: vi.fn(async () => ({ deletedCardIds: ['card-1'] })),
    }
    const dependencies = { handlers }

    await expect(dispatchV2Route(
      'POST',
      ['v2', 'boards', 'board-1', 'cards', 'batch'],
      { cards: [{ x: 10, y: 20 }] },
      dependencies,
    )).resolves.toMatchObject({ status: 201 })
    await dispatchV2Route(
      'POST',
      ['v2', 'boards', 'board-1', 'cards', 'restore'],
      { restoreReceiptId: 'receipt-1' },
      dependencies,
    )
    await dispatchV2Route(
      'GET',
      ['v2', 'boards', 'board-1', 'cards', 'card-1', 'content'],
      undefined,
      dependencies,
    )
    await dispatchV2Route(
      'PATCH',
      ['v2', 'boards', 'board-1', 'cards'],
      { updates: [{ cardId: 'card-1', x: 40, y: 50 }] },
      dependencies,
    )
    await dispatchV2Route(
      'DELETE',
      ['v2', 'boards', 'board-1', 'cards'],
      { cardIds: ['card-1'] },
      dependencies,
    )

    expect(handlers.createCards).toHaveBeenCalledWith('board-1', {
      cards: [{ x: 10, y: 20 }],
    })
    expect(handlers.restoreCards).toHaveBeenCalledWith('board-1', {
      restoreReceiptId: 'receipt-1',
    })
    expect(handlers.readCardContent).toHaveBeenCalledWith('board-1', 'card-1')
    expect(handlers.updateCards).toHaveBeenCalledWith('board-1', {
      updates: [{ cardId: 'card-1', x: 40, y: 50 }],
    })
    expect(handlers.deleteCards).toHaveBeenCalledWith('board-1', {
      cardIds: ['card-1'],
    })
  })

  it('routes transformation edits and transformation deletion', async () => {
    const updated = { id: 'transformation-1', label: '新步骤' }
    const handlers = {
      updateTransformation: vi.fn(async () => ({ transformation: updated })),
      updateTransformationPosition: vi.fn(async () => ({
        transformation: { ...updated, x: 360, y: 180 },
      })),
      deleteTransformation: vi.fn(async () => ({
        deletedTransformationId: 'transformation-1',
      })),
    }
    const dependencies = { handlers }
    const patch = {
      baseUpdatedAt: '2026-08-23T02:00:00.000Z',
      label: '新步骤',
      sourceRefs: [{ cardId: 'source-1', versionId: 'source-1-v2' }],
    }

    await expect(
      dispatchV2Route(
        'PATCH',
        ['v2', 'boards', 'board-1', 'transformations', 'transformation-1'],
        patch,
        dependencies,
      ),
    ).resolves.toEqual({ status: 200, body: { transformation: updated } })
    expect(handlers.updateTransformation).toHaveBeenCalledWith(
      'board-1',
      'transformation-1',
      patch,
    )

    await expect(
      dispatchV2Route(
        'PATCH',
        ['v2', 'boards', 'board-1', 'transformations', 'transformation-1', 'position'],
        { x: 360, y: 180 },
        dependencies,
      ),
    ).resolves.toMatchObject({ status: 200 })
    expect(handlers.updateTransformationPosition).toHaveBeenCalledWith(
      'board-1',
      'transformation-1',
      { x: 360, y: 180 },
    )

    await expect(
      dispatchV2Route(
        'DELETE',
        ['v2', 'boards', 'board-1', 'transformations', 'transformation-1'],
        undefined,
        dependencies,
      ),
    ).resolves.toEqual({
      status: 200,
      body: { deletedTransformationId: 'transformation-1' },
    })
    expect(handlers.deleteTransformation).toHaveBeenCalledWith(
      'board-1',
      'transformation-1',
    )

  })

  it('routes parallel transformation creation to the batch handler', async () => {
    const created = { transformations: [{ id: 'transformation-1' }], targetCards: [{ id: 'card-1' }] }
    const handlers = { createTransformations: vi.fn(async () => created) }

    await expect(dispatchV2Route(
      'POST',
      ['v2', 'boards', 'board-1', 'transformations', 'batch'],
      { transformations: [] },
      { handlers },
    )).resolves.toEqual({ status: 201, body: created })
    expect(handlers.createTransformations).toHaveBeenCalledWith('board-1', { transformations: [] })
  })

  it('routes workspace inspiration pool read to its handler', async () => {
    const pool = { schemaVersion: 1, id: 'inspiration-pool', entries: [] }
    const inspirationPoolHandlers = { getPool: vi.fn(async () => ({ pool })) }

    await expect(dispatchV2Route(
      'GET',
      ['v2', 'inspiration-pool'],
      undefined,
      { inspirationPoolHandlers },
    )).resolves.toEqual({ status: 200, body: { pool } })
    expect(inspirationPoolHandlers.getPool).toHaveBeenCalledOnce()
  })

  it('routes inspiration pool entry creation to its handler', async () => {
    const entry = { id: 'entry-1' }
    const inspirationPoolHandlers = { createEntry: vi.fn(async () => ({ entry })) }

    await expect(dispatchV2Route(
      'POST',
      ['v2', 'inspiration-pool', 'entries'],
      { markdown: '独立灵感', tags: [] },
      { inspirationPoolHandlers },
    )).resolves.toEqual({ status: 201, body: { entry } })
    expect(inspirationPoolHandlers.createEntry).toHaveBeenCalledWith({
      markdown: '独立灵感',
      tags: [],
    })
  })

  it('does not expose ordinary relation routes', async () => {
    const handlers = {
      createRelation: vi.fn(),
      deleteRelation: vi.fn(),
    }

    await expect(
      dispatchV2Route(
        'POST',
        ['v2', 'boards', 'board-1', 'relations'],
        { fromCardId: 'card-1', toCardId: 'card-2', kind: 'reference' },
        { handlers },
      ),
    ).resolves.toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'POST /v2/boards/board-1/relations' },
    })

    await expect(
      dispatchV2Route(
        'DELETE',
        ['v2', 'boards', 'board-1', 'relations', 'relation-1'],
        undefined,
        { handlers },
      ),
    ).resolves.toEqual({
      status: 404,
      body: { code: 'NOT_FOUND', message: 'DELETE /v2/boards/board-1/relations/relation-1' },
    })
    expect(handlers.createRelation).not.toHaveBeenCalled()
    expect(handlers.deleteRelation).not.toHaveBeenCalled()
  })

  it('routes global workflow templates and explicit board applications', async () => {
    const workflow = {
      id: 'workflow-1',
      title: '研究到决策',
      description: '把材料推进成决策',
      steps: [
        {
          id: 'workflow-step-1',
          label: '形成决策',
          instruction: '综合材料形成决策',
          acceptance: '保留关键约束',
        },
      ],
      createdAt: '2026-08-23T04:00:00.000Z',
      updatedAt: '2026-08-23T04:00:00.000Z',
    }
    const application = {
      applicationId: 'workflow-application-1',
      workflow,
      transformations: [
        {
          id: 'transformation-result',
          workflowRef: {
            workflowId: workflow.id,
            stepId: 'workflow-step-1',
            applicationId: 'workflow-application-1',
          },
        },
      ],
      targetCards: [{ id: 'card-result' }],
    }
    const workflowService = {
      list: vi.fn(async () => [workflow]),
      create: vi.fn(async () => workflow),
      get: vi.fn(async () => workflow),
      delete: vi.fn(async () => ({ deletedWorkflowId: workflow.id })),
      apply: vi.fn(async () => application),
    }
    const dependencies = { workflowService }

    await expect(
      dispatchV2Route('GET', ['v2', 'workflows'], undefined, dependencies),
    ).resolves.toEqual({ status: 200, body: { workflows: [workflow] } })

    const createBody = {
      title: '研究到决策',
      description: '把材料推进成决策',
      sourceBoardId: 'board-1',
      transformationIds: ['transformation-1'],
    }
    await expect(
      dispatchV2Route('POST', ['v2', 'workflows'], createBody, dependencies),
    ).resolves.toEqual({ status: 201, body: { workflow } })
    expect(workflowService.create).toHaveBeenCalledWith(createBody)

    await expect(
      dispatchV2Route('GET', ['v2', 'workflows', 'workflow-1'], undefined, dependencies),
    ).resolves.toEqual({ status: 200, body: { workflow } })
    await expect(
      dispatchV2Route('DELETE', ['v2', 'workflows', 'workflow-1'], undefined, dependencies),
    ).resolves.toEqual({
      status: 200,
      body: { deletedWorkflowId: 'workflow-1' },
    })

    const applyBody = {
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      targetPosition: { x: 600, y: 120 },
    }
    await expect(
      dispatchV2Route(
        'POST',
        ['v2', 'boards', 'board-2', 'workflows', 'workflow-1', 'applications'],
        applyBody,
        dependencies,
      ),
    ).resolves.toEqual({ status: 201, body: application })
    expect(workflowService.apply).toHaveBeenCalledWith('board-2', 'workflow-1', applyBody)
  })

  it('routes direct plan creation as a Board command', async () => {
    const planBody = {
      title: '访谈到简报',
      sourceRefs: [{ cardId: 'source', versionId: 'source-v1' }],
      steps: [
        { label: '提取证据', instruction: '提取关键证据', acceptance: '' },
        { label: '生成简报', instruction: '形成一页简报', acceptance: '' },
      ],
      targetPosition: { x: 600, y: 120 },
    }
    const result = {
      planId: 'plan-1',
      title: '访谈到简报',
      transformations: [{ id: 'transformation-1' }, { id: 'transformation-2' }],
      targetCards: [{ id: 'card-1' }, { id: 'card-2' }],
    }
    const workflowService = {
      createPlan: vi.fn(async () => result),
    }

    await expect(
      dispatchV2Route(
        'POST',
        ['v2', 'boards', 'board-2', 'plans'],
        planBody,
        { workflowService },
      ),
    ).resolves.toEqual({ status: 201, body: result })
    expect(workflowService.createPlan).toHaveBeenCalledWith('board-2', planBody)
  })
})
