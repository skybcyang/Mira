import { forwardRef, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FolderOpen, Pin, Plus, Search, X } from 'lucide-react'
import { useV2Canvas } from '../v2Store'
import { v2Api, type BoardActivity } from '../v2Api'
import { boardMenuGroups, boardMenuFocusIndex } from './boardNavigation'

export default forwardRef<HTMLButtonElement, {
  onSwitch: (id: string) => void
  onCloseBoard: (id: string) => void
  onCreate: (title: string) => void
  onManage: () => void
}>(function BoardMenu({onSwitch, onCloseBoard, onCreate, onManage}, ref) {
  const board = useV2Canvas(state => state.board)
  const boards = useV2Canvas(state => state.boards)
  const opened = useV2Canvas(state => state.openedBoardIds)
  const pinned = useV2Canvas(state => state.pinnedBoardIds)
  const togglePin = useV2Canvas(state => state.togglePinnedBoard)
  const runs = useV2Canvas(state => state.runs)
  const loading = useV2Canvas(state => state.loadState === 'loading' || Boolean(state.closingBoardId))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [activity, setActivity] = useState<Record<string, BoardActivity> | null>(null)
  const [catalog, setCatalog] = useState(boards)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const wasLoading = useRef(loading)
  useEffect(() => {
    if (wasLoading.current && !loading && document.activeElement === document.body) {
      root.current?.querySelector<HTMLButtonElement>('.v2-board-menu-trigger')?.focus()
    }
    wasLoading.current = loading
  }, [loading])
  const close = (focus = true) => {
    setOpen(false)
    if (focus) root.current?.querySelector<HTMLButtonElement>('.v2-board-menu-trigger')?.focus()
  }
  useEffect(() => { setCatalog(boards) }, [boards])
  useEffect(() => {
    if (!open) return
    let cancelled = false
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      try {
        const [list, result] = await Promise.all([v2Api.listBoards(), v2Api.getBoardActivity()])
        if (!cancelled) { setCatalog(list.boards); setActivity(result.activity); setError(false) }
      } catch { if (!cancelled) { setActivity(null); setError(true) } }
      finally { pending = false }
    }
    void refresh()
    const interval = setInterval(() => void refresh(), 5000)
    input.current?.focus()
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) close(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => { cancelled = true; clearInterval(interval); document.removeEventListener('pointerdown',onPointer,true); document.removeEventListener('keydown',onKey,true) }
  }, [open, retry])
  const groups = boardMenuGroups(catalog, opened, pinned, query)
  const select = (id: string) => { close(); onSwitch(id) }
  const countsFor = (id: string) => {
    const counts = activity?.[id] || {activeRuns:0,pendingCandidates:0}
    if (id !== board?.id) return counts
    const loaded = Object.values(runs).filter(run => run.boardId === id)
    return {
      activeRuns: Math.max(counts.activeRuns, loaded.filter(run => run.status === 'queued' || run.status === 'running').length),
      pendingCandidates: Math.max(counts.pendingCandidates, loaded.filter(run => run.status === 'succeeded' && run.result?.disposition === 'candidate').length),
    }
  }
  return <div ref={root} className="v2-board-menu">
    <button ref={ref} type="button" className="v2-board-menu-trigger" aria-label="切换画板" title={board?.title || '未打开画板'} aria-haspopup="dialog" aria-expanded={open} disabled={loading}
      onClick={() => { setOpen(!open); setQuery(''); setCreating(false) }}><span>{board?.title || '选择画板'}</span><ChevronDown size={15} /></button>
    {open && <div className="v2-board-menu-popover" role="dialog" aria-label="画板菜单" onKeyDown={event => {
      if (!['ArrowDown','ArrowUp'].includes(event.key) || creating) return
      const choices = [...(root.current?.querySelectorAll<HTMLButtonElement>('.v2-board-menu-choice:not(:disabled)') || [])]
      if (!choices.length) return
      event.preventDefault()
      const index = choices.indexOf(document.activeElement as HTMLButtonElement)
      choices[boardMenuFocusIndex(index, choices.length, event.key)].focus()
    }}>
      {creating ? <form className="v2-board-menu-create" onSubmit={event => { event.preventDefault(); if (title.trim()) { close(); onCreate(title.trim()) } }}>
        <label>画板名称<input autoFocus value={title} maxLength={120} required onChange={event => setTitle(event.target.value)} /></label>
        <div><button type="button" onClick={() => {setCreating(false); requestAnimationFrame(() => input.current?.focus())}}>返回</button><button type="submit" className="v2-primary-button" disabled={!title.trim()}>新建并打开</button></div>
      </form> : <>
        <label className="v2-board-menu-search"><Search size={16}/><input ref={input} aria-label="搜索所有未归档画板" placeholder="搜索所有未归档画板…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        {error && <div className="v2-board-menu-error" role="alert">无法刷新目录或任务状态<button type="button" onClick={() => setRetry(value => value + 1)}>重试</button></div>}
        <div className="v2-board-menu-list">
          {groups.map(group => <section key={group.title} aria-label={group.title}><h3>{group.title}<span>{group.boards.length}</span></h3>
            {group.boards.length === 0 && <p className="v2-board-menu-empty">{query.trim() ? '没有匹配画板' : group.title === '常用' ? '点击图钉固定常用画板' : '搜索并打开一个画板'}</p>}
            {group.boards.map(item => {
              const counts = countsFor(item.id)
              const busy = counts.activeRuns > 0 || counts.pendingCandidates > 0
              return <div className="v2-board-menu-row" key={item.id}>
                <button type="button" className="v2-board-menu-choice" disabled={loading} aria-current={board?.id === item.id ? 'page' : undefined} onClick={() => select(item.id)}>
                  <span className="v2-board-menu-title">{item.title}</span><span className="v2-board-menu-status">{board?.id === item.id && <span><Check size={12}/>当前</span>}{counts.activeRuns > 0 && <span>运行中 {counts.activeRuns}</span>}{counts.pendingCandidates > 0 && <span className="is-attention">待处理 {counts.pendingCandidates}</span>}</span>
                </button>
                <button type="button" className="v2-icon-button" aria-label={`${pinned.includes(item.id) ? '取消常用' : '设为常用'}：${item.title}`} aria-pressed={pinned.includes(item.id)} disabled={loading} onClick={() => togglePin(item.id)}><Pin size={14}/></button>
                {opened.includes(item.id) && <button type="button" className="v2-icon-button" aria-label={`关闭画板：${item.title}`} title={busy ? '请先打开并处理运行或候选结果' : activity === null ? '正在确认任务状态' : '关闭画板，保留内容'} disabled={loading || activity === null || busy} onClick={() => {close(); onCloseBoard(item.id)}}><X size={14}/></button>}
              </div>
            })}
          </section>)}
        </div>
        <footer><button type="button" disabled={loading} onClick={() => {setTitle('');setCreating(true)}}><Plus size={16}/>新建画板</button><button type="button" disabled={loading} onClick={() => {close();onManage()}}><FolderOpen size={16}/>管理全部画板</button><small>归档与废纸篓在管理中查看</small></footer>
      </>}
    </div>}
  </div>
})
