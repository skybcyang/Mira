import { useEffect, useRef, useState } from 'react'
import { capabilitiesApi, type PythonScript, type PythonStatus, type PythonResult } from './capabilitiesApi'
import { dependencyPins, objectInput } from './capabilityForms'
import { useCapabilityEditor } from './useCapabilityEditor'
import { useInspectorDraft } from './inspectorDrafts'
import type { CapabilityEditorProps } from './McpConnectionEditor'
import { CapabilityResult } from './CapabilityResult'
export function pythonScriptChanged(script: PythonScript | undefined, projectImage: string | undefined, draft: { title: string; code: string; schema: string; environmentId: string }) {
  return draft.title !== (script?.title || '') || draft.code !== (script?.code || '')
    || draft.schema !== JSON.stringify(script?.inputSchema || { type: 'object', properties: {} }, null, 2)
    || draft.environmentId !== (script?.imageId || projectImage || '')
}
export function PythonCapabilityEditor({ settings, available, mode, script, onDirtyChange, onRequestLeave, onSaved, onReload }: CapabilityEditorProps & { mode: 'environment' | 'script'; script?: PythonScript }) {
  const [image, setImage] = useState('python:3.13-slim'), [dependencies, setDependencies] = useState('')
  const [title, setTitle] = useState(script?.title || ''), [code, setCode] = useState(script?.code || '')
  const [schema, setSchema] = useState(JSON.stringify(script?.inputSchema || { type: 'object', properties: {} }, null, 2))
  const [argumentsText, setArgumentsText] = useState('{}'), [environmentId, setEnvironmentId] = useState(script?.imageId || settings.pythonImageId || '')
  const [status, setStatus] = useState<PythonStatus | null>(available ? null : { available: false, reason: '此宿主未提供 Docker 隔离 Python。' })
  const [statusImage, setStatusImage] = useState<string | undefined>()
  const [probeGeneration, setProbeGeneration] = useState(0)
  const [result, setResult] = useState<PythonResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null), fileRef = useRef<HTMLInputElement>(null)
  const persistentDirty = mode === 'environment' ? image !== 'python:3.13-slim' || dependencies !== '' : pythonScriptChanged(script, settings.pythonImageId, { title, code, schema, environmentId })
  const testDirty = mode === 'script' && argumentsText !== '{}'
  const dirty = persistentDirty || testDirty
  const editor = useCapabilityEditor(dirty, onDirtyChange)
  const probeImage = mode === 'script' ? environmentId : settings.pythonImageId
  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    let active = true
    setStatus(null); setStatusImage(probeImage)
    if (!available || (mode === 'script' && !probeImage)) {
      setStatus({ available: false, reason: !available ? '此宿主未提供 Docker 隔离 Python。' : '请先选择已准备的隔离环境。' })
    } else void capabilitiesApi.pythonStatus(probeImage).then(value => {
      if (active) setStatus(value.available && probeImage && value.imageId !== probeImage
        ? { available: false, reason: '返回的环境身份与所选镜像不符，请重新检查。' } : value)
    }).catch(() => { if (active) setStatus({ available: false, reason: '无法核对隔离环境，请重新检查。' }) })
    return () => { active = false }
  }, [available, mode, probeImage, probeGeneration])
  const visibleStatus = statusImage === probeImage ? status : null
  const refresh = () => setProbeGeneration(value => value + 1)
  const save = async () => {
    try {
      if (mode === 'environment') return editor.perform(signal => capabilitiesApi.preparePython({ baseRevision: settings.revision, image, dependencies: dependencyPins(dependencies) }, signal), value => onSaved(value.settings, 'environment'))
      if (!persistentDirty) return false
      if (!title.trim() || !code.trim() || code.length > 20000 || code.includes('\0')) throw Error('请填写脚本名称和完整代码，代码最多 20000 字符。')
      const inputSchema = objectInput(schema, 16384)
      if (inputSchema.type !== 'object') throw Error('参数结构的 type 必须是 object。')
      if (!/^sha256:[a-f0-9]{64}$/.test(environmentId)) throw Error('请先准备隔离环境并选择完整镜像 ID。')
      return editor.perform(() => capabilitiesApi.update({ baseRevision: settings.revision, script: { ...(script ? { id: script.id } : {}), title: title.trim(), code, inputSchema, imageId: environmentId } }), value => onSaved(value.settings, value.settings.scripts[value.settings.scripts.length - 1]?.id))
    } catch (cause) { editor.setError(cause instanceof Error ? cause.message : '请核对脚本。'); return false }
  }
  useInspectorDraft('python-capability', dirty, save, editor.busy || editor.uncertain || !available || (!persistentDirty && testDirty))
  const test = async () => {
    setResult(null)
    try { const args = objectInput(argumentsText); await editor.perform(signal => capabilitiesApi.testPython({ code, imageId: environmentId, arguments: args }, signal), setResult, false) }
    catch (cause) { editor.setError(cause instanceof Error ? cause.message : '请核对测试参数。') }
  }
  const importFile = async (file?: File) => {
    if (!file || editor.busy) return
    await editor.perform(async () => {
      if (!/\.py$/i.test(file.name) || file.size > 80000) throw Error('请选择最多 20000 字符的 UTF-8 .py 文件。')
      const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (!text.trim() || text.length > 20000 || text.includes('\0')) throw Error('脚本为空或超过 20000 字符。')
      return text
    }, text => { setCode(text); if (!title) setTitle(file.name.replace(/\.py$/i, '').slice(0, 120)); setResult(null) }, false)
    if (fileRef.current) fileRef.current.value = ''
  }
  const locked = editor.busy || editor.uncertain
  return <section className="v2-capability-editor" aria-label={mode === 'environment' ? 'Python 隔离环境' : 'Python 脚本编辑'} aria-busy={editor.busy}>
    <h3>{mode === 'environment' ? 'Python 隔离环境' : script ? `${script.title} · 版本 ${script.version}` : '登记 Python 脚本'}</h3>
    <p role="status">{visibleStatus ? visibleStatus.available ? mode === 'script' ? '所选环境已就绪 · Docker Linux 隔离' : settings.pythonImageId ? '项目环境已就绪 · Docker Linux 隔离' : '检测到隔离镜像；准备后可用于本项目。' : visibleStatus.reason || '隔离环境不可用' : '正在核对所选 Docker 隔离环境…'}</p>
    {visibleStatus?.imageId && <details><summary>已核对环境身份</summary><code>{visibleStatus.imageId}</code></details>}
    <p className="v2-detail-note">执行时无网络、无宿主目录，根目录只读。上限：512 MiB 内存、1 CPU、32 进程、16 MiB 临时空间、30 秒。</p>
    {mode === 'environment' ? <>
      <label>Python 镜像<input ref={inputRef} value={image} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => setImage(event.target.value)} /></label>
      <label>依赖固定版本（可选，每行一个）<textarea className="v2-capability-small-code" value={dependencies} rows={4} readOnly={editor.uncertain} disabled={editor.busy} placeholder="numpy==2.3.1" onChange={event => setDependencies(event.target.value)} /></label>
      <p className="v2-detail-note">准备环境会下载镜像及上述依赖；普通运行不会安装。下载完成后会记录固定镜像身份。</p>
    </> : <>
      <label>脚本名称<input ref={inputRef} value={title} maxLength={120} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => setTitle(event.target.value)} /></label>
      <label>代码全文<textarea className="v2-capability-code" rows={14} value={code} maxLength={20000} spellCheck={false} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => { setCode(event.target.value); setResult(null) }} /></label>
      <input ref={fileRef} hidden type="file" accept=".py,text/x-python,text/plain" onChange={event => void importFile(event.target.files?.[0])} /><button type="button" disabled={locked} onClick={() => onRequestLeave(() => fileRef.current?.click())}>从 .py 文件导入…</button>
      <p className="v2-detail-note">代码从 stdin 读取 JSON：sources、arguments、output（可选）；stdout 返回文本或包含 text、files 的 JSON。测试只提供下方参数，sources 为空。</p>
      <details><summary>参数结构（JSON Schema）</summary><label>完整参数结构<textarea className="v2-capability-code" rows={6} value={schema} spellCheck={false} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => setSchema(event.target.value)} /></label></details>
      <label>固定环境<select value={environmentId} disabled={locked} onChange={event => { setEnvironmentId(event.target.value); setResult(null) }}><option value="">请先准备环境</option>{[...new Set([script?.imageId, settings.pythonImageId].filter((value): value is string => Boolean(value)))].map(id => <option key={id} value={id}>{id === settings.pythonImageId ? '项目当前环境' : '脚本原环境'} · {id.slice(7, 19)}</option>)}</select></label>
      {environmentId && <details><summary>脚本环境身份</summary><code>{environmentId}</code></details>}
      <label>测试参数（JSON）<textarea className="v2-capability-small-code" rows={4} value={argumentsText} readOnly={editor.uncertain} disabled={editor.busy} onChange={event => { setArgumentsText(event.target.value); setResult(null) }} /></label>
      <p className="v2-detail-note">测试参数只在本次预览中，不进入脚本版本。需要保留时请先复制。</p>
      <button type="button" disabled={locked || !available || !environmentId || !code.trim()} onClick={() => void test()}>测试这份代码</button>
      {result && <CapabilityResult result={result} />}
      {script && <details><summary>已保存版本与代码</summary>{settings.scripts.filter(item => item.id === script.id).map(item => <details key={item.version}><summary>版本 {item.version} · {item.title}</summary><code>{item.digest}</code><pre>{item.code}</pre></details>)}</details>}
      <p className="v2-detail-note">保存表示已审阅这份代码；新增版本后需重新在项目启用，旧步骤保留原快照。</p>
    </>}
    {editor.error && <p role="alert">{editor.error}</p>}
    {editor.uncertain && <p>草稿已保留。请复制需要的内容，再<button type="button" onClick={() => onRequestLeave(onReload)}>重新读取并核对</button>。</p>}
    <footer><button type="button" className="v2-primary-button" disabled={locked || !available || (mode === 'script' && (!persistentDirty || !environmentId || !code.trim()))} onClick={() => void save()}>{editor.busy ? '正在处理…' : mode === 'environment' ? '准备环境' : script ? '保存为新版本' : '登记已审阅脚本'}</button><button type="button" disabled={locked || !available || !visibleStatus} onClick={refresh}>重新检查环境</button>{editor.busy && <button type="button" onClick={editor.cancel}>停止当前操作</button>}</footer>
  </section>
}
