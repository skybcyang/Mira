import { describe, expect, it } from 'vitest'
import * as behavior from './inspectorBehavior'

describe('contextual inspector selection', () => {
  it('follows an explicit single selection only while a card inspector is open', () => {
    expect(behavior.followCardSelection({ tab: 'content', cardId: 'a', mode: 'edit' }, ['b'], true)).toEqual({ tab: 'content', cardId: 'b', mode: 'read' })
    expect(behavior.followCardSelection({ tab: 'versions', cardId: 'a' }, ['b'], true)).toEqual({ tab: 'content', cardId: 'b', mode: 'read' })
    expect(behavior.followCardSelection(null, ['b'], true)).toBeNull()
    expect(behavior.followCardSelection({ tab: 'content', cardId: 'a' }, ['a'], true)).toBeNull()
    expect(behavior.followCardSelection({ tab: 'content', cardId: 'a' }, ['b'], false)).toBeNull()
    expect(behavior.followCardSelection({ tab: 'content', cardId: 'a' }, ['a', 'b'], true)).toBeNull()
    expect(behavior.followCardSelection({ tab: 'run', runId: 'r' }, ['b'], true)).toBeNull()
  })
  it('returns from a transformation inspector to the explicitly selected content card', () => {
    expect(behavior.followCardSelection({ tab: 'relation', transformationId: 't' }, ['b'], true))
      .toEqual({ tab: 'content', cardId: 'b', mode: 'read' })
    expect(behavior.followCardSelection({ tab: 'relation', transformationId: 't' }, ['b'], false)).toBeNull()
    expect(behavior.followCardSelection({ tab: 'relation', transformationId: 't' }, ['a', 'b'], true)).toBeNull()
  })
})

describe('save before leaving the inspector', () => {
  it('saves only dirty fields in order and stops on a failed write', async () => {
    const saved: string[] = []
    const tasks = new Map([
      ['name', { dirty: true, save: async () => { saved.push('name'); return true } }],
      ['tags', { dirty: false, save: async () => { saved.push('tags'); return true } }],
      ['body', { dirty: true, save: async () => { saved.push('body'); return false } }],
      ['other', { dirty: true, save: async () => { saved.push('other'); return true } }],
    ])
    expect(await behavior.saveInspectorDrafts(tasks, () => true)).toBe(false)
    expect(saved).toEqual(['name', 'body'])
  })
  it('rejects busy drafts and context changes without writing another card', async () => {
    let calls = 0
    const task = { dirty: true, blocked: true, save: async () => { calls++; return true } }
    expect(await behavior.saveInspectorDrafts(new Map([['busy', task]]), () => true)).toBe(false)
    expect(calls).toBe(0)
    let current = true
    task.blocked = false
    task.save = async () => { calls++; current = false; return true }
    expect(await behavior.saveInspectorDrafts(new Map([['first', task], ['second', task]]), () => current)).toBe(false)
    expect(calls).toBe(1)
  })
  it('retains the task when a save throws and succeeds when every dirty field saves', async () => {
    expect(await behavior.saveInspectorDrafts(new Map([['bad', { dirty: true, save: async () => { throw new Error('offline') } }]]), () => true)).toBe(false)
    expect(await behavior.saveInspectorDrafts(new Map([['ok', { dirty: true, save: async () => true }]]), () => true)).toBe(true)
  })
})
