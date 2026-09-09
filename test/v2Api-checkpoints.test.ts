import { afterEach, describe, expect, it, vi } from 'vitest'
import { v2Api } from '../src/v2Api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('BoardCheckpoint API client', () => {
  it('sends the complete checkpoint HTTP contract', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await v2Api.listCheckpoints('board-1')
    await v2Api.createCheckpoint('board-1', { title: '第一稿', note: '稳定', baseRevision: 3 })
    await v2Api.getCheckpoint('board-1', 'checkpoint-1')
    await v2Api.updateCheckpoint('board-1', 'checkpoint-1', {
      title: '定稿', note: null, baseMetadataUpdatedAt: 'now',
    })
    await v2Api.deleteCheckpoint('board-1', 'checkpoint-1')
    await v2Api.forkCheckpoint('board-1', 'checkpoint-1', { title: '副本' })
    await v2Api.exportCheckpoint('board-1', 'checkpoint-1')

    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ['/graphmind/api/v2/boards/board-1/checkpoints', 'GET'],
      ['/graphmind/api/v2/boards/board-1/checkpoints', 'POST'],
      ['/graphmind/api/v2/boards/board-1/checkpoints/checkpoint-1', 'GET'],
      ['/graphmind/api/v2/boards/board-1/checkpoints/checkpoint-1', 'PATCH'],
      ['/graphmind/api/v2/boards/board-1/checkpoints/checkpoint-1', 'DELETE'],
      ['/graphmind/api/v2/boards/board-1/checkpoints/checkpoint-1/forks', 'POST'],
      ['/graphmind/api/v2/boards/board-1/checkpoints/checkpoint-1/export', 'GET'],
    ])
    expect(JSON.parse(String(fetch.mock.calls[4][1]?.body))).toEqual({
      confirmation: 'delete-checkpoint',
    })
  })
})
