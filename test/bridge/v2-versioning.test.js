import { describe, expect, it } from 'vitest'
import { appendVersion, restoreVersion } from '../../bridge/domain/versioning.js'

function markdown(markdown) {
  return { kind: 'markdown', markdown }
}

function cardWithV1() {
  return {
    id: 'card-a',
    contentKind: 'markdown',
    x: 10,
    y: 20,
    width: 320,
    height: 180,
    headVersionId: 'ver-a1',
    versions: [
      {
        id: 'ver-a1',
        cardId: 'card-a',
        sequence: 1,
        content: markdown('第一版'),
        digest: 'existing-digest',
        origin: 'human',
        createdAt: '2026-08-23T00:00:00.000Z',
      },
    ],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

describe('v2 card versioning', () => {
  it('appends a new immutable head without changing previous versions', () => {
    const original = cardWithV1()
    const before = structuredClone(original)

    const updated = appendVersion(original, {
      baseVersionId: 'ver-a1',
      versionId: 'ver-a2',
      content: markdown('第二版'),
      origin: 'human',
      createdAt: '2026-08-23T00:01:00.000Z',
    })

    expect(original).toEqual(before)
    expect(updated).not.toBe(original)
    expect(updated.headVersionId).toBe('ver-a2')
    expect(updated.versions).toHaveLength(2)
    expect(updated.versions[0]).toEqual(before.versions[0])
    expect(updated.versions[1]).toMatchObject({
      id: 'ver-a2',
      cardId: 'card-a',
      sequence: 2,
      content: markdown('第二版'),
      origin: 'human',
    })
    expect(updated.versions[1].digest).toMatch(/^fnv1a:/)
  })

  it('rejects a write based on a stale head with zero mutation', () => {
    const original = cardWithV1()
    const before = structuredClone(original)

    expect(() =>
      appendVersion(original, {
        baseVersionId: null,
        versionId: 'ver-a2',
        content: markdown('冲突内容'),
        origin: 'human',
        createdAt: '2026-08-23T00:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'CARD_VERSION_CONFLICT' }))
    expect(original).toEqual(before)
  })

  it('requires every AI version to reference its source run', () => {
    expect(() =>
      appendVersion(cardWithV1(), {
        baseVersionId: 'ver-a1',
        versionId: 'ver-a2',
        content: markdown('AI 输出'),
        origin: 'ai',
        createdAt: '2026-08-23T00:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'VERSION_SOURCE_RUN_REQUIRED' }))
  })

  it('keeps a card content kind stable across versions', () => {
    expect(() =>
      appendVersion(cardWithV1(), {
        baseVersionId: 'ver-a1',
        versionId: 'ver-a2',
        content: { kind: 'file-reference', path: 'notes.md', readonly: true },
        origin: 'human',
        createdAt: '2026-08-23T00:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'CARD_CONTENT_KIND_MISMATCH' }))
  })

  it('restores an old version by appending a new head', () => {
    const v2 = appendVersion(cardWithV1(), {
      baseVersionId: 'ver-a1',
      versionId: 'ver-a2',
      content: markdown('第二版'),
      origin: 'human',
      createdAt: '2026-08-23T00:01:00.000Z',
    })

    const restored = restoreVersion(v2, 'ver-a1', {
      baseVersionId: 'ver-a2',
      versionId: 'ver-a3',
      createdAt: '2026-08-23T00:02:00.000Z',
    })

    expect(restored.headVersionId).toBe('ver-a3')
    expect(restored.versions).toHaveLength(3)
    expect(restored.versions[2]).toMatchObject({
      id: 'ver-a3',
      sequence: 3,
      content: markdown('第一版'),
      origin: 'restore',
      restoredFromVersionId: 'ver-a1',
    })
    expect(v2.headVersionId).toBe('ver-a2')
    expect(v2.versions).toHaveLength(2)
  })
})
