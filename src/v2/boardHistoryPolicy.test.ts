import { describe, expect, it } from 'vitest'
import type { TransformationRun } from '../domain'
import {
  checkpointSaveBlocker,
  checkpointSaveBlockerFromStatus,
  checkpointSaveResolution,
  checkpointSaveResolutionFromStatus,
  defaultCheckpointForkTitle,
  normalizeCheckpointDraft,
} from './boardHistoryPolicy'

const run = (status: TransformationRun['status'], disposition?: 'candidate' | 'applied') => ({
  status,
  result: disposition ? { disposition } : undefined,
}) as TransformationRun

describe('normalizeCheckpointDraft', () => {
  it('trims valid names and notes', () => {
    expect(normalizeCheckpointDraft(' 第一稿 ', ' 稳定版本 ')).toEqual({
      title: '第一稿',
      note: '稳定版本',
    })
  })

  it('rejects blank or oversized user text by Unicode characters', () => {
    expect(normalizeCheckpointDraft('  ', '')).toEqual({
      title: '',
      note: undefined,
      error: '请输入画布版本名称。',
    })
    expect(normalizeCheckpointDraft('版'.repeat(81), '')?.error).toBe('名称不能超过 80 个字符。')
    expect(normalizeCheckpointDraft('版本', '注'.repeat(241))?.error).toBe('备注不能超过 240 个字符。')
  })
})

describe('checkpointSaveBlocker', () => {
  it('allows only a stable active Board below the explicit limit', () => {
    expect(checkpointSaveBlocker('active', [], 19)).toBeNull()
    expect(checkpointSaveBlocker('archived', [], 0)).toBe('只有工作中的画板可以保存新版本。')
    expect(checkpointSaveBlocker('active', [run('running')], 0))
      .toBe('生成结束或停止后才能保存稳定版本。')
    expect(checkpointSaveBlocker('active', [run('succeeded', 'candidate')], 0))
      .toBe('先采用或丢弃待比较结果。')
    expect(checkpointSaveBlocker('active', [], 20))
      .toBe('每个画板最多保存 20 个版本，请先删除不再需要的版本。')
  })

  it('points blocked saves to the active run before a pending Candidate', () => {
    const active = { ...run('running'), id: 'run-active' }
    const candidate = { ...run('succeeded', 'candidate'), id: 'run-candidate' }

    expect(checkpointSaveResolution([candidate, active])).toEqual({
      runId: 'run-active',
      label: '查看运行',
    })
    expect(checkpointSaveResolution([candidate])).toEqual({
      runId: 'run-candidate',
      label: '比较待处理结果',
    })
    expect(checkpointSaveResolution([])).toBeNull()
  })

  it('maps server gating for a noncurrent Board without assuming its Runs are empty', () => {
    expect(checkpointSaveBlockerFromStatus({ allowed: true })).toBeNull()
    expect(checkpointSaveBlockerFromStatus({ allowed: false, reason: 'read-only' }))
      .toBe('只有工作中的画板可以保存新版本。')
    expect(checkpointSaveBlockerFromStatus({
      allowed: false, reason: 'active-run', runId: 'run-active',
    })).toBe('生成结束或停止后才能保存稳定版本。')
    expect(checkpointSaveBlockerFromStatus({
      allowed: false, reason: 'pending-candidate', runId: 'run-candidate',
    })).toBe('先采用或丢弃待比较结果。')
    expect(checkpointSaveBlockerFromStatus({ allowed: false, reason: 'limit' }))
      .toBe('每个画板最多保存 20 个版本，请先删除不再需要的版本。')
    expect(checkpointSaveResolutionFromStatus({
      allowed: false, reason: 'pending-candidate', runId: 'run-candidate',
    })).toEqual({ runId: 'run-candidate', label: '比较待处理结果' })
  })
})

describe('defaultCheckpointForkTitle', () => {
  it('adds the version-copy suffix without exceeding the Board title limit', () => {
    expect(defaultCheckpointForkTitle('研究课题')).toBe('研究课题 - 版本副本')
    expect([...defaultCheckpointForkTitle('题'.repeat(120))]).toHaveLength(120)
    expect(defaultCheckpointForkTitle('题'.repeat(120))).toMatch(/ - 版本副本$/)
  })
})
