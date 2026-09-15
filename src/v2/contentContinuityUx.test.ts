import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { TransformationCardView } from './TransformationNode'

it('distinguishes a changed step definition from changed source content', () => {
  const html = renderToStaticMarkup(createElement(TransformationCardView, {
    data: {
      transformationId: 'step', label: '读书卡片', sourceCount: 1, status: 'succeeded',
      stale: true, definitionChanged: true, collapsedSources: false,
    },
    onRun: () => {},
  }))
  expect(html).toContain('步骤已变化')
})

it('keeps inspiration deletion without exposing the retired append-note path', async () => {
  const [picker, content, drawer, api, routes, handlers] = await Promise.all([
    readFile(new URL('./InspirationPicker.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./detail/ContentPanel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../v2Api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../bridge/v2-routes.js', import.meta.url), 'utf8'),
    readFile(new URL('../../bridge/v2-http.js', import.meta.url), 'utf8'),
  ])
  expect(picker).toContain('永久删除这条灵感？')
  expect(picker).toContain('已放入画板的卡片不受影响')
  expect(picker).toContain('deleteInspirationEntry')
  expect([content, drawer, api, routes, handlers].join('\n')).not.toMatch(
    /追加笔记|接续写作|continueCard|continuations|CONTINUATION_INVALID|AppendNotePanel/,
  )
})
