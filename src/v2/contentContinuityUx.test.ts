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

it('keeps inspiration deletion and append writing in their existing task surfaces', async () => {
  const [picker, drawer, append] = await Promise.all([
    readFile(new URL('./InspirationPicker.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./detail/AppendNotePanel.tsx', import.meta.url), 'utf8'),
  ])
  expect(picker).toContain('永久删除这条灵感？')
  expect(picker).toContain('已放入画板的卡片不受影响')
  expect(picker).toContain('deleteInspirationEntry')
  expect(drawer).toContain('<AppendNotePanel')
  expect(append).toContain('保存为新卡并接续')
  expect(append).toContain('追加内容')
})
