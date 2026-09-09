import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { FileBrowseEntry } from '../v2Api'
import {
  browseErrorMessage,
  confirmLabel,
  locationLabel,
  pickModeForEntry,
  selectionDetail,
} from './filePickerPolicy'

function entry(overrides: Partial<FileBrowseEntry>): FileBrowseEntry {
  return {
    name: 'research.md',
    kind: 'file',
    path: '/w/docs/research.md',
    workspaceRelative: 'docs/research.md',
    ...overrides,
  }
}

describe('file picker policy', () => {
  it('references workspace files in place and copies outside files', () => {
    expect(pickModeForEntry(entry({}))).toBe('reference')
    expect(pickModeForEntry(entry({ workspaceRelative: null, path: '/tmp/x.md' }))).toBe('copy')
  })

  it('explains the confirm action for each mode', () => {
    expect(confirmLabel('reference')).toBe('添加材料')
    expect(confirmLabel('copy')).toBe('拷贝到工作区并添加')
  })

  it('describes the selected file with its workspace outcome', () => {
    expect(selectionDetail(entry({}), 'reference')).toBe('将引用工作区文件 docs/research.md')
    expect(selectionDetail(entry({ workspaceRelative: null }), 'copy'))
      .toBe('文件不在工作区，添加时会先拷贝备份到 attachments/research.md')
  })

  it('labels the current location relative to the workspace', () => {
    expect(locationLabel({ workspaceRelative: '' })).toBe('工作区')
    expect(locationLabel({ workspaceRelative: 'docs' })).toBe('工作区 / docs')
    expect(locationLabel({ workspaceRelative: null, path: '/Users/a/papers' }))
      .toBe('/Users/a/papers')
  })

  it('explains a stale backend instead of leaking the raw route message', () => {
    expect(browseErrorMessage(Object.assign(new Error('POST /v2/files/browse'), { code: 'NOT_FOUND' })))
      .toBe('当前运行的 Mira 服务还没有文件浏览能力，请更新并重启服务后重试')
    expect(browseErrorMessage(Object.assign(new Error('unavailable'), { code: 'FILES_UNAVAILABLE' })))
      .toBe('当前运行的 Mira 服务还没有文件浏览能力，请更新并重启服务后重试')
    expect(browseErrorMessage(new Error('磁盘错误'))).toBe('磁盘错误')
  })

  it('always releases the confirm lock when a binding is rejected', async () => {
    const picker = await readFile(new URL('./FilePicker.tsx', import.meta.url), 'utf8')
    expect(picker).toMatch(/async function confirm[\s\S]*try \{[\s\S]*\} finally \{\s*setBusy\(false\)\s*\}/)
  })

  it('restores its opener and keeps the bound card detail mounted', async () => {
    const [picker, app] = await Promise.all([
      readFile(new URL('./FilePicker.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
    ])
    expect(picker).toContain("onClose: (outcome: 'cancel' | 'complete') => void")
    expect(picker).toContain("onClose('cancel')")
    expect(picker).toContain("onClose('complete')")
    expect(app).toContain('modalTaskOpenerRef')
    expect(app).toContain('rememberModalTaskOpener()')
    expect(app).toContain('restoreFocusAfterRender(')
    expect(app).not.toContain("if (outcome === 'cancel' || wasBinding)")
    expect(app).toMatch(/onOpenFileBindingPicker=\{\(cardId\) => \{\s*rememberModalTaskOpener\(\)\s*setFileBindingCardId\(cardId\)\s*setFilePickerOpen\(true\)\s*\}\}/)
    expect(app).not.toContain('onOpenFileBindingPicker={(cardId) => requestDrawerIntent')
  })
})
