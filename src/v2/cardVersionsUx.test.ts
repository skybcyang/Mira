import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ContentCard } from '../domain'
import { VersionPanelView } from './DetailDrawer'

const card: ContentCard = {
  id: 'card-1',
  contentKind: 'markdown',
  x: 0,
  y: 0,
  width: 312,
  height: 208,
  headVersionId: 'v7',
  versions: [
    {
      id: 'v2',
      cardId: 'card-1',
      sequence: 2,
      content: { kind: 'markdown', markdown: '# 同一正文' },
      digest: 'digest-2',
      origin: 'human',
      createdAt: '2026-09-02T08:00:00.000Z',
    },
    {
      id: 'v7',
      cardId: 'card-1',
      sequence: 7,
      content: { kind: 'markdown', markdown: '# 同一正文' },
      digest: 'digest-7',
      origin: 'restore',
      createdAt: '2026-09-05T08:00:00.000Z',
    },
  ],
  createdAt: '2026-09-02T08:00:00.000Z',
  updatedAt: '2026-09-05T08:00:00.000Z',
}

describe('card version panel', () => {
  it('explains the current and selected versions with a markdown diff empty state', () => {
    const html = renderToStaticMarkup(createElement(VersionPanelView, {
      card,
      selectedId: 'v2',
      confirming: false,
      restoring: false,
      onSelect: () => undefined,
      onRequestRestore: () => undefined,
      onCancelRestore: () => undefined,
      onConfirmRestore: () => undefined,
    }))

    expect(html).toContain('当前 v7')
    expect(html).toContain('人工编辑')
    expect(html).toContain('恢复')
    expect(html).toContain('所选版本与当前版本的正文没有变化。')
    expect(html).toContain('恢复为最新版本')
  })

  it('shows the exact appended version number before restoring', () => {
    const html = renderToStaticMarkup(createElement(VersionPanelView, {
      card,
      selectedId: 'v2',
      confirming: true,
      restoring: false,
      onSelect: () => undefined,
      onRequestRestore: () => undefined,
      onCancelRestore: () => undefined,
      onConfirmRestore: () => undefined,
    }))

    expect(html).toContain('恢复为最新版本？')
    expect(html).toContain('将创建 v8，旧版本保持不变。')
    expect(html).toContain('确认恢复')
  })
})
