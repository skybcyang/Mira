import { describe, expect, it } from 'vitest'
import * as httpPolicy from '../../bridge/v2-http-policy.js'
import { runProgressErrors } from '../../bridge/domain/run-progress.js'
import { httpStatusForCode } from '../../bridge/mira-http.js'

const { cardIsRelated, nextUpdatedAt, parseSuggestions, safeRunProgress } = httpPolicy

function normalizeTags(value) {
  if (typeof httpPolicy.normalizeTags !== 'function') {
    throw new Error('normalizeTags wished-for API is missing')
  }
  return httpPolicy.normalizeTags(value)
}

describe('v2 HTTP policy', () => {
  it.each([
    ['CHECKPOINT_NOT_FOUND', 404],
    ['CHECKPOINT_INVALID', 422],
    ['CHECKPOINT_LIMIT', 409],
    ['CHECKPOINT_TOO_LARGE', 413],
    ['CHECKPOINT_CONFLICT', 409],
    ['CHECKPOINT_READ_FAILED', 500],
    ['CHECKPOINT_WRITE_FAILED', 500],
  ])('maps %s to HTTP %i', (code, status) => {
    expect(httpStatusForCode(code)).toBe(status)
  })

  it('only treats transformation references as card usage', () => {
    const board = {
      transformations: [{
        sourceCardIds: ['source-card'],
        targetCardId: 'target-card',
      }],
      relations: [{ fromCardId: 'free-card', toCardId: 'other-card' }],
    }

    expect(cardIsRelated(board, 'source-card')).toBe(true)
    expect(cardIsRelated(board, 'target-card')).toBe(true)
    expect(cardIsRelated(board, 'free-card')).toBe(false)
  })

  it('normalizes model suggestions at the transport boundary', () => {
    const suggestions = parseSuggestions(JSON.stringify([
      { label: '  综合 ', goal: ' 合并来源 ', accept: ' 可执行 ' },
      { label: '', instruction: 'ignored' },
      { label: '比较', instruction: '列出差异' },
      { label: '计划', instruction: '形成计划' },
      { label: 'extra', instruction: 'must be capped' },
    ]))

    expect(suggestions).toHaveLength(3)
    expect(suggestions[0]).toEqual({
      id: 'suggestion-1',
      label: '综合',
      instruction: '合并来源',
      acceptance: '可执行',
    })
  })

  it('keeps timestamps monotonic and progress payloads bounded', () => {
    expect(nextUpdatedAt('2026-08-25T00:00:00.000Z', '2026-08-24T00:00:00.000Z'))
      .toBe('2026-08-25T00:00:00.001Z')
    expect(safeRunProgress({ phase: 'run', label: ' working ', detail: ' detail ' }, 'now'))
      .toEqual({ phase: 'run', label: 'working', detail: 'detail', updatedAt: 'now' })
    expect(safeRunProgress({ phase: '', label: 'missing phase' }, 'now')).toBeNull()
  })

  it('keeps the latest twenty public progress events and mirrors the newest event', () => {
    expect(httpPolicy.appendRunProgress).toBeTypeOf('function')
    if (typeof httpPolicy.appendRunProgress !== 'function') return
    const progressEvents = Array.from({ length: 20 }, (_, index) => ({
      sequence: index + 1,
      phase: 'generating',
      label: `进度 ${index + 1}`,
      occurredAt: `2026-09-04T00:00:${String(index).padStart(2, '0')}.000Z`,
    }))

    const next = httpPolicy.appendRunProgress({ id: 'run-1', progressEvents }, {
      phase: ` ${'p'.repeat(50)} `,
      label: ` ${'l'.repeat(170)} `,
      detail: ` ${'d'.repeat(210)} `,
      prompt: 'must not persist',
      apiKey: 'secret',
      reasoning: 'private chain',
      toolPayload: { output: 'private tool output' },
    }, '2026-09-04T00:01:00.000Z')

    expect(next.progressEvents).toHaveLength(20)
    expect(next.progressEvents[0].sequence).toBe(2)
    expect(next.progressEvents.at(-1)).toEqual({
      sequence: 21,
      phase: 'p'.repeat(40),
      label: 'l'.repeat(160),
      detail: 'd'.repeat(200),
      occurredAt: '2026-09-04T00:01:00.000Z',
    })
    expect(next.progress).toEqual({
      phase: 'p'.repeat(40),
      label: 'l'.repeat(160),
      detail: 'd'.repeat(200),
      updatedAt: '2026-09-04T00:01:00.000Z',
    })
    expect(JSON.stringify(next)).not.toMatch(
      /must not persist|secret|private chain|private tool output/,
    )
  })

  it('bounds public progress by Unicode characters without splitting emoji', () => {
    expect(safeRunProgress({
      phase: '🚀'.repeat(41),
      label: '进'.repeat(161),
      detail: '✓'.repeat(201),
    }, 'now')).toEqual({
      phase: '🚀'.repeat(40),
      label: '进'.repeat(160),
      detail: '✓'.repeat(200),
      updatedAt: 'now',
    })
  })

  it('stops scanning public fields as soon as their character limit is exceeded', () => {
    const originalIterator = String.prototype[Symbol.iterator]
    let visited = 0
    String.prototype[Symbol.iterator] = function boundedIterator() {
      const iterator = originalIterator.call(this)
      return {
        next() {
          visited += 1
          if (visited > 50) throw new Error('progress validation scanned an unbounded value')
          return iterator.next()
        },
        [Symbol.iterator]() { return this },
      }
    }

    let normalized
    let errors
    try {
      normalized = safeRunProgress({ phase: '🚀'.repeat(100_000), label: 'ok' }, 'now')
      visited = 0
      errors = runProgressErrors({
        progress: { phase: '🚀'.repeat(100_000), label: 'ok', updatedAt: 'now' },
      })
    } finally {
      String.prototype[Symbol.iterator] = originalIterator
    }

    expect(normalized?.phase).toBe('🚀'.repeat(40))
    expect(errors).toContain('Run progress is invalid')
  })

  it('normalizes tag whitespace while preserving confirmed display form and order', () => {
    expect(httpPolicy.normalizeTags).toBeTypeOf('function')
    expect(normalizeTags(['  主意  ', 'NewTech', ' 事件'])).toEqual([
      '主意',
      'NewTech',
      '事件',
    ])
  })

  it.each([
    ['a non-array value', '主意'],
    ['a non-string item', ['主意', 42]],
    ['a blank item', ['主意', '   ']],
    ['more than twenty items', Array.from({ length: 21 }, (_, index) => `tag-${index}`)],
    ['an item longer than 32 characters', ['x'.repeat(33)]],
    ['case-insensitive duplicates', ['Idea', 'idea']],
  ])('rejects tags containing %s with BAD_REQUEST', (_case, value) => {
    let error
    try {
      normalizeTags(value)
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({ code: 'BAD_REQUEST' })
  })
})
