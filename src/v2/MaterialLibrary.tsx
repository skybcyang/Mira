import { useEffect, useRef, useState } from 'react'
import { v2Api, type ManagedMaterial } from '../v2Api'
import { useV2Canvas } from '../v2Store'

export function MaterialLibrary({ anchor, onReadPdf, onBusy }: { anchor: { x: number; y: number }; onReadPdf: (path: string) => void; onBusy: (busy: boolean) => void }) {
  const [assets, setAssets] = useState<ManagedMaterial[]>([]), [loading, setLoading] = useState(true)
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{ name: string; text: string }>()
  const board = useV2Canvas(state => state.board), add = useV2Canvas(state => state.createFileCard)
  const alive = useRef(true), lock = useRef(false)
  useEffect(() => {
    alive.current = true
    v2Api.listMaterials().then(result => { if (alive.current) setAssets(result.assets) }, cause => { if (alive.current) setError(cause.message) }).finally(() => { if (alive.current) setLoading(false) })
    return () => { alive.current = false }
  }, [])
  const run = async (operation: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusy(true); setError(''); setMessage('')
    try { await operation() } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，请核对材料后重试。') }
    finally { lock.current = false; onBusy(false); if (alive.current) setBusy(false) }
  }
  return <section className="v2-material-library v2-material-reader" aria-label="已收纳材料" aria-busy={loading || busy}>
    <p>原件保存在项目内。添加到不同画布会创建独立卡片。</p>
    {loading && <p role="status">正在读取材料库…</p>}
    {!loading && !error && !assets.length && <p>还没有收纳材料。选择“导入文件”或读取网页后保存。</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <ul className="v2-file-picker-list">{assets.map(asset => <li key={asset.id}>
      <strong>{asset.name}</strong><p>{new Intl.NumberFormat().format(asset.byteLength)} 字节 · {new Date(asset.createdAt).toLocaleString()}</p>
      {asset.source && <p className="v2-material-origin">{asset.source.url}</p>}
      <div className="v2-material-actions">
        <button className="v2-secondary-button" type="button" disabled={busy} onClick={() => {
          if (asset.path.endsWith('.pdf')) onReadPdf(asset.path)
          else void run(async () => { const result = await v2Api.materialContent(asset.id); if (alive.current) setPreview({ name: asset.name, text: result.text }) })
        }}>阅读</button>
        <button className="v2-primary-button" type="button" disabled={busy || !board || (board.lifecycle && board.lifecycle.state !== 'active')} onClick={() => void run(async () => {
          if (!await add(anchor, asset.path, asset.name)) throw new Error('未确认卡片添加成功，请查看当前画布。')
          if (alive.current) setMessage(`已将“${asset.name}”添加到画布。`)
        })}>添加到画布</button>
      </div>
    </li>)}</ul>
    {!board && <p>打开画布后可添加卡片，材料已保存在项目中。</p>}
    {preview && <section aria-label="材料原文"><h3>{preview.name}</h3><textarea readOnly aria-label="材料原文" value={preview.text} rows={12} /><button type="button" className="v2-secondary-button" onClick={() => setPreview(undefined)}>关闭原文</button></section>}
  </section>
}
