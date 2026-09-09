import { describe, expect, it, vi } from 'vitest'
import { createInspirationPoolHandlers } from '../../bridge/inspiration-pool-http.js'
import { dispatchV2Route } from '../../bridge/v2-routes.js'

const pool = { schemaVersion: 1, id: 'inspiration-pool', entries: [], createdAt: 'now', updatedAt: 'now' }

describe('inspiration pool HTTP', () => {
  it('loads and records without a Board id', async () => {
    const poolStore = {
      load: vi.fn(async () => pool),
      createEntry: vi.fn(async (input) => ({ id: 'entry-1', ...input })),
    }
    const handlers = createInspirationPoolHandlers({ poolStore })

    await expect(handlers.getPool()).resolves.toEqual({ pool })
    await expect(handlers.createEntry({ markdown: '独立灵感', tags: ['主意'] })).resolves
      .toEqual({ entry: { id: 'entry-1', markdown: '独立灵感', tags: ['主意'] } })
    expect(poolStore.createEntry).toHaveBeenCalledWith({ markdown: '独立灵感', tags: ['主意'] })
  })

  it('dispatches workspace pool routes without requiring boards', async () => {
    const handlers = {
      getPool: vi.fn(async () => ({ pool })),
      createEntry: vi.fn(async (body) => ({ entry: body })),
    }
    const response = await dispatchV2Route('POST', ['v2', 'inspiration-pool', 'entries'], {
      markdown: '一条想法', tags: [],
    }, { inspirationPoolHandlers: handlers })

    expect(response).toEqual({ status: 201, body: { entry: { markdown: '一条想法', tags: [] } } })
    expect(handlers.createEntry).toHaveBeenCalledWith({ markdown: '一条想法', tags: [] })
  })
})
