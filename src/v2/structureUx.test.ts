import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { BoardV2, ContentCard, Transformation, TransformationRun } from '../domain'
import { useV2Canvas } from '../v2Store'
import DetailDrawer, {
  ContentEditorView,
  ContentReaderView,
  TransformationDeleteControl,
  TransformationEditForm,
} from './DetailDrawer'

describe('card content reader UX', () => {
  it('renders complete markdown and file text in a dedicated reading surface', () => {
    const markdown = renderToStaticMarkup(createElement(ContentReaderView, {
      contentKind: 'markdown',
      title: '长文方案',
      content: '# 完整标题\n\n最后一段',
    }))
    const file = renderToStaticMarkup(createElement(ContentReaderView, {
      contentKind: 'file-reference',
      title: 'source.md',
      path: 'docs/source.md',
      content: '# 文件正文\n\n全部内容',
    }))

    expect(markdown).toContain('完整标题')
    expect(markdown).toContain('最后一段')
    expect(markdown).toContain('v2-content-reader-markdown')
    expect(file).toContain('docs/source.md')
    expect(file).toContain('文件正文')
    expect(file).toContain('v2-content-reader-file')
  })

  it('keeps markdown editing in the content detail surface with explicit save and cancel commands', () => {
    const html = renderToStaticMarkup(createElement(ContentEditorView, {
      title: '长文方案',
      content: '# 正文',
      dirty: true,
      saving: false,
      onChange: () => undefined,
      onSave: () => undefined,
      onCancel: () => undefined,
    }))

    expect(html).toContain('v2-content-editor')
    expect(html).toContain('aria-label="编辑卡片内容"')
    expect(html).toContain('保存正文')
    expect(html).toContain('取消修改')
  })
})

const transformation: Transformation = {
  id: 'transformation-1',
  sourceCardIds: ['source-a'],
  targetCardId: 'target',
  label: '形成建议',
  instruction: '综合材料形成建议',
  acceptance: '建议可执行',
  permissions: { workspaceWrite: false },
  workflowRef: { workflowId: 'workflow-1', stepId: 'step-1', applicationId: 'application-1' },
  lastRunId: 'run-1',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
}

function card(id: string, markdown: string): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: `${id}-v1`,
    versions: [{
      id: `${id}-v1`,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown },
      digest: `digest-${id}`,
      origin: 'human',
      createdAt: '2026-08-23T00:00:00.000Z',
    }],
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
}

function renderRelationDetail(
  currentTransformation: Transformation,
  cards: ContentCard[],
  runs: Record<string, TransformationRun>,
  runningToTransformationId: string | null = null,
): string {
  const board: BoardV2 = {
    schemaVersion: 2,
    id: 'board-1',
    title: '研究画板',
    cards,
    transformations: [currentTransformation],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  }
  const initialState = useV2Canvas.getInitialState()
  const initialSnapshot = { ...initialState }
  useV2Canvas.setState({
    boardId: board.id,
    board,
    runs,
    runningToTransformationId,
    selectedCardIds: [],
    drawer: { tab: 'relation', transformationId: currentTransformation.id },
    workflowState: 'ready',
    workflows: [],
  })
  Object.assign(initialState, useV2Canvas.getState())
  const html = renderToStaticMarkup(createElement(DetailDrawer))
  Object.assign(initialState, initialSnapshot)
  return html
}

describe('transformation structure editing UX', () => {
  it('offers source addition and ordered list controls directly in relationship details', () => {
    const html = renderRelationDetail(transformation, [card('source-a', '来源'), card('target', '成果')], {})
    expect(html).toContain('添加来源')
    expect(html).toContain('上移来源')
    expect(html).toContain('移除来源')
  })
  it('edits metadata without replacing sources from the canvas selection', () => {
    const html = renderToStaticMarkup(createElement(TransformationEditForm, {
      transformation,
      onCancel: () => undefined,
      onSave: async () => true,
    }))

    expect(html).toContain('成果名称')
    expect(html).toContain('生成目标')
    expect(html).toContain('完成标准')
    expect(html).toContain('模型')
    expect(html).toContain('继承默认模型')
    expect(html).toContain('固定模型 ID')
    expect(html).toContain('value="形成建议"')
    expect(html).not.toContain('用当前选择替换来源')
    expect(html).toContain('保留目标卡、流程归属和运行历史')
  })

  it('keeps the last remaining source non-removable', () => {
    const html = renderRelationDetail(transformation, [card('source-a', '来源'), card('target', '成果')], {})
    expect(html).toContain('至少保留一个来源')
    expect(html).toContain('disabled=""')
  })

  it('keeps model strategy read-only when the current host cannot override one step', () => {
    const html = renderToStaticMarkup(createElement(TransformationEditForm, {
      transformation,
      modelOverrideSupported: false,
      onCancel: () => undefined,
      onSave: async () => true,
    }))

    expect(html).toContain('当前宿主决定')
    expect(html).not.toContain('固定模型 ID')
  })

  it('requires a second confirmation and explains transformation deletion retention', () => {
    const initial = renderToStaticMarkup(createElement(TransformationDeleteControl, {
      confirming: false,
      onRequest: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }))
    const confirming = renderToStaticMarkup(createElement(TransformationDeleteControl, {
      confirming: true,
      onRequest: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }))

    expect(initial).toContain('删除转化')
    expect(initial).not.toContain('确认删除转化')
    expect(confirming).toContain('目标卡、版本和已有运行都会保留')
    expect(confirming).toContain('确认删除转化')
    expect(confirming).toContain('取消')
  })

  it('keeps a candidate reachable while blocking structure changes and regeneration', () => {
    const candidateRun: TransformationRun = {
      id: 'run-1',
      boardId: 'board-1',
      transformationId: transformation.id,
      status: 'succeeded',
      sourceSnapshot: [{
        cardId: 'source-a',
        versionId: 'source-a-v1',
        contentKind: 'markdown',
        resolvedContent: '# 访谈材料',
        digest: 'digest-source-a',
      }],
      targetCardId: transformation.targetCardId,
      targetBaseVersionId: 'target-v1',
      intent: 'update',
      result: { output: '# 候选结果', digest: 'candidate', disposition: 'candidate' },
      createdAt: '2026-08-23T00:00:00.000Z',
    }
    const appliedRun: TransformationRun = {
      ...candidateRun,
      id: 'run-applied',
      sourceSnapshot: [{
        cardId: 'source-a',
        versionId: 'source-a-v0',
        contentKind: 'markdown',
        resolvedContent: '# 旧访谈材料',
        digest: 'digest-source-a-old',
      }],
      result: {
        output: '# 已采用结果',
        digest: 'applied',
        disposition: 'applied',
        appliedVersionId: 'target-v1',
      },
    }
    const candidateTransformation = {
      ...transformation,
      lastAppliedRunId: appliedRun.id,
    }
    const html = renderRelationDetail(
      candidateTransformation,
      [card('source-a', '# 访谈材料'), card('target', '# 当前成果')],
      { [candidateRun.id]: candidateRun, [appliedRun.id]: appliedRun },
    )
    const disabledButtons = html.match(/<button[^>]*disabled=""[^>]*>.*?<\/button>/g) || []
    const compareButton = html.match(/<button([^>]*)>比较待处理结果<\/button>/)?.[1] || ''

    expect(html).toContain('先采用或丢弃待比较结果，再修改、删除或重新生成')
    expect(html).toContain('来源已变化')
    expect(compareButton).not.toContain('disabled=""')
    expect(disabledButtons.some((button) => button.includes('编辑步骤'))).toBe(true)
    expect(disabledButtons.some((button) => button.includes('删除转化'))).toBe(true)
    expect(disabledButtons.some((button) => button.includes('先处理待比较结果'))).toBe(true)
  })

  it('uses an accessible roving tablist and labelled tab panel', () => {
    const html = renderRelationDetail(
      transformation,
      [card('source-a', '# 访谈材料'), card('target', '# 当前成果')],
      {},
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('role="tab"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('aria-labelledby="v2-drawer-tab-relation"')
  })

  it('handles Arrow, Home, and End keys from the active drawer tab', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => (
      readFile(new URL('./DetailDrawer.tsx', import.meta.url), 'utf8')
    ))

    expect(source).toMatch(/onKeyDown=\{\(event\) => \{[\s\S]*nextDrawerTabIndex/)
    expect(source).toContain("event.key")
    expect(source).toMatch(/onClick=\{\(\) => !entry\.active && entry\.target && requestDrawerChange/)
  })

  it('marks every source when the same applied sources are reordered', () => {
    const appliedRun: TransformationRun = {
      id: 'run-applied',
      boardId: 'board-1',
      transformationId: transformation.id,
      status: 'succeeded',
      sourceSnapshot: ['source-a', 'source-b'].map((cardId) => ({
        cardId,
        versionId: `${cardId}-v1`,
        contentKind: 'markdown' as const,
        resolvedContent: `# ${cardId}`,
        digest: `digest-${cardId}`,
      })),
      targetCardId: transformation.targetCardId,
      targetBaseVersionId: 'target-v1',
      intent: 'update',
      result: { output: '# 已采用结果', digest: 'applied', disposition: 'applied' },
      createdAt: '2026-08-23T00:00:00.000Z',
    }
    const html = renderRelationDetail(
      {
        ...transformation,
        sourceCardIds: ['source-b', 'source-a'],
        lastRunId: appliedRun.id,
        lastAppliedRunId: appliedRun.id,
      },
      [card('source-a', '# source-a'), card('source-b', '# source-b'), card('target', '# 当前成果')],
      { [appliedRun.id]: appliedRun },
    )

    expect(html).toContain('来源或顺序已变化')
    expect(html).not.toContain('与最近结果一致')
  })

  it('marks a replacement source that has no matching applied snapshot', () => {
    const appliedRun: TransformationRun = {
      id: 'run-applied',
      boardId: 'board-1',
      transformationId: transformation.id,
      status: 'succeeded',
      sourceSnapshot: [{
        cardId: 'source-a',
        versionId: 'source-a-v1',
        contentKind: 'markdown',
        resolvedContent: '# source-a',
        digest: 'digest-source-a',
      }],
      targetCardId: transformation.targetCardId,
      targetBaseVersionId: 'target-v1',
      intent: 'update',
      result: { output: '# 已采用结果', digest: 'applied', disposition: 'applied' },
      createdAt: '2026-08-23T00:00:00.000Z',
    }
    const html = renderRelationDetail(
      {
        ...transformation,
        sourceCardIds: ['source-b'],
        lastRunId: appliedRun.id,
        lastAppliedRunId: appliedRun.id,
      },
      [card('source-b', '# source-b'), card('target', '# 当前成果')],
      { [appliedRun.id]: appliedRun },
    )

    expect(html).toContain('来源或顺序已变化')
    expect(html).not.toContain('与最近结果一致')
  })

  it('does not claim consistency when there is no applied result', () => {
    const candidateRun: TransformationRun = {
      id: 'run-candidate',
      boardId: 'board-1',
      transformationId: transformation.id,
      status: 'succeeded',
      sourceSnapshot: [],
      targetCardId: transformation.targetCardId,
      targetBaseVersionId: 'target-v1',
      intent: 'update',
      result: { output: '# 候选结果', digest: 'candidate', disposition: 'candidate' },
      createdAt: '2026-08-23T00:00:00.000Z',
    }
    const html = renderRelationDetail(
      { ...transformation, lastRunId: candidateRun.id, lastAppliedRunId: undefined },
      [card('source-a', '# 访谈材料'), card('target', '# 当前成果')],
      { [candidateRun.id]: candidateRun },
    )

    expect(html).toContain('尚无已采用结果')
    expect(html).not.toContain('与最近结果一致')
  })

  it('stops the active upstream run while viewing the downstream run-to-here relation', () => {
    const activeRun: TransformationRun = {
      id: 'run-upstream',
      boardId: 'board-1',
      transformationId: 'upstream',
      status: 'running',
      sourceSnapshot: [],
      targetCardId: 'intermediate',
      targetBaseVersionId: null,
      intent: 'create',
      createdAt: '2026-08-23T00:00:00.000Z',
    }
    const html = renderRelationDetail(
      { ...transformation, lastRunId: undefined },
      [card('source-a', '# 访谈材料'), card('target', '# 当前成果')],
      { [activeRun.id]: activeRun },
      transformation.id,
    )

    expect(html).toContain('aria-label="停止生成"')
    expect(html).toContain('停止生成')
  })
})
