import { useEffect, useMemo, useRef, useState } from 'react'
import { v2Api } from '../v2Api'
import { useV2Canvas } from '../v2Store'
import { selectMaterial, type MaterialPreview } from '../domain/materials.js'
import { nativeSelectionSpan, textChapters, type TextSpan } from '../domain/sourceScopes.js'
import { userFacingStoreError } from './storePolicy'

export function MaterialReader({ path, onStateChange, onBack }: {
  path?: string; onStateChange: (dirty: boolean, saving: boolean) => void; onBack: () => void
}) {
  const [url, setUrl] = useState(''), [preview, setPreview] = useState<MaterialPreview>()
  const [spans, setSpans] = useState<TextSpan[]>([]), [note, setNote] = useState(''), [tags, setTags] = useState('')
  const [error, setError] = useState(''), [reading, setReading] = useState(false), [saving, setSaving] = useState(false)
  const [finished, setFinished] = useState(false), [uncertain, setUncertain] = useState(false)
  const [page, setPage] = useState(1), [pageImage, setPageImage] = useState(''), [pageError, setPageError] = useState('')
  const board = useV2Canvas(state => state.board), save = useV2Canvas(state => state.saveMaterial)
  const alive = useRef(true), lock = useRef(false), readAbort = useRef<AbortController | null>(null), previewId = useRef<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const dirty = !finished && Boolean(spans.length || note || tags || url)
  useEffect(() => { onStateChange(dirty, saving) }, [dirty, saving, onStateChange])
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; readAbort.current?.abort(); if (previewId.current) void v2Api.releaseMaterial(previewId.current).catch(() => {}); onStateChange(false, false) }
  }, [onStateChange])
  useEffect(() => {
    setPageImage(''); setPageError('')
    if (!preview?.pages) return
    const controller = new AbortController()
    v2Api.materialPage(preview.previewId, page, controller.signal).then(result => { if (!controller.signal.aborted) setPageImage(result.image) }, () => { if (!controller.signal.aborted) setPageError('原页无法显示，请在原文件中核对。') })
    return () => controller.abort()
  }, [preview, page])
  const selected = useMemo(() => {
    if (!preview || !spans.length) return null
    try { return selectMaterial(preview, spans) } catch { return null }
  }, [preview, spans])
  const chapters = useMemo(() => preview && !preview.pages ? textChapters(preview.text) : [], [preview])
  const read = async () => {
    if (lock.current) return
    lock.current = true; setReading(true); setError('')
    const controller = new AbortController(); readAbort.current = controller
    try {
      const result = await v2Api.previewMaterial(path ? { kind: 'pdf', path } : { kind: 'web', url }, controller.signal)
      if (!alive.current || controller.signal.aborted) { void v2Api.releaseMaterial(result.preview.previewId); return }
      if (previewId.current) await v2Api.releaseMaterial(previewId.current).catch(() => {})
      previewId.current = result.preview.previewId; setPreview(result.preview); setSpans([]); setFinished(false); setUncertain(false); setPage(1)
    } catch (cause) { if (alive.current && !controller.signal.aborted) setError(userFacingStoreError(cause)) }
    finally { lock.current = false; if (alive.current) setReading(false) }
  }
  const add = (span: TextSpan) => {
    if (!preview) return
    try { selectMaterial(preview, [...spans, span]); setSpans(current => [...current, span]); setError('') }
    catch { setError('请选择非空、互不重叠且可读取的片段，最多 100 段。') }
  }
  const addSelection = () => {
    const input = textRef.current
    if (!input || !preview) return
    try { add(nativeSelectionSpan(preview.text, input.selectionStart, input.selectionEnd)) }
    catch { setError('先在读取的文字中选取一段完整内容。') }
  }
  const submit = async (destination: 'card' | 'pool') => {
    if (!preview || !selected || lock.current || finished || uncertain) return
    lock.current = true; setSaving(true); setError('')
    try {
      if (destination === 'card') {
        const result = await save(preview.previewId, spans)
        if (!alive.current) return
        if (result !== 'created') { setUncertain(result === 'uncertain'); setError(result === 'uncertain' ? '保存结果待核对。请刷新画板检查，不要重复提交。' : '未确认保存成功，选择仍保留。'); return }
      } else {
        const result = await v2Api.captureMaterial({ previewId: preview.previewId, spans, note, tags: tags.split(/[,，]/).map(tag => tag.trim()).filter(Boolean) })
        if (!result.entry?.id) throw new Error('Missing capture receipt')
        if (!alive.current) return
      }
      setFinished(true); setError(destination === 'card' ? '已保存为一张材料卡。' : '已剪藏到灵感池，引用和备注分别保存。')
    } catch (cause) {
      if (alive.current) { const status = (cause as { status?: number })?.status; const unknown = !status || status >= 500; setUncertain(unknown); setError(unknown ? '剪藏结果待核对。请关闭后查看灵感池，不要重复提交。' : userFacingStoreError(cause)) }
    } finally { lock.current = false; if (alive.current) setSaving(false) }
  }
  const writable = board && (!board.lifecycle || board.lifecycle.state === 'active')
  return <section className="v2-material-reader" aria-label="阅读材料" aria-busy={reading || saving}>
    {path ? <p>PDF：{path}</p> : <label>公开网页地址<input type="url" value={url} disabled={reading || saving || Boolean(preview)} onChange={event => setUrl(event.target.value)} autoFocus /></label>}
    {!preview && <div><button className="v2-primary-button" type="button" disabled={reading || (!path && !url.trim())} onClick={() => void read()}>{reading ? '正在读取…' : '读取并预览'}</button>{reading && <button className="v2-secondary-button" type="button" onClick={() => readAbort.current?.abort()}>取消读取</button>}</div>}
    {preview && <>
      <h3>{preview.origin.title}</h3><p className="v2-material-origin">{preview.origin.url || preview.origin.path}<br />采集于 {new Date(preview.origin.capturedAt).toLocaleString()} · 预览保留 10 分钟</p>
      {preview.origin.requestedUrl && <p className="v2-material-origin">原始地址：{preview.origin.requestedUrl}</p>}
      <ul>{preview.warnings.map((warning, index) => <li key={index}>{warning.message}</li>)}</ul>
      {preview.pages && <div className="v2-material-page"><label>对照原页<select value={page} onChange={event => setPage(Number(event.target.value))}>{preview.pages.map(item => <option key={item.page} value={item.page}>物理页 {item.page} · {item.status === 'text' ? '可读文字' : item.status === 'empty' ? '空白' : '无法提取文字'}</option>)}</select></label>
        {pageImage ? <img src={pageImage} alt={`PDF 物理页 ${page}`} /> : <p role="status">{pageError || '正在渲染原页…'}</p>}
        <button type="button" className="v2-secondary-button" disabled={finished || saving || preview.pages[page - 1]?.status !== 'text'} onClick={() => { const item = preview.pages![page - 1]; add({ start: item.start, end: item.end }) }}>添加这一页的文字</button>
      </div>}
      <label>读取的完整文字<textarea ref={textRef} value={preview.text} readOnly rows={12} /></label>
      <div className="v2-material-actions"><button type="button" className="v2-secondary-button" disabled={finished || saving} onClick={addSelection}>添加选中的文字</button>
        <button type="button" className="v2-secondary-button" disabled={finished || saving || !preview.text.trim() || preview.pages?.some(item => item.status === 'unreadable')} onClick={() => setSpans([{ start: 0, end: preview.text.length }])}>选择完整文字</button></div>
      {chapters.length > 0 && <details><summary>按章节选择</summary><ul>{chapters.map((chapter, index) => <li key={index}><button className="v2-quiet-button" type="button" disabled={finished || saving} onClick={() => add({ start: chapter.start, end: chapter.end })}>{chapter.title}</button></li>)}</ul></details>}
      <h4>本次保留的内容 · {spans.length} 段</h4>
      {spans.length === 0 && <p>先选取文字、章节或页面。不会默认保存整份材料。</p>}
      <ol>{spans.map((span, index) => <li key={`${span.start}:${span.end}`}><span>{preview.text.slice(span.start, span.end).slice(0, 100)}</span><div className="v2-material-actions"><button className="v2-quiet-button" type="button" disabled={index === 0 || finished || saving} onClick={() => setSpans(current => { const next = [...current]; [next[index], next[index - 1]] = [next[index - 1], next[index]]; return next })}>上移第 {index + 1} 段</button><button className="v2-quiet-button" type="button" disabled={finished || saving} onClick={() => setSpans(current => current.filter((_, position) => position !== index))}>移除第 {index + 1} 段</button></div></li>)}</ol>
      {selected && <details open><summary>确认将保存的完整正文</summary><pre>{selected.markdown}</pre></details>}
      <details><summary>剪藏备注与标签（可选）</summary><label>我的备注<textarea rows={4} maxLength={20000} disabled={finished || saving} value={note} onChange={event => setNote(event.target.value)} /></label><label>标签（用逗号分隔）<input value={tags} disabled={finished || saving} onChange={event => setTags(event.target.value)} /></label></details>
      <div className="v2-material-actions"><button type="button" className="v2-primary-button" disabled={!selected || !writable || saving || uncertain || finished} onClick={() => void submit('card')}>保存为材料卡</button><button type="button" className="v2-secondary-button" disabled={!selected || saving || uncertain || finished} onClick={() => void submit('pool')}>剪藏到灵感池</button></div>
      {!writable && <p>当前没有可写画板，仍可剪藏到灵感池。</p>}
    </>}
    {error && <p role={finished ? 'status' : 'alert'}>{error}</p>}
    <button type="button" className="v2-secondary-button" disabled={saving} onClick={onBack}>返回材料选择</button>
  </section>
}
