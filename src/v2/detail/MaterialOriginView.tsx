import type { MaterialOrigin } from '../../domain/materials.js'

export function MaterialOriginView({ origin }: { origin?: MaterialOrigin }) {
  if (!origin) return null
  return <details className="v2-guidance-read"><summary>材料出处 · {origin.title}</summary>
    <p>{origin.url ? <a href={origin.url} target="_blank" rel="noreferrer">打开原网页</a> : origin.path}</p>
    <p>采集于 {new Date(origin.capturedAt).toLocaleString()}。这里保存的是当时明确选取的内容，原材料变化不会自动更新。</p>
    <ol>{origin.locators.map((locator, index) => <li key={index}>{locator.page ? `物理页 ${locator.page} · ` : ''}原读取文本位置 {locator.start}–{locator.end}</li>)}</ol>
  </details>
}
