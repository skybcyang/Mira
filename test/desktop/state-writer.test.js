import { describe, expect, it, vi } from 'vitest'
import { createDesktopStateWriter } from '../../desktop/state-writer.mjs'

describe('desktop state writer', () => {
  it('propagates a critical write failure to the caller', async () => {
    const failure = new Error('Application Support is not writable')
    const writer = createDesktopStateWriter({
      writeState: vi.fn().mockRejectedValue(failure),
      onBackgroundError: vi.fn(),
    })

    await expect(writer.write({ workspaceRoot: '/new/workspace' })).rejects.toBe(failure)
  })

  it('reports a background failure and allows a later write to recover', async () => {
    const failure = new Error('temporary write failure')
    const writeState = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(undefined)
    const onBackgroundError = vi.fn()
    const writer = createDesktopStateWriter({ writeState, onBackgroundError })

    writer.writeInBackground({ workspaceRoot: '/first' })
    await vi.waitFor(() => expect(onBackgroundError).toHaveBeenCalledWith(failure))
    await expect(writer.write({ workspaceRoot: '/second' })).resolves.toBeUndefined()
    expect(writeState).toHaveBeenNthCalledWith(2, { workspaceRoot: '/second' })
  })
})
