import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowRight, ArrowUp, GitBranch, Plus, X } from 'lucide-react'
import type { ContentCard } from '../domain'
import type { V2Suggestion } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import { createCustomSuggestion, sourceCardPresentations } from '../v2View'
import { cardHeadHasUsableContent } from '../workflows'
import { useDrawerAction } from './drawerIntent'
import { useSourcePreview } from './sourcePreviewContext'

export function CreateTransformationButton({
  disabled,
  pending = false,
}: {
  disabled: boolean
  pending?: boolean
}) {
  return <button className="v2-generate-button" type="submit" disabled={disabled}>
    <ArrowRight size={17} />{pending ? '添加中…' : '添加步骤'}
  </button>
}

export async function submitCreateStep(
  pending: { current: boolean },
  setPending: (value: boolean) => void,
  suggestion: V2Suggestion,
  generate: (value: V2Suggestion) => Promise<void>,
) {
  if (pending.current) return
  pending.current = true
  setPending(true)
  try {
    await generate(suggestion)
  } finally {
    pending.current = false
    setPending(false)
  }
}

const MAX_BRANCH_TARGETS = 16

export function BranchTargetEditor({
  values,
  onChange,
  onAdd,
  onRemove,
  onCancel,
  onSubmit,
  submitting,
}: {
  values: string[]
  onChange: (index: number, value: string) => void
  onAdd: () => void
  onRemove: (index: number) => void
  onCancel: () => void
  onSubmit: () => void
  submitting: boolean
}) {
  const ready = values.length > 1 && values.every((value) => value.trim())
  return <form className="v2-branch-target-editor" aria-label="并行拆解" onSubmit={(event) => {
    event.preventDefault()
    if (ready) onSubmit()
  }}>
    <div className="v2-branch-target-tools">
      <div className="v2-branch-target-title"><GitBranch size={14} /><span>并行拆解</span><small>{values.length} 个分支</small></div>
      <button className="v2-icon-button" type="button" aria-label="添加分支" title="添加分支" disabled={values.length >= MAX_BRANCH_TARGETS} onClick={onAdd}><Plus size={16} /></button>
    </div>
    <div className="v2-branch-target-list">
      {values.map((value, index) => <div className="v2-branch-target-row" key={index}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <input value={value} aria-label={`分支 ${index + 1} 的成果`} placeholder="例如：用户流程拆解" disabled={submitting} onChange={(event) => onChange(index, event.target.value)} />
        <button className="v2-icon-button" type="button" aria-label={`删除分支 ${index + 1}`} title="删除分支" disabled={values.length <= 2 || submitting} onClick={() => onRemove(index)}><X size={14} /></button>
      </div>)}
    </div>
    <footer className="v2-branch-target-actions">
      <button className="v2-secondary-button" type="button" disabled={submitting} onClick={onCancel}>取消拆解</button>
      <button className="v2-generate-button" type="submit" disabled={!ready || submitting}><GitBranch size={16} />{submitting ? '添加中…' : `添加 ${values.length} 个分支`}</button>
    </footer>
  </form>
}

export function ContextSourceChips({
  sources,
  onReorder,
  onRemove,
}: {
  sources: ContentCard[]
  onReorder: (fromIndex: number, toIndex: number) => void
  onRemove: (cardId: string) => void
}) {
  const presentations = sourceCardPresentations(sources)
  const preview = useSourcePreview()
  const boardId = useV2Canvas((state) => state.boardId)
  return <>{sources.map((card, index) => {
    const presentation = presentations[index]
    const accessibleLabel = presentation.fullPath
      ? `${presentation.label}，完整路径 ${presentation.fullPath}`
      : presentation.label
    return <div className="v2-source-chip" key={card.id} title={presentation.fullPath || presentation.label}>
      <span>{index + 1}</span><button type="button" className="v2-source-preview-trigger" aria-label={`预览来源：${accessibleLabel}`} disabled={!preview || !boardId} onClick={() => boardId && preview?.({ boardId, cardId: card.id })}><strong>{presentation.label}</strong></button>
      {sources.length > 1 && <><button type="button" disabled={index === 0} aria-label="来源前移" title="来源前移" onClick={() => onReorder(index, index - 1)}><ArrowUp size={12} /></button>
        <button type="button" disabled={index === sources.length - 1} aria-label="来源后移" title="来源后移" onClick={() => onReorder(index, index + 1)}><ArrowDown size={12} /></button></>}
      <button type="button" aria-label="移除来源" title="移除来源" onClick={() => onRemove(card.id)}><X size={12} /></button>
    </div>
  })}</>
}

export function SingleStepControls({
  suggestions,
  suggestionState,
  custom,
  pending,
  onCustomChange,
  onCreate,
  onStartBranch,
}: {
  suggestions: V2Suggestion[]
  suggestionState: 'idle' | 'loading' | 'ready' | 'error'
  custom: string
  pending: boolean
  onCustomChange: (value: string) => void
  onCreate: (suggestion: V2Suggestion) => void
  onStartBranch: () => void
}) {
  const customSuggestion = createCustomSuggestion(custom)
  return <div aria-busy={pending}>
    <div className="v2-suggestions">
      {suggestionState === 'loading' && <><i /><i /><i /></>}
      {suggestions.map((suggestion) => <button
        type="button"
        key={suggestion.id}
        aria-label={`添加步骤：${suggestion.label}`}
        disabled={pending}
        onClick={() => onCreate(suggestion)}
      >{suggestion.label}</button>)}
      {suggestionState === 'error' && <span>建议暂时不可用，你仍可直接描述成果。</span>}
    </div>
    <div className="v2-custom-target-tools">
      <span>添加一个步骤，或拆成多个方向</span>
      <button className="v2-icon-text-button" type="button" aria-label="添加分支" title="添加分支" disabled={pending} onClick={onStartBranch}><Plus size={15} />添加分支</button>
    </div>
    <form className="v2-custom-target" onSubmit={(event) => {
      event.preventDefault()
      if (customSuggestion && !pending) onCreate(customSuggestion)
    }}>
      <input value={custom} disabled={pending} onChange={(event) => onCustomChange(event.target.value)} placeholder="把这些内容变成…" aria-label="自定义成果" />
      <CreateTransformationButton disabled={!customSuggestion || pending} pending={pending} />
    </form>
  </div>
}

export default function ContextDock() {
  const runDrawerAction = useDrawerAction()
  const board = useV2Canvas((state) => state.board)
  const selectedIds = useV2Canvas((state) => state.selectedCardIds)
  const multiSelectMode = useV2Canvas((state) => state.multiSelectMode)
  const branchDraft = useV2Canvas((state) => state.branchDraft)
  const workflowDraft = useV2Canvas((state) => state.workflowDraft)
  const suggestions = useV2Canvas((state) => state.suggestions)
  const suggestionState = useV2Canvas((state) => state.suggestionState)
  const requestSuggestions = useV2Canvas((state) => state.requestSuggestions)
  const generate = useV2Canvas((state) => state.generate)
  const generateBranches = useV2Canvas((state) => state.generateBranches)
  const reorder = useV2Canvas((state) => state.reorderSources)
  const remove = useV2Canvas((state) => state.removeSource)
  const cancelBranch = useV2Canvas((state) => state.cancelBranch)
  const [custom, setCustom] = useState('')
  const [branchMode, setBranchMode] = useState(false)
  const [branchValues, setBranchValues] = useState<string[]>([])
  const [branchSubmitting, setBranchSubmitting] = useState(false)
  const createStepPendingRef = useRef(false)
  const [createStepPending, setCreateStepPending] = useState(false)
  const sources = selectedIds
    .map((id) => board?.cards.find((card) => card.id === id))
    .filter((card): card is ContentCard => Boolean(card))
  const sourceVersionKey = sources.map((card) => card?.headVersionId || '').join('|')
  const sourcesReady = board
    ? sources.length === selectedIds.length
      && selectedIds.every((cardId) => cardHeadHasUsableContent(board, cardId))
    : false
  useEffect(() => {
    if (multiSelectMode || selectedIds.length === 0 || !sourcesReady) return
    const timer = window.setTimeout(() => void requestSuggestions(), 240)
    return () => window.clearTimeout(timer)
  }, [selectedIds.join('|'), sourceVersionKey, sourcesReady, multiSelectMode, branchDraft?.targetPosition.x, branchDraft?.targetPosition.y, requestSuggestions])
  useEffect(() => {
    setCustom(''); setBranchMode(false); setBranchValues([])
  }, [board?.id, selectedIds.join('|')])

  if (workflowDraft) return null
  if (!board || selectedIds.length === 0 || multiSelectMode) return null
  const startBranchMode = () => {
    setBranchMode(true)
    setBranchValues([custom, ''])
  }
  const cancelBranchMode = () => {
    setBranchMode(false)
    setBranchValues([])
  }
  const submitBranches = () => {
    const branchSuggestions = branchValues
      .map((value) => createCustomSuggestion(value))
      .filter((suggestion): suggestion is NonNullable<typeof suggestion> => Boolean(suggestion))
    if (branchSuggestions.length !== branchValues.length || branchSuggestions.length < 2) return
    runDrawerAction(async () => {
      setBranchSubmitting(true)
      try {
        await generateBranches(branchSuggestions)
      } finally {
        setBranchSubmitting(false)
      }
    })
  }
  const createStep = (suggestion: V2Suggestion) => {
    runDrawerAction(() => submitCreateStep(
      createStepPendingRef,
      setCreateStepPending,
      suggestion,
      generate,
    ))
  }

  return <section className="v2-context-dock" aria-label="内容推进" aria-live="polite">
    <div className="v2-dock-sources">
      {branchDraft && <span className="v2-branch-label"><GitBranch size={14} />新方向</span>}
      <ContextSourceChips sources={sources} onReorder={reorder} onRemove={remove} />
      {branchDraft && <button className="v2-cancel-branch" type="button" onClick={cancelBranch}>取消新方向</button>}
    </div>
    {!branchMode && <SingleStepControls
      suggestions={suggestions}
      suggestionState={suggestionState}
      custom={custom}
      pending={createStepPending}
      onCustomChange={setCustom}
      onCreate={createStep}
      onStartBranch={startBranchMode}
    />}
    {branchMode && <BranchTargetEditor
      values={branchValues}
      onChange={(index, value) => setBranchValues((current) => current.map((item, itemIndex) => itemIndex === index ? value : item))}
      onAdd={() => setBranchValues((current) => current.length >= MAX_BRANCH_TARGETS ? current : [...current, ''])}
      onRemove={(index) => setBranchValues((current) => current.filter((_item, itemIndex) => itemIndex !== index))}
      onCancel={cancelBranchMode}
      onSubmit={submitBranches}
      submitting={branchSubmitting}
    />}
  </section>
}
