import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, LayoutDashboard, Plus, Upload } from 'lucide-react'

export interface ProjectMenuProps {
  project: { name: string; path: string } | null
  recentProjects: Array<{ id: string; name: string; path: string }>
  canSwitch: boolean
  busy: boolean
  onOverview: () => void
  onOpenProject: (input: { kind: 'open' | 'new' | 'recent' | 'restore'; projectId?: string }) => void
}

export default function ProjectMenu({ project, recentProjects, canSwitch, busy, onOverview, onOpenProject }: ProjectMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const startAtEnd = useRef(false)
  const menuId = useId()
  const choices = () => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') || [])]
  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) trigger.current?.focus() }
  useEffect(() => {
    if (!open || busy) return
    const items = choices()
    items[startAtEnd.current ? items.length - 1 : 0]?.focus()
    const onPointer = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) close(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('pointerdown', onPointer, true); document.removeEventListener('keydown', onKey, true) }
  }, [open, busy])
  useEffect(() => { if (busy) setOpen(false) }, [busy])
  const command = (input: Parameters<ProjectMenuProps['onOpenProject']>[0]) => { close(); onOpenProject(input) }
  return <div className="v2-project-menu" ref={root} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) close(false)
  }}>
    <button type="button" ref={trigger} className="v2-project-menu-trigger" aria-label={`项目菜单：${project?.name || '当前项目'}`} title={project?.name || '当前项目'} aria-haspopup="menu" aria-controls={open ? menuId : undefined} aria-expanded={open && !busy} disabled={busy}
      onClick={() => { startAtEnd.current = false; setOpen(!open) }} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); startAtEnd.current = event.key === 'ArrowUp'; setOpen(true) }
      }}><FolderOpen size={16} aria-hidden="true" /><span>{project?.name || '当前项目'}</span><ChevronDown size={14} aria-hidden="true" /></button>
    {busy && <span className="v2-project-switch-status" role="status">正在切换项目…</span>}
    {open && !busy && <div id={menuId} className="v2-project-menu-popover" role="menu" aria-label="项目菜单" onKeyDown={event => {
      if (event.key === 'Tab') { close(); return }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const items = choices(), index = items.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      items[next]?.focus()
    }}>
      <div className="v2-project-menu-current"><span>当前项目</span><strong>{project?.name || '当前项目'}</strong>{project?.path && <small>{project.path}</small>}</div>
      <button type="button" role="menuitem" onClick={() => { close(); onOverview() }}><LayoutDashboard size={16} aria-hidden="true" />项目总览</button>
      {canSwitch && <>
        <div role="separator" />
        <button type="button" role="menuitem" onClick={() => command({ kind: 'open' })}><FolderOpen size={16} aria-hidden="true" />打开项目…</button>
        <button type="button" role="menuitem" onClick={() => command({ kind: 'new' })}><Plus size={16} aria-hidden="true" />新建项目…</button>
        {recentProjects.length > 0 && <div role="group" aria-label="最近项目" className="v2-project-menu-recent"><p>最近项目</p>{recentProjects.map(item => <button key={item.id} type="button" role="menuitem" aria-label={`打开最近项目：${item.name}`} onClick={() => command({ kind: 'recent', projectId: item.id })}><span>{item.name}</span><small>{item.path}</small></button>)}</div>}
        <div role="separator" />
        <button type="button" role="menuitem" onClick={() => command({ kind: 'restore' })}><Upload size={16} aria-hidden="true" />从备份恢复…</button>
      </>}
    </div>}
  </div>
}
