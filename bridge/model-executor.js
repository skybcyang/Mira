function textContent(content) {
  return (content || [])
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

export function lastAssistantText(events) {
  let best = ''
  for (let index = (events || []).length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type !== 'assistant/message') continue
    const text = textContent(event.data && event.data.message && event.data.message.content)
    if (text.length > best.length) best = text
  }
  return best
}

export function summarizeExecutionEvent(event) {
  const type = String((event && event.type) || '')
  if (!type || type.includes('reasoning')) return null
  if (type === 'turn/start') {
    return { phase: 'generating', label: '开始组织内容' }
  }
  if (type === 'assistant/message') {
    return { phase: 'generating', label: '内容草稿有了新进展' }
  }
  if (type === 'turn/end') {
    return event?.data?.reason?.kind === 'error'
      ? { phase: 'reviewing', label: '模型请求未成功，正在整理错误' }
      : { phase: 'reviewing', label: '内容生成完成，正在检查结果' }
  }
  if (type === 'llm/retry') {
    const retry = event?.data?.retry
    const maxRetries = event?.data?.maxRetries
    const timedOut = event?.data?.failure?.code === 'TIMEOUT'
    return {
      phase: 'generating',
      label: timedOut ? '模型请求超时，正在自动重试' : '模型请求未成功，正在自动重试',
      detail:
        Number.isInteger(retry) && Number.isInteger(maxRetries)
          ? `第 ${retry} / ${maxRetries} 次`
          : undefined,
    }
  }
  if (type.includes('tool')) {
    const detail = event?.data?.name || event?.data?.toolName || event?.data?.tool?.name
    return {
      phase: 'generating',
      label: '正在使用工具',
      detail: detail ? String(detail).slice(0, 80) : undefined,
    }
  }
  return null
}

function terminalExecutionError(event) {
  const reason = event?.data?.reason
  if (reason?.kind !== 'error') return null
  const failure = reason.error || reason.failure || {}
  const code = failure.code || 'MODEL_EXECUTION_FAILED'
  const messages = {
    TIMEOUT: '模型请求超时，已自动重试；请稍后再次生成。',
    RATE_LIMIT: '模型服务繁忙，已自动重试；请稍后再次生成。',
  }
  return Object.assign(new Error(messages[code] || failure.message || '模型执行未完成。'), { code })
}

export function createModelExecutor({
  store,
  rootRegistry,
  subagents,
  sessionQuery,
  turnWaiter,
  provider,
  makeSignal,
  timeoutMs = 300_000,
}) {
  return async function executeFresh({ boardId, subject, prompt, toolFilter, signal, onProgress }) {
    const board = await store.load(boardId)
    const parent = await rootRegistry.ensure(boardId, board)
    await onProgress?.({ phase: 'preparing', label: '执行环境已准备' })
    const started = await subagents.startContinuable({
      provider,
      label: subject.goal || subject.id,
      request: {
        prompt: [{ type: 'text', text: prompt }],
        parent,
        toolFilter,
      },
      signal: signal || makeSignal(),
    })
    await onProgress?.({
      phase: 'generating',
      label: '执行任务已启动',
      sessionId: started.childId,
    })
    let progressQueue = Promise.resolve()
    const unsubscribe = turnWaiter.subscribe?.(started.childId, (event) => {
      const summary = summarizeExecutionEvent(event)
      if (!summary || !onProgress) return
      progressQueue = progressQueue.then(() => onProgress(summary))
    })
    const interrupt = () => {
      if (subagents && typeof subagents.interrupt === 'function') {
        try {
          const result = subagents.interrupt(started.childId, {
            kind: 'ancestor',
            agent: parent,
          })
          void Promise.resolve(result).catch(() => {})
        } catch {
          // Cancellation is best-effort; the timeout still releases the caller.
        }
      }
    }
    if (signal?.aborted) interrupt()
    else signal?.addEventListener('abort', interrupt, { once: true })
    let terminal
    try {
      terminal = await turnWaiter.wait(started.childId, { timeoutMs })
      await progressQueue
    } catch (error) {
      if (error?.code === 'MODEL_TIMEOUT') interrupt()
      throw error
    } finally {
      unsubscribe?.()
      signal?.removeEventListener('abort', interrupt)
    }
    const terminalError = terminalExecutionError(terminal)
    if (terminalError) throw terminalError
    const snapshot = await sessionQuery.readSession(started.childId)
    return {
      sessionId: started.childId,
      outputText: lastAssistantText(snapshot.events || []),
    }
  }
}
