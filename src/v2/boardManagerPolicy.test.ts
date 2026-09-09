import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  BOARD_MANAGER_TABS,
  boardActionsForState,
  boardDangerCopy,
  boardManagerTabFromKey,
  boardsForTab,
  inspectBoardArtifact,
  normalizeBoardTitle,
  validateBoardArtifactFile,
  type BoardCatalogEntry,
} from './boardManagerPolicy'

const entries: BoardCatalogEntry[] = [
  { id: 'active-old', title: '旧课题', state: 'active', revision: 1, updatedAt: '2026-08-01T10:00:00.000Z' },
  { id: 'archived', title: '历史课题', state: 'archived', revision: 2, updatedAt: '2026-08-03T10:00:00.000Z' },
  { id: 'active-new', title: '当前课题', state: 'active', revision: 3, updatedAt: '2026-08-05T10:00:00.000Z' },
  { id: 'trashed', title: '待恢复课题', state: 'trashed', revision: 4, updatedAt: '2026-08-04T10:00:00.000Z' },
]

describe('board manager policy boundary', () => {
  it('keeps lifecycle presentation policy in a dedicated module', async () => {
    const source = await readFile(new URL('./boardManagerPolicy.ts', import.meta.url), 'utf8').catch(() => null)

    expect(source, 'src/v2/boardManagerPolicy.ts must exist').not.toBeNull()
  })

  it('exports the lifecycle, title, confirmation, and import preview policies', async () => {
    const policy = await import('./boardManagerPolicy')

    expect(policy).toMatchObject({
      BOARD_MANAGER_TABS: expect.any(Array),
      boardActionsForState: expect.any(Function),
      boardsForTab: expect.any(Function),
      normalizeBoardTitle: expect.any(Function),
      boardDangerCopy: expect.any(Function),
      inspectBoardArtifact: expect.any(Function),
      validateBoardArtifactFile: expect.any(Function),
      boardManagerTabFromKey: expect.any(Function),
    })
  })

  it('defines the three user-facing lifecycle segments and filters newest first', () => {
    expect(BOARD_MANAGER_TABS).toEqual([
      { id: 'active', label: '工作中' },
      { id: 'archived', label: '已归档' },
      { id: 'trashed', label: '废纸篓' },
    ])
    expect(boardsForTab(entries, 'active').map((entry) => entry.id)).toEqual(['active-new', 'active-old'])
  })

  it('offers only commands allowed by each lifecycle state', () => {
    expect(boardActionsForState('active', false)).toEqual(['open', 'rename', 'export', 'archive', 'trash'])
    expect(boardActionsForState('active', true)).toEqual(['rename', 'export', 'archive', 'trash'])
    expect(boardActionsForState('archived', false)).toEqual(['restore', 'rename', 'export', 'trash'])
    expect(boardActionsForState('trashed', false)).toEqual(['restore', 'export', 'purge'])
  })

  it('implements the complete horizontal tab keyboard contract', () => {
    expect(boardManagerTabFromKey('active', 'ArrowRight')).toBe('archived')
    expect(boardManagerTabFromKey('trashed', 'ArrowRight')).toBe('active')
    expect(boardManagerTabFromKey('active', 'ArrowLeft')).toBe('trashed')
    expect(boardManagerTabFromKey('archived', 'Home')).toBe('active')
    expect(boardManagerTabFromKey('active', 'End')).toBe('trashed')
    expect(boardManagerTabFromKey('active', 'Enter')).toBeNull()
  })

  it('normalizes valid titles and explains blank or overlong input', () => {
    expect(normalizeBoardTitle('  新课题  ')).toEqual({ title: '新课题', error: null })
    expect(normalizeBoardTitle('   ')).toEqual({ title: '', error: '请输入画板名称。' })
    expect(normalizeBoardTitle('字'.repeat(121))).toEqual({ title: '字'.repeat(121), error: '画板名称不能超过 120 个字符。' })
    expect(normalizeBoardTitle('😀'.repeat(120))).toEqual({ title: '😀'.repeat(120), error: null })
  })

  it('rejects oversized or mislabeled import files before they are read', () => {
    expect(validateBoardArtifactFile({ name: 'research.mira-board.json', size: 64 * 1024 * 1024 })).toBeNull()
    expect(validateBoardArtifactFile({ name: 'research.mira-board.json', size: 64 * 1024 * 1024 + 1 })).toBe('画板文件超过 64 MiB，无法导入。')
    expect(validateBoardArtifactFile({ name: 'research.json', size: 1024 })).toBe('请选择 .mira-board.json 文件。')
  })

  it('names the exact board and reversible impact in dangerous confirmations', () => {
    expect(boardDangerCopy('archive', '年度洞察')).toEqual({
      title: '归档“年度洞察”？',
      description: '归档后内容只读，可随时恢复。',
      confirmLabel: '确认归档',
    })
    expect(boardDangerCopy('trash', '年度洞察')).toEqual({
      title: '将“年度洞察”移到废纸篓？',
      description: '移入后只可恢复或导出，不会永久删除。',
      confirmLabel: '移到废纸篓',
    })
  })

  it('names irreversible purge impact and exact confirmation', () => {
    expect(boardDangerCopy('purge', '年度洞察')).toEqual({
      title: '永久删除“年度洞察”？',
      description: '将永久删除画板及其运行记录，无法恢复。其他画板、方法和引用文件不受影响。',
      confirmLabel: '永久删除',
    })
  })

  it('summarizes a Mira board envelope without treating preview as full validation', () => {
    expect(inspectBoardArtifact({
      format: 'mira-board',
      formatVersion: 1,
      board: {
        title: '访谈研究',
        cards: [{ versions: [{}, {}] }, { versions: [{}] }],
        transformations: [{ id: 'transformation' }],
      },
      runs: [{ id: 'run' }],
      externalReferences: [{ kind: 'historical' }, { kind: 'workflow' }],
      fileDependencies: [{ path: 'docs/a.md', occurrenceCount: 2 }],
      workflowProvenance: [{ workflowId: 'workflow' }],
    })).toEqual({
      formatVersion: 1,
      title: '访谈研究',
      cardCount: 2,
      versionCount: 3,
      transformationCount: 1,
      runCount: 1,
      externalReferenceCount: 2,
      fileDependencyCount: 1,
      workflowProvenanceCount: 1,
    })
  })

  it('rejects unknown or malformed envelopes before showing an import confirmation', () => {
    expect(() => inspectBoardArtifact({ format: 'mira-board', formatVersion: 9 })).toThrow('不支持这个画板文件版本。')
    expect(() => inspectBoardArtifact({ format: 'other', formatVersion: 1 })).toThrow('这不是 Mira 画板文件。')
  })
})
