import { beforeEach, describe, expect, it } from 'vitest'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReactFlowProvider } from '@xyflow/react'
import type { BoardV2, ContentCard, Transformation, WorkflowTemplate } from '../domain'
import { useV2Canvas } from '../v2Store'
import AppBar from './AppBar'
import { EmptyCardMessage } from './ContentCard'
import ContextDock, { BranchTargetEditor, ContextSourceChips, CreateTransformationButton } from './ContextDock'
import {
  SaveWorkflowControl,
  SaveWorkflowForm,
  TransformationRunControl,
  WorkflowProvenancePanel,
  transformationEditCommandLabel,
} from './DetailDrawer'
import { PlanComposer, WorkflowDeleteControl, WorkflowLibraryView } from './WorkflowLibrary'
import { TransformationCardView } from './TransformationNode'
import { WorkflowDraftActions } from './WorkflowDraftNodes'

const now = '2026-08-23T00:00:00.000Z'

function card(id: string, versionId: string): ContentCard {
  return {
    id,
    contentKind: 'markdown',
    x: 0,
    y: 0,
    width: 300,
    height: 180,
    headVersionId: versionId,
    versions: [{
      id: versionId,
      cardId: id,
      sequence: 1,
      content: { kind: 'markdown', markdown: `# ${id}` },
      digest: `digest-${id}`,
      origin: 'human',
      createdAt: now,
    }],
    createdAt: now,
    updatedAt: now,
  }
}

function transformation(id: string, sourceCardIds: string[], targetCardId: string): Transformation {
  return {
    id,
    sourceCardIds,
    targetCardId,
    label: id === 'collect' ? '整理证据' : '形成结论',
    instruction: `执行 ${id}`,
    acceptance: id === 'collect' ? '证据完整' : '结论可追溯',
    permissions: { workspaceWrite: false },
    createdAt: now,
    updatedAt: now,
  }
}

const collect = transformation('collect', ['source'], 'draft')
const conclude = transformation('conclude', ['draft'], 'final')
const workflow: WorkflowTemplate = {
  id: 'workflow-1',
  title: '课题研究',
  description: '',
  inputs: [{ id: 'input-material', name: '研究材料', description: '用于形成证据的原始内容', required: true, cardinality: 'many' }],
  steps: [
    { id: 'step-1', label: '整理证据', instruction: '整理材料', acceptance: '证据完整', sources: [{ kind: 'input', inputId: 'input-material' }] },
    { id: 'step-2', label: '形成结论', instruction: '形成结论', acceptance: '结论可追溯', sources: [{ kind: 'previous-output' }] },
  ],
  createdAt: now,
  updatedAt: now,
}

const sourceSummaries = [
  { cardId: 'source', title: '访谈材料', versionId: 'version-source', versionLabel: 'v1' },
  { cardId: 'reference', title: '背景资料', versionId: 'version-reference', versionLabel: 'v3' },
]

const planCollect: Transformation = {
  ...collect,
  workflowRef: { workflowId: workflow.id, stepId: 'step-1', applicationId: 'application-1' },
}
const planConclude: Transformation = {
  ...conclude,
  workflowRef: { workflowId: workflow.id, stepId: 'step-2', applicationId: 'application-1' },
}

function board(): BoardV2 {
  return {
    schemaVersion: 2,
    id: 'board-1',
    title: '研究画板',
    cards: [card('source', 'version-source'), card('draft', 'version-draft'), card('final', 'version-final')],
    transformations: [collect, conclude],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: now,
    updatedAt: now,
  }
}

beforeEach(() => {
  useV2Canvas.setState({
    boardId: 'board-1',
    board: board(),
    boards: [{ id: 'board-1', title: '研究画板' }],
    workflows: [workflow],
    workflowState: 'ready',
    applyingWorkflowId: null,
    workflowDraft: null,
    selectedCardIds: ['source'],
    suggestions: [],
    suggestionState: 'idle',
    branchDraft: null,
    drawer: null,
    message: null,
    runs: {},
  })
})

describe('workflow UX', () => {
  it('offers the workflow library as a primary app-bar command, not an advanced mode', () => {
    const html = renderToStaticMarkup(
      createElement(
        ReactFlowProvider,
        null,
        createElement(AppBar, {
          openPlanComposer: () => undefined,
          openWorkflowLibrary: () => undefined,
          openModelSettings: () => undefined,
        }),
      ),
    )

    expect(html).toContain('aria-label="方法与计划"')
    expect(html).not.toContain('aria-label="搭计划"')
    expect(html).toContain('模型设置')
    expect(html).not.toContain('高级模式')
  })

  it('shows templates, ordered steps, close, and delete in the library', () => {
    const html = renderToStaticMarkup(createElement(WorkflowLibraryView, {
      workflows: [workflow],
      state: 'ready',
      onClose: () => undefined,
      onDelete: () => undefined,
      onUse: () => undefined,
    }))

    expect(html).toContain('aria-label="方法与计划"')
    expect(html).toContain('课题研究')
    const steps = html.match(/<ol class="v2-workflow-step-list">([\s\S]*?)<\/ol>/)?.[1] || ''
    expect(steps).toContain('整理证据')
    expect(steps).toContain('形成结论')
    expect(steps.indexOf('整理证据')).toBeLessThan(steps.indexOf('形成结论'))
    expect(html).toContain('aria-label="删除方法 课题研究"')
    expect(html).toContain('aria-label="关闭方法与计划"')
    expect(html).toContain('研究材料')
    expect(html).toContain('使用')
  })

  it('keeps starting an ad-hoc plan reachable when the method library is empty', () => {
    const LibraryWithPlanEntry = WorkflowLibraryView as ComponentType<{
      workflows: WorkflowTemplate[]
      state: 'idle' | 'loading' | 'ready' | 'error'
      onClose: () => void
      onDelete: (workflowId: string) => void
      onUse: (workflowId: string) => void
      onBuildPlan: () => void
    }>
    const html = renderToStaticMarkup(createElement(LibraryWithPlanEntry, {
      workflows: [],
      state: 'ready',
      onClose: () => undefined,
      onDelete: () => undefined,
      onUse: () => undefined,
      onBuildPlan: () => undefined,
    }))

    expect(html).toContain('还没有保存的方法')
    expect(html).toContain('搭一个计划</strong>')
  })

  it('shows an error instead of also claiming that the method library is empty', () => {
    const html = renderToStaticMarkup(createElement(WorkflowLibraryView, {
      workflows: [],
      state: 'error',
      onClose: () => undefined,
      onDelete: () => undefined,
      onUse: () => undefined,
      onRefresh: () => undefined,
    }))

    expect(html).toContain('方法暂时无法读取')
    expect(html).toContain('重新加载')
    expect(html).not.toContain('还没有保存的方法')
  })

  it('keeps a cached list visible while making its refresh error observable', () => {
    const html = renderToStaticMarkup(createElement(WorkflowLibraryView, {
      workflows: [workflow],
      state: 'error',
      onClose: () => undefined,
      onDelete: () => undefined,
      onUse: () => undefined,
      onRefresh: () => undefined,
    }))

    expect(html).toContain('课题研究')
    expect(html).toContain('刷新失败，当前显示上次载入的方法')
    expect(html).toContain('role="alert"')
    expect(html).toContain('重新加载')
    expect(html).not.toContain('还没有保存的方法')
  })

  it('renders a reachable ad-hoc plan form and disables preview while required fields are blank', () => {
    const html = renderToStaticMarkup(createElement(PlanComposer, {
      value: { title: '', finalOutcome: '', steps: [''] },
      onChange: () => undefined,
      onCancel: () => undefined,
      onPreview: () => undefined,
    }))

    expect(html).toContain('aria-label="搭一个计划"')
    expect(html).toContain('计划名称')
    expect(html).toContain('最终成果名称')
    expect(html).toContain('最后一步直接使用这个成果名称')
    expect(html).toContain('步骤 1 · 处理要求')
    expect(html).toContain('aria-label="新增步骤"')
    expect(html).toContain('aria-label="取消搭计划"')
    const preview = html.match(/<button[^>]*aria-label="在画布预览计划"[^>]*>/)?.[0]
    expect(preview).toContain('disabled=""')
  })

  it('shows file sources with distinct compact labels and exposes their full paths', () => {
    const fileSource = (id: string, path: string): ContentCard => ({
      ...card(id, `${id}-version`),
      contentKind: 'file-reference',
      versions: [{
        ...card(id, `${id}-version`).versions[0],
        content: { kind: 'file-reference', path, readonly: true },
      }],
    })
    const html = renderToStaticMarkup(createElement(ContextSourceChips, {
      sources: [
        fileSource('alpha', 'research/alpha/a-very-long-evidence-file-name.md'),
        fileSource('beta', 'research/beta/a-very-long-evidence-file-name.md'),
      ],
      onReorder: () => undefined,
      onRemove: () => undefined,
    }))

    expect(html).toContain('class="v2-source-chip"')
    expect(html).toContain('alpha/a-very-long-evidence-file-name.md')
    expect(html).toContain('beta/a-very-long-evidence-file-name.md')
    expect(html).toContain('title="research/alpha/a-very-long-evidence-file-name.md"')
    expect(html).toContain('完整路径 research/alpha/a-very-long-evidence-file-name.md')
  })

  it('preserves ordered step values and exposes accessible sorting controls', () => {
    const html = renderToStaticMarkup(createElement(PlanComposer, {
      value: {
        title: '研究简报计划',
        finalOutcome: '一页研究简报',
        steps: ['提取关键证据', '形成判断', '整理为可审阅简报'],
      },
      onChange: () => undefined,
      onCancel: () => undefined,
      onPreview: () => undefined,
    }))

    expect(html.indexOf('提取关键证据')).toBeLessThan(html.indexOf('形成判断'))
    expect(html.indexOf('形成判断')).toBeLessThan(html.indexOf('整理为可审阅简报'))
    expect(html).toContain('aria-label="下移步骤 1"')
    expect(html).toContain('aria-label="上移步骤 2"')
    expect(html).toContain('aria-label="删除步骤 2"')
    const preview = html.match(/<button[^>]*aria-label="在画布预览计划"[^>]*>/)?.[0]
    expect(preview).toBeTruthy()
    expect(preview).not.toContain('disabled=""')
  })

  it('names the single create command as adding a step', () => {
    const html = renderToStaticMarkup(createElement(CreateTransformationButton, {
      disabled: false,
    }))

    expect(html).toContain('添加步骤')
    expect(html).not.toContain('生成')
  })

  it('renders editable parallel branch targets with add and remove controls', () => {
    const html = renderToStaticMarkup(createElement(BranchTargetEditor, {
      values: ['用户流程', '技术方案'],
      onChange: () => undefined,
      onAdd: () => undefined,
      onRemove: () => undefined,
      onCancel: () => undefined,
      onSubmit: () => undefined,
      submitting: false,
    }))

    expect(html).toContain('aria-label="分支 1 的成果"')
    expect(html).toContain('aria-label="分支 2 的成果"')
    expect(html).toContain('class="v2-branch-target-tools"')
    expect(html).toContain('class="v2-branch-target-actions"')
    expect(html).toContain('aria-label="添加分支"')
    expect(html).toContain('aria-label="删除分支 2"')
    expect(html).toContain('添加 2 个分支')
  })

  it('allows adding branches up to the sixteen-target limit', () => {
    const underLimit = renderToStaticMarkup(createElement(BranchTargetEditor, {
      values: Array.from({ length: 15 }, (_item, index) => `方向 ${index + 1}`),
      onChange: () => undefined,
      onAdd: () => undefined,
      onRemove: () => undefined,
      onCancel: () => undefined,
      onSubmit: () => undefined,
      submitting: false,
    }))
    const atLimit = renderToStaticMarkup(createElement(BranchTargetEditor, {
      values: Array.from({ length: 16 }, (_item, index) => `方向 ${index + 1}`),
      onChange: () => undefined,
      onAdd: () => undefined,
      onRemove: () => undefined,
      onCancel: () => undefined,
      onSubmit: () => undefined,
      submitting: false,
    }))

    expect(underLimit).toContain('aria-label="添加分支"')
    expect(underLimit).not.toMatch(/aria-label="添加分支"[^>]*disabled/)
    expect(atLimit).toMatch(/aria-label="添加分支"[^>]*disabled/)
  })

  it('shows draft progress and confirmation inside the first method step', () => {
    const html = renderToStaticMarkup(createElement(WorkflowDraftActions, {
      workflow,
      draft: { workflowId: workflow.id, origin: { x: 500, y: 100 }, bindings: {} },
      onCancel: () => undefined,
      onCreate: () => undefined,
    }))

    expect(html).toContain('0/1 必填')
    expect(html).toContain('不会自动生成')
    expect(html).toContain('添加步骤')
    expect(html).toContain('disabled=""')
  })

  it('uses direct-plan commands and prevents cancellation during atomic creation', () => {
    const html = renderToStaticMarkup(createElement(WorkflowDraftActions, {
      workflow,
      draft: {
        workflowId: 'ad-hoc-plan-draft',
        source: { kind: 'ad-hoc' },
        definition: workflow,
        origin: { x: 500, y: 100 },
        bindings: { 'input-material': ['source'] },
      },
      applying: true,
      onCancel: () => undefined,
      onCreate: () => undefined,
    }))

    expect(html).toContain('aria-label="取消搭计划"')
    expect(html).toContain('添加中')
    const cancel = html.match(/<button[^>]*aria-label="取消搭计划"[^>]*>/)?.[0]
    expect(cancel).toContain('disabled=""')
  })

  it('does not render a second bottom dock while connecting a method', () => {
    useV2Canvas.setState({
      workflowDraft: { workflowId: workflow.id, origin: { x: 500, y: 100 }, bindings: {} },
    })
    const html = renderToStaticMarkup(createElement(
      ReactFlowProvider,
      null,
      createElement(ContextDock),
    ))

    expect(html).toBe('')
  })

  it('keeps transformation cards compact and moves model detail out of the canvas', () => {
    const html = renderToStaticMarkup(createElement(TransformationCardView, {
      data: {
        transformationId: 'collect',
        label: '整理证据',
        sourceCount: 2,
        modelId: 'reasoning-model',
        status: 'idle',
        stale: false,
        collapsedSources: false,
      },
      onRun: () => undefined,
    }))

    expect(html).toContain('2 个来源')
    expect(html).toContain('整理证据')
    expect(html).not.toContain('reasoning-model')
    expect(html).not.toContain('默认模型')
    expect(html).toContain('运行到这里')
  })

  it('keeps a real stop command available while a transformation is running', () => {
    const html = renderToStaticMarkup(createElement(TransformationCardView, {
      data: {
        transformationId: 'collect',
        label: '整理证据',
        sourceCount: 2,
        status: 'running',
        runId: 'run-1',
        stale: false,
        collapsedSources: false,
      },
      onRun: () => undefined,
      onStop: () => undefined,
    }))

    expect(html).toContain('aria-label="停止生成"')
    expect(html).not.toContain('disabled=""')
  })

  it('keeps the stop command available inside a running relation detail', () => {
    const html = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: false,
      hasRun: true,
      sourcesReady: true,
      candidatePending: false,
      busy: true,
      running: true,
      onRun: () => undefined,
      onStop: async () => undefined,
    } as Parameters<typeof TransformationRunControl>[0]))

    expect(html).toContain('aria-label="停止生成"')
    expect(html).toContain('停止生成')
    expect(html).not.toContain('正在运行到这里')
  })

  it('calls a direct-plan relation a step instead of an already saved method', () => {
    const directStep = {
      ...collect,
      planRef: {
        planId: 'plan-1', source: 'ad-hoc' as const, title: '研究计划', stepIndex: 1, stepTotal: 1,
      },
    }
    expect(transformationEditCommandLabel(directStep)).toBe('编辑步骤')
    expect(transformationEditCommandLabel(planCollect)).toBe('编辑步骤')
    expect(transformationEditCommandLabel(collect)).toBe('编辑转化')
  })

  it('offers saving the selected relation and its linear downstream steps', () => {
    const html = renderToStaticMarkup(createElement(SaveWorkflowControl, {
      preview: { chain: [collect, conclude], stopReason: null },
      sources: sourceSummaries.slice(0, 1),
      onSave: async () => true,
    }))

    expect(html).toContain('保存为方法')
    expect(html).toContain('2 步')
  })

  it('disables saving when a step does not yet have a committed result', () => {
    const html = renderToStaticMarkup(createElement(SaveWorkflowControl, {
      preview: { chain: [], stopReason: 'downstream-unfinished' },
      sources: sourceSummaries.slice(0, 1),
      disabled: true,
      onSave: async () => true,
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('成果未完成')
  })

  it('explains when a cycle prevents workflow extraction', () => {
    const html = renderToStaticMarkup(createElement(SaveWorkflowControl, {
      preview: { chain: [], stopReason: 'cycle' },
      sources: sourceSummaries.slice(0, 1),
      onSave: async () => true,
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('存在循环')
    expect(html).not.toContain('成果未完成')
  })

  it('explains exactly what is extracted before saving a workflow', () => {
    const html = renderToStaticMarkup(createElement(SaveWorkflowForm, {
      preview: { chain: [collect], stopReason: 'downstream-unfinished' },
      sources: sourceSummaries,
      initialTitle: '整理证据',
      onCancel: () => undefined,
      onSave: async () => true,
    }))

    expect(html).toContain('方法说明（可选）')
    expect(html).toContain('输入名称')
    expect(html).toContain('数量')
    expect(html).toContain('可多选')
    expect(html.indexOf('访谈材料')).toBeLessThan(html.indexOf('背景资料'))
    expect(html).toContain('整理证据')
    expect(html).toContain('执行 collect')
    expect(html).toContain('证据完整')
    expect(html).toContain('后续成果尚未完成')
    expect(html).toContain('只保存方法，不复制当前内容')
  })

  it('shows workflow provenance and navigation across one application', () => {
    const html = renderToStaticMarkup(createElement(WorkflowProvenancePanel, {
      workflow,
      applicationId: 'application-1',
      steps: [planCollect, planConclude],
      currentTransformationId: planCollect.id,
      onNavigate: () => undefined,
    }))

    expect(html).toContain('课题研究')
    expect(html).toContain('application-1')
    expect(html).toContain('当前步骤 1/2')
    expect(html).toContain('aria-label="打开步骤 2：形成结论"')
    expect(html).not.toContain('运行全部')
  })

  it('shows an ad-hoc plan name and navigation without pretending it came from a method', () => {
    const html = renderToStaticMarkup(createElement(WorkflowProvenancePanel, {
      planTitle: '发布判断',
      planSource: 'ad-hoc',
      planId: 'plan-1',
      steps: [
        { ...collect, planRef: { planId: 'plan-1', source: 'ad-hoc', title: '发布判断', stepIndex: 1, stepTotal: 2 } },
        { ...conclude, planRef: { planId: 'plan-1', source: 'ad-hoc', title: '发布判断', stepIndex: 2, stepTotal: 2 } },
      ],
      currentTransformationId: collect.id,
      onNavigate: () => undefined,
    }))

    expect(html).toContain('直接计划')
    expect(html).toContain('发布判断')
    expect(html).toContain('计划 ID')
    expect(html).toContain('plan-1')
    expect(html).toContain('aria-label="打开步骤 2：形成结论"')
    expect(html).not.toContain('来自方法')
    expect(html).not.toContain('模板已删除')
  })

  it('preserves original plan numbering after a step is removed', () => {
    const first = {
      ...collect,
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '发布判断', stepIndex: 1, stepTotal: 3 },
    }
    const third = {
      ...conclude,
      planRef: { planId: 'plan-1', source: 'ad-hoc' as const, title: '发布判断', stepIndex: 3, stepTotal: 3 },
    }
    const html = renderToStaticMarkup(createElement(WorkflowProvenancePanel, {
      planTitle: '发布判断',
      planSource: 'ad-hoc',
      planId: 'plan-1',
      planStepTotal: 3,
      steps: [first, third],
      currentTransformationId: third.id,
      onNavigate: () => undefined,
    }))

    expect(html).toContain('当前步骤 3/3')
    expect(html).toContain('<span>3/3</span><strong>形成结论</strong>')
    expect(html).toContain('计划已调整')
  })

  it('shows a persisted adjustment after a planned step is edited', () => {
    const edited = {
      ...collect,
      planRef: {
        planId: 'plan-1', source: 'ad-hoc' as const, title: '发布判断',
        stepIndex: 1, stepTotal: 1, adjusted: true,
      },
    }
    const html = renderToStaticMarkup(createElement(WorkflowProvenancePanel, {
      planTitle: '发布判断',
      planSource: 'ad-hoc',
      planId: 'plan-1',
      planStepTotal: 1,
      steps: [edited],
      currentTransformationId: edited.id,
      onNavigate: () => undefined,
    }))

    expect(html).toContain('计划已调整')
  })

  it('keeps an applied plan understandable after its template is deleted', () => {
    const html = renderToStaticMarkup(createElement(WorkflowProvenancePanel, {
      applicationId: 'application-1',
      steps: [planCollect, planConclude],
      currentTransformationId: planConclude.id,
      onNavigate: () => undefined,
    }))

    expect(html).toContain('模板已删除')
    expect(html).toContain('已有计划仍可运行到任一步')
    expect(html).toContain('当前步骤 2/2')
  })

  it('requires an explicit second confirmation before deleting a template', () => {
    const initial = renderToStaticMarkup(createElement(WorkflowDeleteControl, {
      workflow,
      confirming: false,
      onRequest: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }))
    const confirming = renderToStaticMarkup(createElement(WorkflowDeleteControl, {
      workflow,
      confirming: true,
      onRequest: () => undefined,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }))

    expect(initial).toContain('aria-label="删除方法 课题研究"')
    expect(initial).not.toContain('确认删除')
    expect(confirming).toContain('删除模板？')
    expect(confirming).toContain('不影响已有计划')
    expect(confirming).toContain('确认删除')
    expect(confirming).toContain('取消')
  })

  it('uses the same run-to-here command before and after generation', () => {
    const firstRun = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: true,
      hasRun: false,
      sourcesReady: true,
      candidatePending: false,
      onRun: () => undefined,
    }))
    const rerun = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: true,
      hasRun: true,
      sourcesReady: true,
      candidatePending: false,
      onRun: () => undefined,
    }))

    expect(firstRun).toContain('运行到这里')
    expect(rerun).toContain('运行到这里')
    expect(rerun).not.toContain('重新生成')
  })

  it('uses run-to-here for an ordinary transformation too', () => {
    const html = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: false,
      hasRun: false,
      sourcesReady: true,
      candidatePending: false,
      onRun: () => undefined,
    }))

    expect(html).toContain('运行到这里')
  })

  it('allows a downstream run when an upstream target is not generated yet', () => {
    const html = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: true,
      hasRun: false,
      sourcesReady: false,
      candidatePending: false,
      onRun: () => undefined,
    }))

    expect(html).not.toContain('disabled=""')
    expect(html).toContain('运行到这里')
  })

  it('blocks regeneration while a candidate result still needs a decision', () => {
    const html = renderToStaticMarkup(createElement(TransformationRunControl, {
      workflowStep: true,
      hasRun: true,
      sourcesReady: true,
      candidatePending: true,
      onRun: () => undefined,
    }))

    expect(html).toContain('disabled=""')
    expect(html).toContain('先处理待比较结果')
    expect(html).not.toContain('基于最新来源重新生成')
  })

  it('distinguishes a waiting workflow target from an ordinary empty card', () => {
    const waiting = renderToStaticMarkup(createElement(EmptyCardMessage, { waitingExecution: true }))
    const ordinary = renderToStaticMarkup(createElement(EmptyCardMessage, { waitingExecution: false }))

    expect(waiting).toContain('等待生成')
    expect(ordinary).toContain('开始写下内容…')
  })
})
