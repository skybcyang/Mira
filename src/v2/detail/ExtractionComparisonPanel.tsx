import { useEffect, useMemo, useRef, useState } from 'react'
import { parseExtractionList } from '../../domain/extraction.js'
import { useV2Canvas } from '../../v2Store'
import { cardSummary, headVersion } from '../../v2View'
import { exactItemCorrespondences } from '../extractionComparison'
import { useDrawerAction } from '../drawerIntent'
import { ExtractionRevisionEditor } from './ExtractionRevisionEditor'

export function ExtractionComparisonPanel({ cardId, initialBatchId, onDirtyChange }: {
  cardId: string; initialBatchId?: string; onDirtyChange?: (dirty: boolean) => void
}) {
  const board = useV2Canvas(state => state.board)
  const open = useV2Canvas(state => state.openDrawer)
  const action = useDrawerAction()
  const card = board?.cards.find(item => item.id === cardId)
  const [source] = useState(() => card && headVersion(card))
  const [batchId, setBatchId] = useState(initialBatchId || '')
  const [targetId, setTargetId] = useState<string>()
  const [absent, setAbsent] = useState<string[]>([])
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (!targetId) heading.current?.focus() }, [targetId])
  const parsed = useMemo(() => {
    try { return { items: source?.content.kind === 'markdown' ? parseExtractionList(source.content.markdown) : null } }
    catch { return { items: null } }
  }, [source])
  const previous = board?.cards.filter(item => item.extractionRef?.boardId === board.id && item.extractionRef.cardId === cardId) || []
  const batches = [...new Set(previous.map(item => item.extractionRef!.batchId))]
  const cards = previous.filter(item => item.extractionRef!.batchId === batchId)
  const oldVersion = card?.versions.find(version => version.id === cards[0]?.extractionRef?.versionId)
  let oldItems = null
  try { oldItems = oldVersion?.content.kind === 'markdown' ? parseExtractionList(oldVersion.content.markdown) : null } catch { /* Missing history remains unknown. */ }
  const items = parsed.items || []
  const matches = exactItemCorrespondences(oldItems, items)
  const target = cards.find(item => item.id === targetId)
  if (target && source) return <ExtractionRevisionEditor key={target.id} target={target} sourceCardId={cardId} sourceVersionId={source.id} items={items}
    original={oldItems?.find(item => item.itemId === target.extractionRef?.itemId)} matchedId={matches[target.extractionRef!.itemId]}
    onBack={() => setTargetId(undefined)} onDirtyChange={onDirtyChange} />
  return <section className="v2-extraction-panel v2-reconcile-panel" aria-label="与旧卡对照">
    <h3 ref={heading} tabIndex={-1}>与旧卡对照</h3>
    <p>只有标题与正文均完全一致、两侧唯一的条目会预填对应。其他对应由你指定；不会自动采用或删除旧卡。</p>
    {source?.id !== card?.headVersionId && <p role="alert">清单已有新版本。当前对照仍保留打开时的版本，请重新打开后核对。</p>}
    {!parsed.items && <p role="alert">当前版本不是可用的提取清单。</p>}
    <label>选择旧批次<select value={batchId} onChange={event => { setBatchId(event.target.value); setAbsent([]) }}><option value="">请选择批次</option>{batches.map((id, index) => <option value={id} key={id}>批次 {index + 1} · {previous.filter(item => item.extractionRef!.batchId === id).length} 张卡</option>)}</select></label>
    {batchId && <>
      <h4>旧卡</h4>
      <ul className="v2-reconcile-list">{cards.map(item => {
        const matched = matches[item.extractionRef!.itemId]
        const head = headVersion(item)
        const applied = head?.extractionSources?.some(ref => ref.cardId === cardId && ref.versionId === source?.id)
        return <li key={item.id}><strong>{cardSummary(item).title}</strong><span>{applied ? '已明确更新' : absent.includes(item.id) ? '本次未出现（已标记）' : matched ? '未变化（清单文本一致）' : '有变化 / 待指定对应'}</span>
          <button type="button" className="v2-secondary-button" disabled={!parsed.items || !items.length} onClick={() => setTargetId(item.id)}>核对并更新</button>
          {!matched && <button type="button" className="v2-quiet-button" onClick={() => setAbsent(current => current.includes(item.id) ? current.filter(id => id !== item.id) : [...current, item.id])}>{absent.includes(item.id) ? '取消未出现标记' : '标记为本次未出现'}</button>}
        </li>
      })}</ul>
      <h4>本次条目</h4><ul className="v2-reconcile-list">{items.map(item => <li key={item.itemId}><strong>{item.title}</strong><span>{Object.values(matches).includes(item.itemId) ? '存在相同旧条目' : '新条目或待指定对应'}</span><details><summary>查看条目</summary><pre className="v2-reconcile-text">{item.markdown}</pre></details></li>)}</ul>
      <button type="button" className="v2-secondary-button" onClick={() => open({ tab: 'content', cardId, mode: 'split' })}>选择条目创建新卡</button>
    </>}
    {!previous.length && <p>这份清单还没有拆分批次。</p>}
    <footer className="v2-scope-footer"><button type="button" className="v2-secondary-button" onClick={() => action(() => open({ tab: 'content', cardId, mode: 'split' }))}>返回拆分清单</button></footer>
  </section>
}
