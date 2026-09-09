import { useEffect, useRef, useState } from 'react'
import { NodeResizeControl } from '@xyflow/react'
import { Maximize2 } from 'lucide-react'
import type { ContentCard } from '../domain'
import { useV2Canvas } from '../v2Store'
import { cardSizeRequest } from './cardGeometry'

export default function CardResizeHandle({ card }: { card: ContentCard }) {
  const boardId = useV2Canvas((state) => state.boardId)
  const busy = useV2Canvas((state) => state.organizationPending || state.historyState === 'applying' || state.saveState === 'saving' || state.loadState !== 'ready')
  const [active, setActive] = useState(false)
  const session = useRef({ boardId, card, cancelled: false, active: false })
  const restore = () => {
    const state = useV2Canvas.getState()
    if (state.boardId !== session.current.boardId) return
    const current = state.board?.cards.find((item) => item.id === session.current.card.id)
    if (current) state.onNodesChange([{ id: current.id, type: 'dimensions', resizing: false,
      dimensions: { width: current.width, height: current.height }, setAttributes: true }])
  }
  useEffect(() => {
    if (!active) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      session.current.cancelled = true
      restore()
    }
    window.addEventListener('keydown', cancel, true)
    return () => {
      window.removeEventListener('keydown', cancel, true)
      if (session.current.active) { session.current.cancelled = true; restore() }
    }
  }, [active])
  useEffect(() => {
    if (busy && session.current.active) {
      session.current.cancelled = true
      restore()
      session.current.active = false
      setActive(false)
    }
  }, [busy])
  if (busy) return null
  return <NodeResizeControl className="v2-card-resizer nodrag" position="bottom-right"
    minWidth={280} minHeight={208} maxWidth={960} maxHeight={960}
    shouldResize={() => !session.current.cancelled}
    onResizeStart={() => { session.current = { boardId, card, cancelled: false, active: true }; setActive(true) }}
    onResizeEnd={(_, params) => {
      const current = session.current
      current.active = false
      setActive(false)
      const request = cardSizeRequest([current.card], params.width, params.height)
      if (current.cancelled || useV2Canvas.getState().boardId !== current.boardId || !request) {
        // XYResizer emits its final measured dimensions after this callback.
        queueMicrotask(() => { if (session.current === current) restore() })
        return
      }
      void useV2Canvas.getState().submitOrganization(request).then((saved) => { if (!saved) restore() })
    }}
  ><Maximize2 size={12} /></NodeResizeControl>
}
