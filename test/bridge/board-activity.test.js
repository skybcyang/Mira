import { describe, expect, it } from 'vitest'
import { summarizeBoardActivity } from '../../bridge/domain/board-activity.js'
import { dispatchV2Route } from '../../bridge/v2-routes.js'
import { createV2Handlers } from '../../bridge/v2-http.js'

describe('board activity summary', () => {
  it('fails closed on unreadable run storage', async () => {
    const handlers = createV2Handlers({runStore:{listStrict:async()=>{throw Error('corrupt run')}}})
    await expect(handlers.getBoardActivity()).rejects.toThrow('corrupt run')
  })
  it('counts queued/running and unhandled candidates without exposing results', () => {
    expect(summarizeBoardActivity([
      {boardId:'a',status:'queued'}, {boardId:'a',status:'running'},
      {boardId:'a',status:'succeeded',result:{disposition:'candidate',output:'private'}},
      {boardId:'a',status:'succeeded',result:{disposition:'applied'}},
      {boardId:'b',status:'failed'},
    ])).toEqual({a:{activeRuns:2,pendingCandidates:1}})
  })
  it('routes activity before the generic board read', async () => {
    expect(await dispatchV2Route('GET',['v2','boards','activity'],undefined,{handlers:{getBoardActivity:async()=>({activity:{}})}}))
      .toEqual({status:200,body:{activity:{}}})
  })
})
