import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { V2Suggestion } from '../v2Api'
import * as contextDock from './ContextDock'

const suggestion: V2Suggestion = {
  id: 'summarize',
  label: '提炼问题',
  instruction: '提炼问题',
  acceptance: '',
}

type CreateStepPendingRef = { current: boolean }
type SubmitCreateStep = (
  pending: CreateStepPendingRef,
  setPending: (value: boolean) => void,
  value: V2Suggestion,
  generate: (value: V2Suggestion) => Promise<void>,
) => Promise<void>

type SingleStepControlsProps = {
  suggestions: V2Suggestion[]
  suggestionState: 'idle' | 'loading' | 'ready' | 'error'
  custom: string
  pending: boolean
  onCustomChange: (value: string) => void
  onCreate: (value: V2Suggestion) => void
  onStartBranch: () => void
}

describe('context dock single-step creation', () => {
  it('allows only one create request through the shared pending gate', async () => {
    const submitCreateStep = (contextDock as unknown as {
      submitCreateStep?: SubmitCreateStep
    }).submitCreateStep
    expect(submitCreateStep).toBeTypeOf('function')
    if (!submitCreateStep) return

    let release!: () => void
    const firstRequest = new Promise<void>((resolve) => { release = resolve })
    const generate = vi.fn()
      .mockImplementationOnce(() => firstRequest)
      .mockResolvedValue(undefined)
    const pending = { current: false }
    const pendingChanges: boolean[] = []
    const setPending = (value: boolean) => pendingChanges.push(value)

    const first = submitCreateStep(pending, setPending, suggestion, generate)
    const repeated = submitCreateStep(
      pending,
      setPending,
      { ...suggestion, id: 'custom', label: '自定义成果' },
      generate,
    )

    expect(generate).toHaveBeenCalledTimes(1)
    expect(generate).toHaveBeenCalledWith(suggestion)
    expect(pendingChanges).toEqual([true])

    release()
    await Promise.all([first, repeated])
    expect(pendingChanges).toEqual([true, false])

    await submitCreateStep(pending, setPending, suggestion, generate)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('disables every single-step input and names suggestion actions while creating', () => {
    const SingleStepControls = (contextDock as unknown as {
      SingleStepControls?: (props: SingleStepControlsProps) => ReturnType<typeof createElement>
    }).SingleStepControls
    expect(SingleStepControls).toBeTypeOf('function')
    if (!SingleStepControls) return

    const html = renderToStaticMarkup(createElement(SingleStepControls, {
      suggestions: [suggestion],
      suggestionState: 'ready',
      custom: '整理结论',
      pending: true,
      onCustomChange: () => undefined,
      onCreate: () => undefined,
      onStartBranch: () => undefined,
    }))
    const suggestionButton = html.match(/<button[^>]*aria-label="添加步骤：提炼问题"[^>]*>/)?.[0]
    const customInput = html.match(/<input[^>]*aria-label="自定义成果"[^>]*>/)?.[0]

    expect(html).toContain('aria-busy="true"')
    expect(suggestionButton).toContain('disabled')
    expect(customInput).toContain('disabled')
    expect(html).toContain('添加中…')
  })
})
