import { describe, expect, it, vi } from 'vitest'
import {
  createModelExecutor,
  lastAssistantText,
  summarizeExecutionEvent,
} from '../../bridge/model-executor.js'

describe('model executor', () => {
  it('starts a fresh durable child with the enforced tool filter', async () => {
    const board = { id: 'board', runtime: {} }
    const parent = { id: 'root' }
    const store = { load: vi.fn(async () => board) }
    const rootRegistry = { ensure: vi.fn(async () => parent) }
    const subagents = {
      startContinuable: vi.fn(async () => ({ childId: 'child', messageId: 'message' })),
    }
    const turnWaiter = { wait: vi.fn(async () => ({ type: 'turn/end' })) }
    const sessionQuery = {
      readSession: vi.fn(async () => ({
        events: [
          { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'first' }] } } },
          {
            type: 'assistant/message',
            data: { message: { content: [{ type: 'text', text: '# Final artifact' }] } },
          },
        ],
      })),
    }
    const signal = { aborted: false }
    const execute = createModelExecutor({
      store,
      rootRegistry,
      subagents,
      sessionQuery,
      turnWaiter,
      provider: 'fork',
      makeSignal: () => signal,
    })

    await expect(
      execute({
        boardId: 'board',
        subject: { id: 'action', kind: 'action', goal: 'Make a brief' },
        prompt: 'Frozen prompt',
        toolFilter: { allow: [] },
      }),
    ).resolves.toEqual({ sessionId: 'child', outputText: '# Final artifact' })
    expect(rootRegistry.ensure).toHaveBeenCalledWith('board', board)
    expect(subagents.startContinuable).toHaveBeenCalledWith({
      provider: 'fork',
      label: 'Make a brief',
      request: {
        prompt: [{ type: 'text', text: 'Frozen prompt' }],
        parent,
        toolFilter: { allow: [] },
      },
      signal,
    })
    expect(turnWaiter.wait).toHaveBeenCalledWith('child', { timeoutMs: 300_000 })
  })

  it('returns the last non-empty assistant text', () => {
    expect(
      lastAssistantText([
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'usable' }] } } },
        { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '' }] } } },
      ]),
    ).toBe('usable')
  })

  it('maps execution events to safe progress summaries and hides reasoning events', () => {
    expect(summarizeExecutionEvent({ type: 'turn/start' })).toMatchObject({
      phase: 'generating',
      label: '开始组织内容',
    })
    expect(summarizeExecutionEvent({ type: 'tool/call', data: { name: 'read_file' } })).toMatchObject({
      phase: 'generating',
      label: '正在使用工具',
      detail: 'read_file',
    })
    expect(summarizeExecutionEvent({ type: 'assistant/message' })).toMatchObject({
      label: '内容草稿有了新进展',
    })
    expect(summarizeExecutionEvent({
      type: 'llm/retry',
      data: { retry: 2, maxRetries: 2, failure: { code: 'TIMEOUT' } },
    })).toMatchObject({
      phase: 'generating',
      label: '模型请求超时，正在自动重试',
      detail: '第 2 / 2 次',
    })
    expect(summarizeExecutionEvent({ type: 'assistant/reasoning', data: { text: 'private' } })).toBeNull()
  })

  it('surfaces a terminal provider timeout instead of reporting empty output', async () => {
    const execute = createModelExecutor({
      store: { load: vi.fn(async () => ({ id: 'board', runtime: {} })) },
      rootRegistry: { ensure: vi.fn(async () => ({ id: 'root' })) },
      subagents: { startContinuable: vi.fn(async () => ({ childId: 'child-timeout' })) },
      sessionQuery: { readSession: vi.fn() },
      turnWaiter: {
        subscribe: vi.fn(() => () => {}),
        wait: vi.fn(async () => ({
          type: 'turn/end',
          data: { reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'Request timed out.' } } },
        })),
      },
      provider: 'fork',
      makeSignal: () => new AbortController().signal,
    })

    await expect(execute({
      boardId: 'board',
      subject: { id: 'action', goal: 'Draft' },
      prompt: 'prompt',
      toolFilter: { allow: [] },
    })).rejects.toMatchObject({
      code: 'TIMEOUT',
      message: '模型请求超时，已自动重试；请稍后再次生成。',
    })
  })

  it('reports the child session and streamed progress to the runtime', async () => {
    let listener
    const onProgress = vi.fn(async () => {})
    const execute = createModelExecutor({
      store: { load: vi.fn(async () => ({ id: 'board', runtime: {} })) },
      rootRegistry: { ensure: vi.fn(async () => ({ id: 'root' })) },
      subagents: { startContinuable: vi.fn(async () => ({ childId: 'child-live' })) },
      sessionQuery: {
        readSession: vi.fn(async () => ({
          events: [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'done' }] } } }],
        })),
      },
      turnWaiter: {
        subscribe: vi.fn((_id, next) => {
          listener = next
          return () => {}
        }),
        wait: vi.fn(async () => {
          listener({ type: 'assistant/message' })
          return { type: 'turn/end' }
        }),
      },
      provider: 'fork',
      makeSignal: () => new AbortController().signal,
    })

    await execute({
      boardId: 'board',
      subject: { id: 'action', goal: 'Draft' },
      prompt: 'prompt',
      toolFilter: { allow: [] },
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'preparing',
      label: '执行环境已准备',
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'generating',
      sessionId: 'child-live',
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      label: '内容草稿有了新进展',
    }))
  })

  it('keeps the full artifact when a shorter completion note follows it', () => {
    expect(
      lastAssistantText([
        {
          type: 'assistant/message',
          data: {
            message: {
              content: [
                {
                  type: 'text',
                  text: '# 周末慢行路线\n\n## 路线总览\n从菜市场出发，经过老街和河边，最后在小馆结束。',
                },
              ],
            },
          },
        },
        {
          type: 'assistant/message',
          data: { message: { content: [{ type: 'text', text: '方案已生成完毕（见上方完整文本）。' }] } },
        },
      ]),
    ).toContain('## 路线总览')
  })

  it('interrupts the durable child when the caller aborts', async () => {
    let finishTurn
    const controller = new AbortController()
    const subagents = {
      startContinuable: vi.fn(async () => ({ childId: 'child-abort' })),
      interrupt: vi.fn(async () => {}),
    }
    const execute = createModelExecutor({
      store: { load: vi.fn(async () => ({ id: 'board', runtime: {} })) },
      rootRegistry: { ensure: vi.fn(async () => ({ id: 'root' })) },
      subagents,
      sessionQuery: { readSession: vi.fn(async () => ({ events: [] })) },
      turnWaiter: {
        wait: vi.fn(() => new Promise((resolve) => {
          finishTurn = resolve
        })),
      },
      provider: 'fork',
      makeSignal: () => new AbortController().signal,
    })

    const pending = execute({
      boardId: 'board',
      subject: { id: 'suggest', goal: 'Suggest' },
      prompt: 'prompt',
      toolFilter: { allow: [] },
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(subagents.startContinuable).toHaveBeenCalled())
    controller.abort()
    await vi.waitFor(() => expect(subagents.interrupt).toHaveBeenCalledWith('child-abort', {
      kind: 'ancestor',
      agent: { id: 'root' },
    }))
    finishTurn()
    await pending
  })

  it('interrupts the durable child when waiting for completion times out', async () => {
    const timeout = Object.assign(new Error('timed out'), { code: 'MODEL_TIMEOUT' })
    const subagents = {
      startContinuable: vi.fn(async () => ({ childId: 'child-stuck' })),
      interrupt: vi.fn(async () => {}),
    }
    const execute = createModelExecutor({
      store: { load: vi.fn(async () => ({ id: 'board', runtime: {} })) },
      rootRegistry: { ensure: vi.fn(async () => ({ id: 'root' })) },
      subagents,
      sessionQuery: { readSession: vi.fn() },
      turnWaiter: {
        subscribe: vi.fn(() => () => {}),
        wait: vi.fn(async () => {
          throw timeout
        }),
      },
      provider: 'fork',
      makeSignal: () => new AbortController().signal,
      timeoutMs: 25,
    })

    await expect(execute({
      boardId: 'board',
      subject: { id: 'stuck', goal: 'Draft' },
      prompt: 'prompt',
      toolFilter: { allow: [] },
    })).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' })
    expect(subagents.interrupt).toHaveBeenCalledWith('child-stuck', {
      kind: 'ancestor',
      agent: { id: 'root' },
    })
  })
})
