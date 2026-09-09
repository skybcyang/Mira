import type { CanvasRectangle } from './canvasOperations'

export interface CanvasAlignmentGuide {
  axis: 'vertical' | 'horizontal'
  position: number
  from: number
  to: number
}

export interface CanvasDragAlignment {
  x: number
  y: number
  guides: CanvasAlignmentGuide[]
}

const GUIDE_PADDING = 8

interface AxisCandidate {
  delta: number
  line: number
  other: CanvasRectangle
}

function nearestAxisCandidate(
  draggedStart: number,
  draggedSize: number,
  others: CanvasRectangle[],
  axis: 'x' | 'y',
  threshold: number,
): AxisCandidate | null {
  const draggedEdges = [draggedStart, draggedStart + draggedSize / 2, draggedStart + draggedSize]
  let best: AxisCandidate | null = null
  for (const other of others) {
    const otherStart = axis === 'x' ? other.x : other.y
    const otherSize = axis === 'x' ? other.width : other.height
    const lines = [otherStart, otherStart + otherSize / 2, otherStart + otherSize]
    for (const line of lines) {
      for (const edge of draggedEdges) {
        const delta = line - edge
        if (Math.abs(delta) > threshold) continue
        if (
          !best
          || Math.abs(delta) < Math.abs(best.delta)
          || (Math.abs(delta) === Math.abs(best.delta) && line < best.line)
        ) {
          best = { delta, line, other }
        }
      }
    }
  }
  return best
}

export function canvasDragAlignment(
  dragged: CanvasRectangle,
  others: CanvasRectangle[],
  threshold = 6,
): CanvasDragAlignment {
  const guides: CanvasAlignmentGuide[] = []
  let { x, y } = dragged
  const horizontal = nearestAxisCandidate(dragged.x, dragged.width, others, 'x', threshold)
  if (horizontal) {
    x += horizontal.delta
    guides.push({
      axis: 'vertical',
      position: horizontal.line,
      from: Math.min(dragged.y, horizontal.other.y) - GUIDE_PADDING,
      to: Math.max(dragged.y + dragged.height, horizontal.other.y + horizontal.other.height)
        + GUIDE_PADDING,
    })
  }
  const vertical = nearestAxisCandidate(dragged.y, dragged.height, others, 'y', threshold)
  if (vertical) {
    y += vertical.delta
    guides.push({
      axis: 'horizontal',
      position: vertical.line,
      from: Math.min(dragged.x, vertical.other.x) - GUIDE_PADDING,
      to: Math.max(dragged.x + dragged.width, vertical.other.x + vertical.other.width)
        + GUIDE_PADDING,
    })
  }
  return { x, y, guides }
}
