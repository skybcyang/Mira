import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { SingleStepControls } from './ContextDock'

it('offers an explicit extraction entry without a preset requirement', () => {
  const props = { custom: '', pending: false, onCustomChange() {}, onCreate() {}, onStartBranch() {}, onExtract() {} }
  const html = renderToStaticMarkup(createElement(SingleStepControls, props))
  expect(html).toContain('提取为多张卡片')
  expect(html).not.toContain('例如：')
  expect(html).not.toContain('v2-suggestions')
})
