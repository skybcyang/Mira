import { Columns2, FilePlus2, History, Lightbulb, MousePointer2, PanelLeftClose, PanelLeftOpen, Plus, Workflow } from 'lucide-react'

export function WorkbenchNavigation({ active, collapsed, unavailable, onCanvas, onInspiration, onWorkflow, onFile, onHistory, onToggle, onCreate, onMultiSelect, multiSelectMode }: {
  active: 'canvas' | 'inspiration' | 'workflow' | 'file' | 'plan' | 'history'
  collapsed: boolean
  unavailable: boolean
  onCanvas: () => void
  onInspiration: () => void
  onWorkflow: () => void
  onFile: () => void
  onPlan: () => void
  onHistory: () => void
  onToggle: () => void
  onCreate: () => void
  onMultiSelect: () => void
  multiSelectMode: boolean
}) {
  const items = [
    { id: 'canvas', label: '画布', Icon: Columns2, action: onCanvas },
    { id: 'inspiration', label: '灵感池', Icon: Lightbulb, action: onInspiration },
    { id: 'workflow', label: '方法与计划', Icon: Workflow, action: onWorkflow },
    { id: 'file', label: '文件', Icon: FilePlus2, action: onFile },
    { id: 'history', label: '画布版本', Icon: History, action: onHistory },
  ] as const
  return <nav className="v2-workbench-navigation" aria-label="工作导航">
    <button className="v2-navigation-create" type="button" aria-label="新建卡片" title="新建卡片 (N)" disabled={unavailable} onClick={onCreate}><Plus size={20} /><span>新建</span></button>
    <button className="v2-navigation-select" type="button" aria-label={multiSelectMode ? '结束多选' : '多选卡片'} title={multiSelectMode ? '结束多选' : '多选卡片'} aria-pressed={multiSelectMode} disabled={unavailable} onClick={onMultiSelect}><MousePointer2 size={19} /><span>{multiSelectMode ? '结束多选' : '多选'}</span></button>
    {items.map(({ id, label, Icon, action }) => <button key={id} type="button"
      aria-label={label} title={label} aria-pressed={active === id}
      disabled={unavailable && id !== 'canvas' && id !== 'inspiration'}
      aria-haspopup={id === 'inspiration' || id === 'file' ? 'dialog' : undefined}
      aria-expanded={id !== 'canvas' ? active === id : undefined}
      onClick={action}><Icon size={19} /><span>{label}</span></button>)}
    <button className="v2-navigation-collapse" type="button" onClick={onToggle}
      aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开导航' : '收起导航'}>
      {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}<span>收起</span>
    </button>
  </nav>
}
