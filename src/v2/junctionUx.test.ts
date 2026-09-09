import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import JunctionNode from './JunctionNode'

describe('junction node UX', () => {
  it('labels a collapsed high fan-in without exposing a wall of source edges', () => {
    const html = renderToStaticMarkup(createElement(
      ReactFlowProvider,
      null,
      createElement(JunctionNode, {
        data: { collapsed: true, sourceCount: 52 },
      } as never),
    ))

    expect(html).toContain('v2-junction is-collapsed')
    expect(html).toContain('52 个来源')
    expect(html).toContain('aria-label="汇聚 52 个来源"')
  })
})
