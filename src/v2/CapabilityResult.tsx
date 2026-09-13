import { useEffect, useState } from 'react'
import type { PythonResult } from './capabilitiesApi'
import type { ToolFile } from '../domain/toolPolicy.js'
import { attachmentPreview } from './capabilityForms'
function FilePreview({ file }: { file: ToolFile }) {
  const [url, setUrl] = useState('')
  let preview: ReturnType<typeof attachmentPreview> | undefined, error = ''
  try { preview = attachmentPreview(file) } catch { error = '无法预览此附件：格式或大小不受支持。' }
  useEffect(() => {
    if (!preview) return
    const value = URL.createObjectURL(new Blob([preview.bytes], { type: file.mimeType })); setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [file]) // The immutable result owns this download URL until the preview closes.
  return error ? <p role="alert">{error}</p> : <>{preview?.image ? <img src={preview.image} alt={file.name} /> : <pre>{preview?.text}</pre>}{url && <a href={url} download={file.name}>下载 {file.name}</a>}</>
}
function Attachment({ file }: { file: ToolFile }) {
  const [open, setOpen] = useState(false)
  return <details onToggle={event => setOpen(event.currentTarget.open)}><summary>预览 {file.name}</summary>{open && <FilePreview file={file} />}</details>
}
export function CapabilityResult({ result }: { result: PythonResult }) {
  return <section className="v2-capability-result" aria-label="脚本测试结果"><h4>实际测试结果</h4><pre>{result.text || '未返回文本。'}</pre>{result.files && result.files.length > 4 ? <p role="alert">附件数量超过上限，无法确认完整结果。</p> : result.files?.map((file, index) => <Attachment key={`${file.name}:${index}`} file={file} />)}<p className="v2-detail-note">结果只在当前预览中；需要的附件请展开后下载。</p></section>
}
