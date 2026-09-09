import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('detail drawer async actions', () => {
  it('offers the same guarded Stop action from relation and run views', async () => {
    const source = await readFile(new URL('./detail/RunPanel.tsx', import.meta.url), 'utf8')

    expect(source.match(/<RunStopButton/g)).toHaveLength(2)
    expect(source).toMatch(/run\.status === 'queued' \|\| run\.status === 'running'/)
    expect(source).toMatch(/onStop=\{\(\) => interrupt\(run\.id\)\}/)
    expect(source).toContain('正在停止…')
  })

  it('uses one pending lock for adopting or discarding a candidate', async () => {
    const source = await readFile(new URL('./detail/CandidateComparison.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/const \[decisionPending, setDecisionPending\]/)
    expect(source).toMatch(/runExclusiveAction\(decisionLock/)
    expect(source).toMatch(/disabled=\{disabled \|\| Boolean\(decisionPending\)/)
    expect(source).toContain('正在采用…')
    expect(source).toContain('正在丢弃…')
    expect(source).toMatch(/aria-busy=\{Boolean\(decisionPending\)\}/)
  })
})
