import { describe, expect, it, vi } from 'vitest'
import { readTextWithNotFound, replaceAtomically } from '../../bridge/runtime-fs-adapter.js'

describe('runtime filesystem adapter', () => {
  it('normalizes an opaque DSH missing-file error without hiding other read failures', async () => {
    const missing = new Error('runtime read failed')
    const service = {
      readText: vi.fn(async () => {
        throw missing
      }),
      processPath: (target) => target.path,
    }
    const stat = vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })

    await expect(
      readTextWithNotFound(service, { path: '/workspace/boards-v2/missing.json' }, {
        getBuiltinModule: vi.fn(() => ({ stat })),
      }),
    ).rejects.toMatchObject({ code: 'ENOENT', cause: missing })
    expect(stat).toHaveBeenCalledWith('/workspace/boards-v2/missing.json')

    stat.mockResolvedValueOnce({ isFile: () => true })
    await expect(
      readTextWithNotFound(service, { path: '/workspace/boards-v2/unreadable.json' }, {
        getBuiltinModule: vi.fn(() => ({ stat })),
      }),
    ).rejects.toBe(missing)
  })

  it('uses the DSH rename capability when it is available', async () => {
    const service = { rename: vi.fn(async () => {}) }
    await replaceAtomically(service, '/tmp/source', '/tmp/target')
    expect(service.rename).toHaveBeenCalledWith('/tmp/source', '/tmp/target')
  })

  it('falls back to the Node builtin atomic rename without bundling node imports', async () => {
    const rename = vi.fn(async () => {})
    const service = { processPath: (target) => target.path }
    await replaceAtomically(service, { path: '/tmp/source' }, { path: '/tmp/target' }, {
      getBuiltinModule: vi.fn(() => ({ rename })),
    })
    expect(rename).toHaveBeenCalledWith('/tmp/source', '/tmp/target')
  })

  it('uses the DSH remove capability when deleting one file', async () => {
    const { removeFile } = await import('../../bridge/runtime-fs-adapter.js')
    const service = { remove: vi.fn(async () => {}) }

    await removeFile(service, '/tmp/workflow.json')

    expect(service.remove).toHaveBeenCalledWith('/tmp/workflow.json')
  })

  it('falls back to the Node builtin unlink without bundling node imports', async () => {
    const { removeFile } = await import('../../bridge/runtime-fs-adapter.js')
    const unlink = vi.fn(async () => {})
    const service = { processPath: (target) => target.path }

    await removeFile(service, { path: '/tmp/workflow.json' }, {
      getBuiltinModule: vi.fn(() => ({ unlink })),
    })

    expect(unlink).toHaveBeenCalledWith('/tmp/workflow.json')
  })
})
