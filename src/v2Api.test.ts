import { afterEach, describe, expect, it, vi } from 'vitest'
import { v2Api } from './v2Api'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('model settings API', () => {
  it('reads, saves, and tests process-scoped model settings', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true, latencyMs: 80 }))
    vi.stubGlobal('fetch', fetch)
    const draft = {
      baseUrl: 'https://api.kimi.com/coding/v1',
      model: 'k3',
      apiKey: 'secret',
    }

    await v2Api.getModelSettings()
    await v2Api.saveModelSettings(draft)
    await v2Api.testModelSettings(draft)

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/model-settings', {
        method: 'GET',
        headers: undefined,
        body: undefined,
      }],
      ['/graphmind/api/v2/model-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      }],
      ['/graphmind/api/v2/model-settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(draft),
      }],
    ])
  })
})

describe('board lifecycle and portability API', () => {
  it('lists the active board summaries and the complete lifecycle catalog separately', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ boards: [] }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.listBoards()
    await v2Api.listBoardCatalog()

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards', {
        method: 'GET', headers: undefined, body: undefined,
      }],
      ['/graphmind/api/v2/boards/catalog', {
        method: 'GET', headers: undefined, body: undefined,
      }],
    ])
  })

  it('sends the visible revision with rename and lifecycle commands', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ board: { id: 'board-1' } }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.renameBoard('board-1', '新标题', 4)
    await v2Api.archiveBoard('board-1', 5)
    await v2Api.trashBoard('board-1', 6)
    await v2Api.restoreBoard('board-1', 7)
    await v2Api.purgeBoard('board-1', 8)

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards/board-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '新标题', baseRevision: 4 }),
      }],
      ['/graphmind/api/v2/boards/board-1/archive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 5 }),
      }],
      ['/graphmind/api/v2/boards/board-1/trash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 6 }),
      }],
      ['/graphmind/api/v2/boards/board-1/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 7 }),
      }],
      ['/graphmind/api/v2/boards/board-1/purge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRevision: 8, confirmation: 'permanently-delete' }),
      }],
    ])
  })

  it('exports, imports, and backs up through their dedicated JSON endpoints', async () => {
    const artifact = { format: 'mira-board', formatVersion: 1 }
    const fetch = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetch)

    await v2Api.exportBoard('board-1')
    await v2Api.importBoard(artifact)
    await v2Api.exportBackup()

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards/board-1/export', {
        method: 'GET', headers: undefined, body: undefined,
      }],
      ['/graphmind/api/v2/boards/imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artifact }),
      }],
      ['/graphmind/api/v2/backup', {
        method: 'GET', headers: undefined, body: undefined,
      }],
    ])
  })
})

describe('workflow API', () => {
  it('lists global templates independently from the current board', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ workflows: [] }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.listWorkflows()

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/workflows', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    })
  })

  it('reads one template by id', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ workflow: { id: 'workflow-1' } }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.getWorkflow('workflow-1')

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/workflows/workflow-1', {
      method: 'GET',
      headers: undefined,
      body: undefined,
    })
  })

  it('creates a global template from an ordered transformation chain', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ workflow: { id: 'workflow-1' } }, 201))
    vi.stubGlobal('fetch', fetch)

    await v2Api.createWorkflow({
      title: '研究简报',
      sourceBoardId: 'board-1',
      transformationIds: ['collect', 'review'],
      inputs: [{
        sourceCardId: 'source-a',
        name: '需求说明',
        description: '本次要解决的问题',
        required: true,
        cardinality: 'one',
      }],
    })

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/workflows', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '研究简报',
        sourceBoardId: 'board-1',
        transformationIds: ['collect', 'review'],
        inputs: [{
          sourceCardId: 'source-a',
          name: '需求说明',
          description: '本次要解决的问题',
          required: true,
          cardinality: 'one',
        }],
      }),
    })
  })

  it('applies a template as a plan using explicit named input bindings', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ board: { id: 'board-1' } }, 201))
    vi.stubGlobal('fetch', fetch)

    await v2Api.applyWorkflow('board-1', 'workflow-1', {
      inputBindings: [
        { inputId: 'workflow-input-1', sourceRefs: [
          { cardId: 'source-b', versionId: 'version-2' },
          { cardId: 'source-a', versionId: 'version-4' },
        ] },
      ],
      targetPosition: { x: 720, y: 180 },
    })

    expect(fetch).toHaveBeenCalledWith(
      '/graphmind/api/v2/boards/board-1/workflows/workflow-1/applications',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inputBindings: [
            { inputId: 'workflow-input-1', sourceRefs: [
              { cardId: 'source-b', versionId: 'version-2' },
              { cardId: 'source-a', versionId: 'version-4' },
            ] },
          ],
          targetPosition: { x: 720, y: 180 },
        }),
      },
    )
  })

  it('creates an ad-hoc plan atomically from ordered steps and explicit starting content', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({
      planId: 'plan-1',
      transformations: [],
      targetCards: [],
    }, 201))
    vi.stubGlobal('fetch', fetch)
    await v2Api.createPlan('board-1', {
      title: '研究简报计划',
      steps: [
        { label: '提取关键证据', instruction: '提取关键证据', acceptance: '' },
        { label: '形成判断', instruction: '形成判断', acceptance: '证据可追溯' },
        {
          label: '一页研究简报',
          instruction: '整理为可审阅简报',
          acceptance: '',
          modelId: 'reasoning-model',
        },
      ],
      sourceRefs: [
        { cardId: 'source-b', versionId: 'version-2' },
        { cardId: 'source-a', versionId: 'version-4' },
      ],
      targetPosition: { x: 720, y: 180 },
    })

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/boards/board-1/plans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '研究简报计划',
        steps: [
          { label: '提取关键证据', instruction: '提取关键证据', acceptance: '' },
          { label: '形成判断', instruction: '形成判断', acceptance: '证据可追溯' },
          {
            label: '一页研究简报',
            instruction: '整理为可审阅简报',
            acceptance: '',
            modelId: 'reasoning-model',
          },
        ],
        sourceRefs: [
          { cardId: 'source-b', versionId: 'version-2' },
          { cardId: 'source-a', versionId: 'version-4' },
        ],
        targetPosition: { x: 720, y: 180 },
      }),
    })
  })

  it('creates parallel transformation branches in one atomic request', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ transformations: [], targetCards: [] }, 201))
    vi.stubGlobal('fetch', fetch)
    const sourceRefs = [{ cardId: 'source', versionId: 'source-v1' }]
    const transformations = [
      { label: '用户流程', instruction: '拆解用户流程', acceptance: '步骤清晰', targetPosition: { x: 520, y: 80 } },
      { label: '技术方案', instruction: '拆解技术方案', acceptance: '约束完整', targetPosition: { x: 520, y: 352 } },
    ]

    await v2Api.createTransformations('board-1', { sourceRefs, transformations })

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/boards/board-1/transformations/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceRefs, transformations }),
    })
  })

  it('deletes a template without requiring a board context', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ deletedWorkflowId: 'workflow-1' }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.deleteWorkflow('workflow-1')

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/workflows/workflow-1', {
      method: 'DELETE',
      headers: undefined,
      body: undefined,
    })
  })
})

describe('structure editing API', () => {
  it('persists transformation canvas position independently from semantic edits', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ transformation: { id: 't1' } }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.updateTransformationPosition('board-1', 't1', { x: 360, y: 180 })

    expect(fetch).toHaveBeenCalledWith(
      '/graphmind/api/v2/boards/board-1/transformations/t1/position',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 360, y: 180 }),
      },
    )
  })

  it('patches transformation metadata and ordered source Head references', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ transformation: { id: 't1' } }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.updateTransformation('board-1', 't1', {
      baseUpdatedAt: '2026-08-23T00:00:00.000Z',
      label: '形成建议',
      instruction: '综合材料形成建议',
      acceptance: '建议可执行',
      sourceRefs: [
        { cardId: 'source-b', versionId: 'version-b' },
        { cardId: 'source-a', versionId: 'version-a' },
      ],
    })

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/boards/board-1/transformations/t1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUpdatedAt: '2026-08-23T00:00:00.000Z',
        label: '形成建议',
        instruction: '综合材料形成建议',
        acceptance: '建议可执行',
        sourceRefs: [
          { cardId: 'source-b', versionId: 'version-b' },
          { cardId: 'source-a', versionId: 'version-a' },
        ],
      }),
    })
  })

  it('deletes only the selected transformation', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ deletedTransformationId: 't1' }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.deleteTransformation('board-1', 't1')

    expect(fetch).toHaveBeenCalledWith('/graphmind/api/v2/boards/board-1/transformations/t1', {
      method: 'DELETE',
      headers: undefined,
      body: undefined,
    })
  })

})

describe('canvas card operation API', () => {
  it('serializes tags and inspiration provenance through existing card routes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ card: {}, cards: [] }))
    vi.stubGlobal('fetch', fetch)
    const inspirationRef = {
      boardId: 'pool-board', cardId: 'pool-card', versionId: 'pool-card-v2',
    }
    const card = {
      contentKind: 'markdown' as const,
      markdown: '灵感正文',
      tags: ['主意', '技术'],
      inspirationRef,
      x: 10,
      y: 20,
    }

    await v2Api.createCard('board-1', card)
    await v2Api.createCards('board-1', { cards: [card] })
    await v2Api.updateCard('board-1', 'card-1', { tags: ['约束', '事件'] })

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards/board-1/cards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(card),
      }],
      ['/graphmind/api/v2/boards/board-1/cards/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cards: [card] }),
      }],
      ['/graphmind/api/v2/boards/board-1/cards/card-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tags: ['约束', '事件'] }),
      }],
    ])
  })

  it('creates, moves, and deletes card groups through atomic collection routes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ cards: [] }))
    vi.stubGlobal('fetch', fetch)
    const cards = [{
      contentKind: 'markdown' as const,
      markdown: '内容',
      x: 10,
      y: 20,
      width: 300,
      height: 180,
    }]

    await v2Api.createCards('board-1', { cards })
    await v2Api.updateCards('board-1', {
      updates: [{ cardId: 'card-1', x: 40, y: 50 }],
    })
    await v2Api.deleteCards('board-1', { cardIds: ['card-1'] })

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards/board-1/cards/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cards }),
      }],
      ['/graphmind/api/v2/boards/board-1/cards', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ updates: [{ cardId: 'card-1', x: 40, y: 50 }] }),
      }],
      ['/graphmind/api/v2/boards/board-1/cards', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cardIds: ['card-1'] }),
      }],
    ])
  })

  it('restores exact cards by opaque receipt and reads a card Head through dedicated routes', async () => {
    const fetch = vi.fn().mockResolvedValue(jsonResponse({ cards: [] }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.restoreCards('board-1', { restoreReceiptId: 'receipt-1' })
    await v2Api.getCardContent('board-1', 'card-1')

    expect(fetch.mock.calls).toEqual([
      ['/graphmind/api/v2/boards/board-1/cards/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ restoreReceiptId: 'receipt-1' }),
      }],
      ['/graphmind/api/v2/boards/board-1/cards/card-1/content', {
        method: 'GET',
        headers: undefined,
        body: undefined,
      }],
    ])
  })
})
