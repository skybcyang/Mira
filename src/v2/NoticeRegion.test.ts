import { readStyles } from '../../test/helpers/read-styles.js'
import { readFile, readdir } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import type { Notice } from './noticePolicy'
import { NoticeRegionView } from './NoticeRegion'

const notices: Notice[] = [
  { id: 'error-1', kind: 'error', message: '保存失败' },
  { id: 'progress-1', kind: 'progress', message: '正在生成', operationId: 'generate-1' },
  { id: 'success-1', kind: 'success', message: '已完成' },
]

describe('NoticeRegion', () => {
  it('separates blocking alerts from polite updates and labels exact dismiss commands', () => {
    const html = renderToStaticMarkup(createElement(NoticeRegionView, {
      notices,
      onDismiss: vi.fn(),
    }))

    expect(html).toContain('aria-label="通知"')
    expect(html).toContain('aria-live="polite"')
    expect(html.match(/role="alert"/g)).toHaveLength(1)
    expect(html).toContain('data-notice-kind="progress"')
    expect(html).toContain('aria-label="关闭通知：保存失败"')
    expect(html).toContain('aria-label="关闭通知：正在生成"')
  })

  it('uses a dedicated responsive stack and removes the legacy single toast from App', async () => {
    const [app, styles] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readStyles(new URL('../styles.css', import.meta.url)),
    ])

    expect(app).toMatch(/import NoticeRegion from ['"]\.\/v2\/NoticeRegion['"]/)
    expect(app).toMatch(/<NoticeRegion\s*\/?>/)
    expect(app).not.toContain('v2-toast')
    expect(styles).toMatch(/\.v2-notice-region\s*\{[^}]*position:\s*fixed;[^}]*top:\s*60px;/s)
    expect(styles).toMatch(/:has\(\.v2-selection-toolbar\)[^{]*\.v2-notice-region/)
    expect(styles).toMatch(/\.v2-app\.has-drawer[^,{]*\.v2-notice-region/)
    expect(styles).toMatch(/@media\s*\(max-width:\s*719px\)[\s\S]*\.v2-notice-region/)
    expect(styles).toMatch(
      /@media\s*\(max-width:\s*719px\)[\s\S]*:has\(\.v2-context-dock\)[^{]*\.v2-notice-region\s*\{[^}]*max-height:/,
    )
  })

  it('keeps compact task notices inside the modal focus boundary', async () => {
    const [source, styles] = await Promise.all([
      readFile(new URL('./NoticeRegion.tsx', import.meta.url), 'utf8'),
      readStyles(new URL('../styles.css', import.meta.url)),
    ])
    expect(source).toContain('createPortal')
    expect(source).toContain("matchMedia('(max-width: 1099px)')")
    expect(styles).toMatch(/:is\(\.v2-detail-drawer[^}]*> \.v2-notice-region\s*\{[^}]*position:\s*static;/s)
  })

  it('requires every non-null legacy message write to declare a structured notice kind', async () => {
    const sliceFiles = (await readdir(new URL('./', import.meta.url)))
      .filter((name) => name.endsWith('Slice.ts'))
    expect(sliceFiles.length).toBeGreaterThan(0)
    const source = (await Promise.all([
      '../v2Store.ts', './storeContext.ts', ...sliceFiles.map((name) => `./${name}`),
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n')
    const file = ts.createSourceFile('v2Store.ts', source, ts.ScriptTarget.Latest, true)
    const directWrites: number[] = []

    const insideNoticePatch = (node: ts.Node) => {
      let current: ts.Node | undefined = node
      while (current) {
        if (
          ts.isFunctionDeclaration(current)
          && (current.name?.text === 'noticePatch' || current.name?.text === 'noticeCollectionPatch')
        ) return true
        current = current.parent
      }
      return false
    }
    const visit = (node: ts.Node) => {
      if (!insideNoticePatch(node)) {
        if (
          ts.isPropertyAssignment(node)
          && node.name.getText(file) === 'message'
          && node.initializer.kind !== ts.SyntaxKind.NullKeyword
        ) directWrites.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
        if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'message') {
          directWrites.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1)
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(file)

    expect(directWrites).toEqual([])
  })
})
