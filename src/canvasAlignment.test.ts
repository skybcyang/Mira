import { describe, expect, it } from 'vitest'
import { canvasDragAlignment } from './canvasAlignment'

const other = { x: 440, y: 280, width: 300, height: 180 }

describe('canvasDragAlignment', () => {
  it('returns the unchanged position and no guides when there are no other cards', () => {
    const result = canvasDragAlignment({ x: 438, y: 500, width: 300, height: 180 }, [])
    expect(result).toEqual({ x: 438, y: 500, guides: [] })
  })

  it('snaps the dragged left edge to another card left edge within the threshold', () => {
    const result = canvasDragAlignment({ x: 438, y: 500, width: 300, height: 180 }, [other])
    expect(result.x).toBe(440)
    expect(result.y).toBe(500)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 440, from: 272, to: 688 },
    ])
  })

  it('snaps the dragged right edge to another card left edge', () => {
    const result = canvasDragAlignment({ x: 136, y: 500, width: 300, height: 180 }, [other])
    expect(result.x).toBe(140)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 440, from: 272, to: 688 },
    ])
  })

  it('snaps horizontal centers together', () => {
    const result = canvasDragAlignment({ x: 438, y: 500, width: 300, height: 180 }, [
      { x: 430, y: 700, width: 312, height: 180 },
    ])
    expect(result.x).toBe(436)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 586, from: 492, to: 888 },
    ])
  })

  it('snaps the dragged top edge to another card top edge with a horizontal guide', () => {
    const result = canvasDragAlignment({ x: 900, y: 278, width: 300, height: 180 }, [other])
    expect(result.y).toBe(280)
    expect(result.x).toBe(900)
    expect(result.guides).toEqual([
      { axis: 'horizontal', position: 280, from: 432, to: 1208 },
    ])
  })

  it('snaps both axes in a single drag', () => {
    const result = canvasDragAlignment({ x: 438, y: 278, width: 300, height: 180 }, [other])
    expect(result.x).toBe(440)
    expect(result.y).toBe(280)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 440, from: 270, to: 468 },
      { axis: 'horizontal', position: 280, from: 430, to: 748 },
    ])
  })

  it('leaves the position unchanged when every candidate is beyond the threshold', () => {
    const result = canvasDragAlignment({ x: 430, y: 500, width: 300, height: 180 }, [other])
    expect(result).toEqual({ x: 430, y: 500, guides: [] })
  })

  it('keeps the guide visible when the dragged card is already exactly aligned', () => {
    const result = canvasDragAlignment({ x: 440, y: 500, width: 300, height: 180 }, [other])
    expect(result.x).toBe(440)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 440, from: 272, to: 688 },
    ])
  })

  it('picks the nearest candidate when several lines are within the threshold', () => {
    const result = canvasDragAlignment({ x: 438, y: 500, width: 300, height: 180 }, [
      other,
      { x: 437, y: 900, width: 300, height: 180 },
    ])
    expect(result.x).toBe(437)
    expect(result.guides).toEqual([
      { axis: 'vertical', position: 437, from: 492, to: 1088 },
    ])
  })

  it('honors a custom threshold', () => {
    const result = canvasDragAlignment({ x: 430, y: 500, width: 300, height: 180 }, [other], 12)
    expect(result.x).toBe(440)
  })
})
