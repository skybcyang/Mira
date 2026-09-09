import { readFile } from 'node:fs/promises'
import { readStyles } from '../../test/helpers/read-styles.js'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardCheckpointSummary, BoardCheckpointV1, BoardV2, TransformationRun } from '../domain'
import {
  BoardHistoryCardDiffView,
  BoardHistoryListView,
  BoardHistoryPreviewView,
} from './BoardHistory'
import { compareCheckpointToCurrent } from './checkpointDiff'

const now = '2026-09-05T08:00:00.000Z'
const board: BoardV2 = {
  schemaVersion: 2,
  id: 'board-1',
  title: '年度访谈研究',
  revision: 4,
  cards: [],
  transformations: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  createdAt: now,
  updatedAt: now,
}
const summary: BoardCheckpointSummary = {
  id: 'checkpoint-1', boardId: board.id, title: '第一轮稳定稿', note: '访谈归纳完成',
  baseBoardRevision: 3,
  counts: { cards: 12, transformations: 4, runs: 6 },
  createdAt: now, metadataUpdatedAt: now,
}
const checkpoint: BoardCheckpointV1 = {
  schemaVersion: 1,
  ...summary,
  artifact: {
    format: 'mira-board', formatVersion: 1, exportedAt: now, board,
    runs: [], workflowProvenance: [], fileDependencies: [], externalReferences: [],
  },
}

function markdownCard(id: string, versionId: string, markdown: string) {
  return {
    id, contentKind: 'markdown' as const, x: 0, y: 0, width: 312, height: 208,
    headVersionId: versionId,
    versions: [{
      id: versionId, cardId: id, sequence: 1,
      content: { kind: 'markdown' as const, markdown }, digest: `digest-${markdown}`,
      origin: 'human' as const, createdAt: now,
    }],
    createdAt: now, updatedAt: now,
  }
}

const callbacks = {
  onSave: () => undefined,
  onSelect: () => undefined,
  onExport: () => undefined,
  onRename: () => undefined,
  onDelete: () => undefined,
}

describe('BoardHistory feature', () => {
  it('fits the miniature to distant grouped content rather than the world origin', () => {
    const distant = structuredClone(board)
    distant.cards = [{ id: 'far', contentKind: 'markdown', x: 100000, y: 100000,
      width: 312, height: 208, headVersionId: null, versions: [], createdAt: now, updatedAt: now }]
    distant.groups = [{ id: 'g', title: 'Research', cardIds: ['far'] }]
    const saved = { ...checkpoint, artifact: { ...checkpoint.artifact, board: distant } }
    const markup = renderToStaticMarkup(createElement(BoardHistoryPreviewView, {
      checkpoint: saved, currentBoard: distant, currentRuns: {}, onBack: () => {}, onFork: () => {}, onExport: () => {},
    }))
    const viewBox = markup.match(/<svg viewBox="([^"]+)"/)![1].split(' ').map(Number)
    expect(viewBox[2]).toBe(384)
    expect(viewBox[3]).toBe(312)
  })
  it('renders compact summaries with accessible version commands', () => {
    const html = renderToStaticMarkup(createElement(BoardHistoryListView, {
      checkpoints: [summary], loading: false, error: null, saveBlocker: null, ...callbacks,
    }))

    expect(html).toContain('第一轮稳定稿')
    expect(html).toContain('12 张卡片')
    expect(html).toContain('4 个步骤')
    expect(html).toContain('6 次运行')
    expect(html).toContain('访谈归纳完成')
    expect(html).toContain('保存画布版本')
    expect(html).toContain('aria-label="导出画布版本 第一轮稳定稿"')
    expect(html).toContain('aria-label="重命名画布版本 第一轮稳定稿"')
    expect(html).toContain('aria-label="删除画布版本 第一轮稳定稿"')
  })

  it('keeps empty, blocked, loading, and error states explicit', () => {
    const empty = renderToStaticMarkup(createElement(BoardHistoryListView, {
      checkpoints: [], loading: false, error: null, saveBlocker: null, ...callbacks,
    }))
    const blocked = renderToStaticMarkup(createElement(BoardHistoryListView, {
      checkpoints: [], loading: false, error: null,
      saveBlocker: '生成结束或停止后才能保存稳定版本。', ...callbacks,
      saveBlockerAction: { label: '查看运行', onSelect: () => undefined },
    }))
    const failed = renderToStaticMarkup(createElement(BoardHistoryListView, {
      checkpoints: [], loading: false, error: '画布版本暂时无法读取',
      saveBlocker: null, ...callbacks,
    }))

    expect(empty).toContain('还没有保存画布版本')
    expect(empty).toContain('保存当前版本')
    expect(blocked).toContain('生成结束或停止后才能保存稳定版本。')
    expect(blocked).toContain('disabled=""')
    expect(blocked).toContain('查看运行')
    expect(failed).toContain('role="alert"')
    expect(failed).toContain('重新加载')
  })

  it('renders a read-only preview and current comparison before forking', () => {
    const savedCard = markdownCard('card-1', 'version-1', '旧正文')
    const currentCard = markdownCard('card-1', 'version-2', '新正文')
    const savedCheckpoint = {
      ...checkpoint,
      artifact: { ...checkpoint.artifact, board: { ...board, cards: [savedCard] } },
    }
    const html = renderToStaticMarkup(createElement(BoardHistoryPreviewView, {
      checkpoint: savedCheckpoint,
      currentBoard: { ...board, cards: [currentCard] },
      currentRuns: {
        candidate: {
          id: 'candidate', boardId: 'board-1', transformationId: 'step', status: 'succeeded',
          sourceSnapshot: [], targetCardId: 'card-1', targetBaseVersionId: 'version-1',
          intent: 'update', result: { disposition: 'candidate', output: '候选', digest: 'digest' },
          createdAt: now, startedAt: now, finishedAt: now,
        },
      },
      onBack: () => undefined,
      onFork: () => undefined,
      onExport: () => undefined,
    }))

    expect(html).toContain('这是只读版本，不会改变当前画布')
    expect(html).toContain('与当前画板比较')
    expect(html).toContain('正文变化')
    expect(html).toContain('布局变化')
    expect(html).toContain('结构变化')
    expect(html).toContain('待处理结果')
    expect(html).toContain('查看正文差异')
    expect(html).toContain('从这个版本创建副本')

    const change = compareCheckpointToCurrent(
      savedCheckpoint.artifact,
      { ...board, cards: [currentCard] },
      {},
    ).cards.contentChanges[0]
    const diffHtml = renderToStaticMarkup(createElement(BoardHistoryCardDiffView, { change }))
    expect(diffHtml).toContain('旧正文')
    expect(diffHtml).toContain('新正文')
  })

  it('renders complete Run totals and live Candidate resolution from a sparse Canvas cache', () => {
    const first: TransformationRun = {
      id: 'first', boardId: board.id, transformationId: 'step', status: 'succeeded',
      sourceSnapshot: [], targetCardId: 'card', targetBaseVersionId: null, intent: 'update',
      createdAt: now, result: { disposition: 'applied', output: 'first', digest: 'first' },
    }
    const latest: TransformationRun = {
      ...first, id: 'latest', result: { disposition: 'candidate', output: 'latest', digest: 'latest' },
    }
    const html = renderToStaticMarkup(createElement(BoardHistoryPreviewView, {
      checkpoint, currentBoard: board, currentRuns: { first, latest },
      liveRuns: {
        latest: { ...latest, result: { ...latest.result!, disposition: 'discarded' } },
      },
      onBack: () => undefined, onFork: () => undefined, onExport: () => undefined,
    }))

    expect(html).toContain('<dt>新增运行</dt><dd>2</dd>')
    expect(html).toContain('<dt>待处理结果</dt><dd>0</dd>')
  })

  it('remains a lazy-loadable feature outside App', async () => {
    const [app, source] = await Promise.all([
      readFile(new URL('../App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./BoardHistory.tsx', import.meta.url), 'utf8').catch(() => ''),
    ])
    expect(source).not.toBe('')
    expect(app).toMatch(/const BoardHistory = lazy\(\(\) => import\('\.\/v2\/BoardHistory'\)\)/)
    expect(app).toContain('boardHistoryTarget')
    expect(app).toMatch(/<BoardHistory[\s\S]*target=\{boardHistoryTarget\}/)
    expect(source).toContain('[data-history-autofocus]:not(:disabled)')
    expect(source).toContain('await switchBoard(target.id)')
    expect(source).toContain('useV2Canvas.getState().boardId !== target.id')
    expect(source).toContain('return () => requests.invalidate()')
    expect(source).toContain('currentRuns={preview.runs}')
    expect(source).toContain('liveRuns={isCurrentBoard ? currentRuns : undefined}')
    expect(source).toContain('onBack={backToList}')
    expect(source).toContain('onClick={close}')
    expect(source).toMatch(/requests\.run\(\s*\(\) => forkCheckpoint\(target.id, preview.checkpoint.id, title, requests.capture\(\)\)/)
  })

  it('keeps sticky version commands opaque above scrolling content', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))
    for (const selector of ['.v2-board-history-preview > footer', '.v2-board-history-task > footer']) {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      expect(styles).toMatch(new RegExp(`${escaped}\\s*\\{[^}]*background:\\s*var\\(--mira-surface\\)`))
    }
  })

  it('uses a bounded desktop rail and a full-width 390px sheet', async () => {
    const styles = await readStyles(new URL('../styles.css', import.meta.url))

    expect(styles).toMatch(/\.v2-board-history\s*\{[^}]*width:\s*360px;[^}]*overflow:\s*hidden;/s)
    expect(styles).toMatch(/\.v2-board-history-list\s*\{[^}]*list-style:\s*none;/s)
    expect(styles).toMatch(/@media \(max-width:\s*719px\)[\s\S]*\.v2-board-history\s*\{[^}]*width:\s*100%;[^}]*height:\s*calc\(100dvh - 52px\);/s)
    expect(styles).toMatch(/\.v2-board-history-task\s*>\s*footer\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s)
  })
})
