import { describe, expect, it } from 'vitest'
import { parseExtractionList, extractionInstruction, extractionRequirement, validateExtractionItems, assertExtractionSources } from './extraction.js'

const list = '<!-- mira:extraction:v1 -->\n<!-- mira:item:one -->\n## 一个观点\n正文\n\n> 原文依据\n<!-- mira:end -->'

describe('explicit extraction Markdown', () => {
  it('rejects unsupported, empty, binary and oversized actual extraction input before execution', () => {
    const instruction = extractionInstruction('提取观点')
    const text = { contentKind: 'markdown', resolvedContent: '正文' }
    expect(() => assertExtractionSources(instruction, [text])).not.toThrow()
    for (const source of [{ ...text, resolvedContent: '' }, { ...text, resolvedContent: '正文\u0000' }, { ...text, resolvedContent: 'x'.repeat(1000001) }, { ...text, contentKind: 'file-reference', path: 'a.pdf' }]) {
      expect(() => assertExtractionSources(instruction, [source])).toThrow()
    }
    expect(() => assertExtractionSources('普通推导', [{ ...text, resolvedContent: '' }])).not.toThrow()
  })
  it('shows the human requirement while preserving the format when edited', () => {
    expect(extractionRequirement(extractionInstruction('提取观点'))).toBe('提取观点')
    expect(extractionRequirement('普通目标')).toBeNull()
    expect(extractionRequirement(extractionInstruction('改为提取问题'))).toBe('改为提取问题')
  })
  it('keeps readable markdown and stable per-version items', () => {
    expect(parseExtractionList(list)).toEqual([{ itemId: 'one', title: '一个观点', markdown: '正文\n\n> 原文依据' }])
    expect(parseExtractionList('<!-- mira:extraction:v1 -->')).toEqual([])
    expect(parseExtractionList('# 普通文章\n1. 一个观点')).toBeNull()
    expect(extractionInstruction('提取不同观点')).toContain('提取不同观点')
    expect(extractionInstruction('提取不同观点')).toContain('mira:extraction:v1')
  })
  it.each([
    list + '\n未结构化尾部',
    list + '\n' + list.split('\n').slice(1).join('\n'),
    list.replace('正文\n\n> 原文依据', '  '),
    list.replace('<!-- mira:end -->', ''),
    list.replace('## 一个观点', '## ' + '长'.repeat(121)),
    list.replace('正文', '<!-- mira:extraction:v2 -->'),
  ])('rejects malformed lists without partial output', text => {
    expect(() => parseExtractionList(text)).toThrow()
  })
  it('validates the whole edited selection against the frozen list', () => {
    const source = parseExtractionList(list)!
    expect(validateExtractionItems([{ itemId: 'one', title: '人工标题', markdown: '人工正文' }], source)).toHaveLength(1)
    for (const items of [[], source.concat(source), [{ itemId: 'other', title: '标题', markdown: '正文' }], [{ ...source[0], markdown: '' }]]) {
      expect(() => validateExtractionItems(items, source)).toThrow()
    }
  })
})
