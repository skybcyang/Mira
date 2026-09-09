import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  backupFileName,
  boardArtifactFileName,
  downloadJson,
} from './portableDownloads'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('portable JSON downloads', () => {
  it('keeps readable Unicode while replacing reserved filename characters', () => {
    expect(boardArtifactFileName('  研究：计划 / 评审?  '))
      .toBe('研究-计划-评审.mira-board.json')
    expect(boardArtifactFileName('  <>:"/\\|?* .  '))
      .toBe('mira-board.mira-board.json')
  })

  it('uses a stable minute-resolution backup filename', () => {
    expect(backupFileName(new Date(2026, 8, 2, 9, 7, 58)))
      .toBe('mira-20260902-0907.mira-backup.json')
  })

  it('downloads UTF-8 JSON and always revokes its object URL', async () => {
    vi.useFakeTimers()
    const click = vi.fn()
    const remove = vi.fn()
    const anchor = { href: '', download: '', click, remove }
    const append = vi.fn()
    const createObjectURL = vi.fn().mockReturnValue('blob:mira-download')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(anchor),
      body: { append },
    })
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    downloadJson({ title: '中文', value: 1 }, '研究.mira-board.json')

    expect(anchor.download).toBe('研究.mira-board.json')
    expect(anchor.href).toBe('blob:mira-download')
    expect(append).toHaveBeenCalledWith(anchor)
    expect(click).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledOnce()
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mira-download')
    const blob = createObjectURL.mock.calls[0][0] as Blob
    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(await blob.text()).toBe(JSON.stringify({ title: '中文', value: 1 }, null, 2))
  })
})
