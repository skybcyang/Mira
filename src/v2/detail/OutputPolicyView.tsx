import type { OutputPolicy, OutputCheck } from '../../domain/outputPolicy.js'
import { outputFormats } from '../../domain/outputPolicy.js'

export function OutputPolicyView({ policy, check }: { policy: OutputPolicy; check?: OutputCheck }) {
  const failed = check?.lengthPassed === false || check?.formatPassed === false
  return <>
    <details className="v2-guidance-read">
      <summary>本次输出要求 · {policy.title} · {policy.version}{policy.customized ? ' · 已调整' : ''}</summary>
      <p>{policy.text}</p>
      <p>{outputFormats[policy.format]} · {policy.maxCharacters === undefined ? '不限字符' : `最多 ${policy.maxCharacters} 字符`}</p>
    </details>
    {check && <section className="v2-output-check" aria-label="约束检查">
      <h3>约束检查</h3>
      {check.lengthPassed === undefined
        ? <p>{check.characters} 字符 · 未设置上限</p>
        : <p>{check.lengthPassed ? '字符上限通过' : '字符上限未通过'}：{check.characters} / {check.maxCharacters}</p>}
      {check.formatPassed !== undefined && <p>{check.formatPassed ? '结构通过' : '结构未通过'} · {outputFormats[check.format]}</p>}
      <p className="v2-detail-note">{failed ? '完整结果已保留。' : ''}字符含标题、标点和空白，按 Unicode 码点计数。检查不代表内容准确。</p>
    </section>}
  </>
}
