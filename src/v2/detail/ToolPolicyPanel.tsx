import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toolPhases, type ToolDefinition, type ToolPhase, type ToolPolicy } from '../../domain/toolPolicy.js'
import { v2Api } from '../../v2Api'
import { useV2Canvas } from '../../v2Store'
import { useDrawerAction } from '../drawerIntent'
import { useInspectorDraft } from '../inspectorDrafts'
import { sourceEditBlock } from '../transformationSources'
import { availableToolCatalog, draftToolPolicy, missingRequiredTools, toolCatalogKey, toolDrafts, toolSourceLabels, type ToolDraft } from './toolControls'

export function ToolPolicyEditor({ drafts, onChange, catalog, disabled, runtime }: {
  drafts: ToolDraft[]; onChange: (drafts: ToolDraft[]) => void; catalog: ToolDefinition[]; disabled: boolean
  runtime?: { mcp: boolean; python: boolean }
}) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('')
  const unavailable = (tool: ToolDefinition) => tool.source === 'mcp' ? runtime?.mcp === false : tool.source === 'python' ? runtime?.python === false : false
  const change = (index: number, patch: Partial<ToolDraft>) => onChange(drafts.map((item, i) => i === index ? { ...item, ...patch } : item))
  const move = (index: number, direction: number) => {
    const next = [...drafts]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; onChange(next)
  }
  const filtered = catalog.filter(tool => (!source || tool.source === source) && `${tool.title} ${tool.description} ${tool.name}`.toLowerCase().includes(query.toLowerCase()))
  return <div className="v2-step-tools-editor">
    <div className="v2-tool-filters"><label>搜索工具<input type="search" value={query} onChange={e => setQuery(e.target.value)} /></label><label>工具来源<select value={source} onChange={e => setSource(e.target.value)}><option value="">全部来源</option>{Object.entries(toolSourceLabels).map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label></div>
    <ul className="v2-tool-catalog">{filtered.map(tool => <li key={toolCatalogKey(tool)}><div><strong>{tool.title}</strong><small>{toolSourceLabels[tool.source]} · {unavailable(tool) ? '当前宿主不可用' : tool.effect === 'review' ? '每次执行前审阅' : tool.effect === 'check' ? '检查实际正文' : '读取已选范围'}</small><p>{tool.description}</p></div><button type="button" className="v2-secondary-button" disabled={disabled || drafts.length >= 8 || unavailable(tool)} aria-label={`添加${tool.title}`} onClick={() => onChange([...drafts, { id: crypto.randomUUID(), tool, phase: tool.phases[0], argumentsText: '{}', urlsText: '' }])}>添加</button></li>)}</ul>
    {!filtered.length && <p>没有匹配的工具。请更换搜索词或在能力管理中启用。</p>}
    <h4>本步工具 · {drafts.length}/8</h4>
    {drafts.length > 0 && <p className="v2-detail-note">按生成前、模型按需、生成后执行；同一阶段沿列表顺序。</p>}
    {!drafts.length && <p>尚未选择工具。只使用本步来源生成正文。</p>}
    <ol className="v2-selected-tools">{drafts.map((item, index) => <li key={item.id}><div className="v2-tool-row-heading"><strong>{index + 1}. {item.tool.title}</strong><span>{toolSourceLabels[item.tool.source]} · {toolPhases[item.phase]}</span></div>
      <div className="v2-tool-actions"><button type="button" className="v2-quiet-button" disabled={disabled || index === 0} aria-label={`上移${item.tool.title}`} onClick={() => move(index, -1)}>上移</button><button type="button" className="v2-quiet-button" disabled={disabled || index === drafts.length - 1} aria-label={`下移${item.tool.title}`} onClick={() => move(index, 1)}>下移</button><button type="button" className="v2-quiet-button" disabled={disabled} aria-label={`移除${item.tool.title}`} onClick={() => onChange(drafts.filter((_, i) => i !== index))}>移除</button></div>
      {(item.tool.requiresBinding || !catalog.some(tool => toolCatalogKey(tool) === toolCatalogKey(item.tool))) && <p role="status">工具待重新绑定。核对当前目录并重新选择后才能运行。</p>}
      <label>工具绑定<select disabled={disabled} value={item.tool.requiresBinding ? '' : toolCatalogKey(item.tool)} onChange={e => {
        const tool = catalog.find(candidate => toolCatalogKey(candidate) === e.target.value)
        if (tool) change(index, { tool, phase: tool.phases.includes(item.phase) ? item.phase : tool.phases[0], argumentsText: '{}', urlsText: '' })
      }}><option value="" disabled>请选择当前可用工具</option>{!item.tool.requiresBinding && !catalog.some(tool => toolCatalogKey(tool) === toolCatalogKey(item.tool)) && <option value={toolCatalogKey(item.tool)}>已保存：{item.tool.title}</option>}{catalog.map(tool => <option key={toolCatalogKey(tool)} value={toolCatalogKey(tool)} disabled={unavailable(tool)}>{tool.title} · {toolSourceLabels[tool.source]}{unavailable(tool) ? ' · 当前不可用' : ''}</option>)}</select></label>
      <label>调用方式<select value={item.phase} disabled={disabled} onChange={e => change(index, { phase: e.target.value as ToolPhase })}>{Object.entries(toolPhases).map(([phase, title]) => <option key={phase} value={phase} disabled={!item.tool.phases.includes(phase as ToolPhase)}>{title}{!item.tool.phases.includes(phase as ToolPhase) ? ' · 此工具不支持' : ''}</option>)}</select></label>
      <p className="v2-detail-note">{item.phase === 'model' ? '模型可以调用，不保证使用。' : item.phase === 'before' ? '按顺序执行，失败时停止生成。' : '检查实际正文，保留结果和诊断。'}{item.tool.source === 'mcp' ? '参数将发送到所选连接；只读声明不允许模型修改已绑定参数。' : '仅使用本次冻结来源和明确参数。'}</p>
      <label>参数 JSON<textarea rows={5} value={item.argumentsText} readOnly={disabled} spellCheck={false} onChange={e => change(index, { argumentsText: e.target.value })} /></label>
      {item.tool.id === 'mira-csv-summary' && <p className="v2-detail-note">sourceIndex 按来源顺序从 0 开始编号。</p>}
      {(item.tool.id === 'mira-web-read' || item.urlsText) && <label>允许读取的网址（每行一个）<textarea rows={3} value={item.urlsText} readOnly={disabled} onChange={e => change(index, { urlsText: e.target.value })} /><small>仅允许这些完整地址，不自动读取页面中的其他链接。</small></label>}
      <details><summary>查看参数说明与工具身份</summary><pre>{JSON.stringify(item.tool.inputSchema, null, 2)}</pre><p>{item.tool.id} · {item.tool.name}</p>{item.tool.bindingId && <p>连接或脚本：{item.tool.bindingId}</p>}<p>版本：{item.tool.version}</p></details>
    </li>)}</ol>
  </div>
}

export function ToolPolicyPanel({ transformationId, onDirtyChange }: { transformationId: string; onDirtyChange?: (dirty: boolean) => void }) {
  const board = useV2Canvas(state => state.board)
  const runs = useV2Canvas(state => state.runs)
  const update = useV2Canvas(state => state.updateTransformation)
  const open = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const step = board?.transformations.find(item => item.id === transformationId)
  const [initial] = useState(() => step)
  const [drafts, setDrafts] = useState(() => toolDrafts(initial?.toolPolicy))
  const [temporary, setTemporary] = useState(initial?.toolPolicy?.allowTemporaryPython || false)
  const [catalog, setCatalog] = useState<ToolDefinition[]>([])
  const [runtime, setRuntime] = useState<{ mcp: boolean; python: boolean }>()
  const [pythonPrepared, setPythonPrepared] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const lock = useRef(false)
  const alive = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus(); alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true; setLoading(true); setError('')
    void v2Api.getCapabilities().then(result => { if (current) { setCatalog(availableToolCatalog(result)); setRuntime(result.runtime); setPythonPrepared(Boolean(result.settings.pythonImageId)) } })
      .catch(() => { if (current) setError('工具目录未能读取，已保存配置保留。请重新读取目录。') })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [reload])
  const dirty = !finished && (JSON.stringify(drafts) !== JSON.stringify(toolDrafts(initial?.toolPolicy)) || temporary !== Boolean(initial?.toolPolicy?.allowTemporaryPython))
  useLayoutEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  const blocked = !board || !step ? '这一步已不可用。' : sourceEditBlock(board, step, runs)?.replace('来源', '工具设置')
  const conflict = step?.updatedAt !== initial?.updatedAt
  let policy: ToolPolicy | undefined; let validation = ''
  try { policy = draftToolPolicy(drafts, temporary) } catch (cause) { validation = cause instanceof Error ? cause.message : '请核对工具设置。' }
  const missing = missingRequiredTools(initial?.guidance?.requiredTools, policy)
  const disabled = saving || Boolean(blocked) || conflict
  const back = () => open({ tab: 'relation', transformationId, focusTools: true })
  const save = async () => {
    if (lock.current || disabled || loading || validation || !policy || !dirty || !initial) return false
    lock.current = true; setSaving(true); setError('')
    const drawer = useV2Canvas.getState().drawer
    try {
      const saved = await update(transformationId, { toolPolicy: policy }, initial.updatedAt)
      if (!alive.current) return saved
      if (saved) { setFinished(true); if (useV2Canvas.getState().drawer === drawer) back() }
      else setError('未确认设置已保存，草稿已保留。请核对画板提示。')
      return saved
    } catch { if (alive.current) setError('保存失败，草稿已保留。请重新核对。'); return false }
    finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  useInspectorDraft(`tools:${transformationId}`, dirty, save, disabled || Boolean(validation) || loading)
  return <section className="v2-extraction-panel v2-guidance-panel v2-step-tools" aria-label="工具能力" aria-busy={loading || saving}>
    <h3 ref={heading} tabIndex={-1}>工具能力</h3><p>保存后，下次明确运行才生效。选择指导不会自动授权工具。</p>
    {initial?.guidance && <div><p>指导必需：{initial.guidance.requiredTools?.join('、') || '无'}</p><p>指导可选：{initial.guidance.optionalTools?.join('、') || '无'}</p>{missing.length > 0 && <p role="status">缺少必需工具：{missing.join('、')}。可以保存设置，补齐后才能运行。</p>}</div>}
    {loading && <p role="status">正在读取工具目录…</p>}
    <ToolPolicyEditor drafts={drafts} onChange={setDrafts} catalog={catalog} disabled={disabled || loading} runtime={runtime} />
    <label className="v2-tool-temporary"><input type="checkbox" checked={temporary} disabled={disabled || loading || ((runtime?.python === false || !pythonPrepared) && !temporary)} onChange={e => setTemporary(e.target.checked)} />允许生成临时 Python 代码</label><p className="v2-detail-note">只允许提出代码。完整代码经你审阅后才执行；无网络、无项目目录访问。</p>
    {runtime?.python === false && <p>当前宿主没有可用 Python 执行能力，请在能力管理中核对环境。</p>}
    {runtime?.python && <p>{pythonPrepared ? '运行前会再次核对实际隔离状态。' : '请先在能力管理中准备 Python 镜像，再开启临时代码。'}</p>}
    <p className="v2-detail-note">每次运行最多 8 次工具调用、4 轮模型工具响应；单工具通常限时 30 秒。</p>
    {(error || blocked || conflict || validation) && <p role="alert">{error || blocked || (conflict ? '步骤已在别处修改，草稿保留。请复制需要的参数后重新打开核对。' : validation)}</p>}
    {error && <button type="button" className="v2-secondary-button" disabled={loading || saving} onClick={() => setReload(reload + 1)}>重新读取目录</button>}
    <footer className="v2-scope-footer"><button type="button" className="v2-secondary-button" disabled={saving} onClick={() => action(back)}>返回生成步骤</button><button type="button" className="v2-primary-button" disabled={!dirty || disabled || loading || Boolean(validation)} onClick={() => void save()}>{saving ? '正在保存…' : '保存工具设置'}</button></footer>
  </section>
}
