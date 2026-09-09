import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import type { Transformation } from '../../domain'
import { useV2Canvas } from '../../v2Store'

export function SourceManager({ transformation, sources, blocked }: {
  transformation: Transformation
  sources: Array<{ cardId: string; title: string; status: string }>
  blocked: string | null
}) {
  const update = useV2Canvas(state => state.updateTransformation)
  const begin = useV2Canvas(state => state.beginSourcePicker)
  const [saving, setSaving] = useState(false)
  const container = useRef<HTMLElement>(null)
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (document.activeElement === document.body) container.current?.querySelector<HTMLButtonElement>('[data-add-source]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [])
  async function save(ids: string[], focusId?: string) {
    if (saving || blocked) return
    setSaving(true)
    await update(transformation.id, { sourceCardIds: ids }, transformation.updatedAt)
    setSaving(false)
    requestAnimationFrame(() => {
      const buttons = container.current?.querySelectorAll<HTMLButtonElement>('button[data-source-id]')
      const next = [...(buttons || [])].find(button => button.dataset.sourceId === focusId && !button.disabled)
      ;(next || container.current?.querySelector<HTMLButtonElement>('button[data-add-source]'))?.focus()
    })
  }
  return <section ref={container} className="v2-source-manager" aria-label="转化来源" aria-busy={saving}>
    <header><h3>来源（{sources.length}）</h3>
      <button data-add-source type="button" className="v2-secondary-button" disabled={Boolean(blocked) || saving}
        onClick={() => begin(transformation.id)}><Plus size={14} />添加来源</button>
    </header>
    <ol aria-live="polite">{sources.map((source, index) => <li key={source.cardId}>
      <span className="v2-source-number">{index + 1}</span>
      <div className="v2-source-summary"><strong title={source.title}>{source.title}</strong><small>{source.status}</small></div>
      <div className="v2-source-actions">
        {([-1, 1] as const).map(direction => {
          const name = direction === -1 ? '上移来源' : '下移来源'
          return <button key={direction} data-source-id={source.cardId} className="v2-icon-button" type="button"
            title={name} aria-label={name + '：' + source.title}
            disabled={Boolean(blocked) || saving || index + direction < 0 || index + direction >= sources.length}
            onClick={() => {
              const ids = [...transformation.sourceCardIds]
              ;[ids[index], ids[index + direction]] = [ids[index + direction], ids[index]]
              void save(ids, source.cardId)
            }}>{direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</button>
        })}
        <button data-source-id={source.cardId} className="v2-icon-button" type="button"
          title={sources.length === 1 ? '至少保留一个来源' : '移除来源'} aria-label={'移除来源：' + source.title}
          disabled={Boolean(blocked) || saving || sources.length === 1}
          onClick={() => void save(transformation.sourceCardIds.filter(id => id !== source.cardId), sources[index + 1]?.cardId || sources[index - 1]?.cardId)}><X size={14} /></button>
      </div>
    </li>)}</ol>
    {blocked && <p className="v2-structure-warning">{blocked}</p>}
  </section>
}
