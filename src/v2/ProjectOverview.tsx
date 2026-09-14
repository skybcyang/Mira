import { useId, useRef, useState } from 'react'
import { ArrowRight, Files, FolderOpen, Lightbulb, Plus, Search, Workflow } from 'lucide-react'
import type { BoardSummary } from '../v2Api'

export interface ProjectOverviewProps {
  projectName: string
  boards: BoardSummary[]
  busy?: boolean
  error?: string | null
  onOpenBoard: (id: string) => void
  onCreateBoard: () => void
  onManageBoards: () => void
  onMaterials: () => void
  onInspiration: () => void
  onMethods: () => void
  onRetry: () => void
}

export default function ProjectOverview({ projectName, boards, busy = false, error, onOpenBoard, onCreateBoard, onManageBoards, onMaterials, onInspiration, onMethods, onRetry }: ProjectOverviewProps) {
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const active = boards.filter(board => board.state === 'active')
  const matches = active.filter(board => board.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <section className="v2-project-overview" aria-labelledby={titleId} aria-busy={busy}>
    <div className="v2-project-overview-content">
      <header className="v2-project-overview-header">
        <div><p>项目总览</p><h1 id={titleId}>{projectName}</h1></div>
        <button type="button" className="v2-primary-button" disabled={busy} onClick={onCreateBoard}><Plus size={18} aria-hidden="true" />新建画板</button>
      </header>
      <nav className="v2-project-resources" aria-label="项目资源">
        <button type="button" disabled={busy} onClick={onMaterials}><Files size={18} aria-hidden="true" />材料</button>
        <button type="button" disabled={busy} onClick={onInspiration}><Lightbulb size={18} aria-hidden="true" />灵感池</button>
        <button type="button" disabled={busy} onClick={onMethods}><Workflow size={18} aria-hidden="true" />方法</button>
      </nav>
      <div className="v2-project-board-heading"><h2>画板</h2><button type="button" disabled={busy} onClick={onManageBoards}><FolderOpen size={16} aria-hidden="true" />管理全部画板</button></div>
      {active.length > 0 && <label className="v2-project-search"><Search size={18} aria-hidden="true" /><span>搜索画板</span><input ref={search} type="search" value={query} disabled={busy} placeholder="输入画板名称" onInput={event => setQuery(event.currentTarget.value)} /></label>}
      {error && <div className="v2-project-error" role="alert"><p>{error}</p><button type="button" disabled={busy} onClick={onRetry}>重试</button></div>}
      {busy && <p className="v2-project-state" role="status">正在读取画板…</p>}
      {!busy && !error && active.length === 0 && <div className="v2-project-state"><h3>还没有画板</h3><p>新建画板开始整理，也可以先收集材料和灵感。</p></div>}
      {!busy && !error && active.length > 0 && matches.length === 0 && <div className="v2-project-state" role="status"><h3>没有匹配的画板</h3><button type="button" onClick={() => { setQuery(''); search.current?.focus() }}>清除搜索</button></div>}
      {matches.length > 0 && <ul className="v2-project-board-list" aria-label="项目画板">{matches.map(board => <li key={board.id}>
        <button type="button" disabled={busy} aria-label={`打开画板：${board.title}`} onClick={() => onOpenBoard(board.id)}><span>{board.title}</span><ArrowRight size={18} aria-hidden="true" /></button>
      </li>)}</ul>}
    </div>
  </section>
}
