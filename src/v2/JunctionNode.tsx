import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'

interface JunctionNodeData extends Record<string, unknown> {
  collapsed?: boolean
  sourceCount?: number
}

type JunctionNodeType = Node<JunctionNodeData, 'junction'>

export default function JunctionNode({ data }: NodeProps<JunctionNodeType>) {
  const sourceCount = data.collapsed && typeof data.sourceCount === 'number'
    ? data.sourceCount
    : null
  return <div
    className={`v2-junction${sourceCount ? ' is-collapsed' : ''}`}
    aria-hidden={sourceCount ? undefined : true}
    aria-label={sourceCount ? `汇聚 ${sourceCount} 个来源` : undefined}
  >
    <Handle type="target" position={Position.Left} /><Handle type="source" position={Position.Right} />
    {sourceCount ? <span>{sourceCount} 个来源</span> : null}
  </div>
}
