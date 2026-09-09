import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowTemplate } from '../domain'
import { WorkflowLibraryView } from './WorkflowLibrary'

const workflow: WorkflowTemplate = {
  id: 'method', title: '研究方法', description: '经过验证的研究步骤', createdAt: '', updatedAt: '',
  inputs: [{ id: 'raw', name: '访谈材料', description: '', required: true, cardinality: 'many' }],
  steps: [
    { id: 'a', label: '整理证据', instruction: '读取并整理材料', acceptance: '', sources: [{ kind: 'input', inputId: 'raw' }] },
    { id: 'b', label: '产品建议', instruction: '根据证据形成建议', acceptance: '', sources: [{ kind: 'previous-output' }] },
  ],
}

describe('compact method library', () => {
  it('shows outcome, required materials and step count before a native collapsed step list', () => {
    const html = renderToStaticMarkup(createElement(WorkflowLibraryView, {
      workflows: [workflow], state: 'ready', onClose() {}, onDelete() {}, onUse() {},
    }))
    expect(html).toContain('class="v2-workflow-outcome"')
    expect(html).toContain('最终成果')
    expect(html).toContain('2 步')
    expect(html).toContain('访谈材料')
    expect(html).toContain('可多选')
    expect(html).toContain('<details class="v2-workflow-details">')
    expect(html).toContain('<summary>')
    expect(html).not.toContain('<details open')
    expect(html.indexOf('v2-workflow-outcome')).toBeLessThan(html.indexOf('<details'))
    expect(html.indexOf('<details')).toBeLessThan(html.indexOf('读取并整理材料'))
    expect(html).toContain('aria-label="删除方法 研究方法"')
    expect(html).toContain('>使用方法</button>')
  })
})
