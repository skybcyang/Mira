import { GripVertical, Ellipsis } from 'lucide-react'
import type { Node, NodeProps } from '@xyflow/react'
import type { CanvasGroup } from '../domain'
import { useV2Canvas } from '../v2Store'

export default function CanvasGroupNode({ data, selected }: NodeProps<Node<{ group: CanvasGroup }, 'canvasGroup'>>) {
  const selectGroup = useV2Canvas((state) => state.selectGroup)
  const { group } = data
  return <section className={`v2-canvas-group ${selected ? 'is-selected' : ''}`} data-card-color={group.color} aria-label={`分组 ${group.title}`}>
    <div className="v2-group-heading">
      <button type="button" className="v2-group-title" aria-label={`选择分组 ${group.title}`} title={`移动分组 ${group.title}`}
        onClick={() => selectGroup(group.id)}>
        <GripVertical size={16} aria-hidden="true" /><span>{group.title}</span><small>{group.cardIds.length}</small>
      </button>
      <button type="button" className="v2-group-more nodrag" aria-label={`分组操作 ${group.title}`} title="分组操作" onClick={() => selectGroup(group.id)}><Ellipsis size={16} /></button>
    </div>
  </section>
}
