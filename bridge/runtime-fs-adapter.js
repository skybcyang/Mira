export async function readTextWithNotFound(
  fsService,
  target,
  runtime = globalThis.process,
) {
  try {
    return await fsService.readText(target)
  } catch (error) {
    if (error?.code === 'ENOENT') throw error
    const stat = runtime?.getBuiltinModule?.('node:fs/promises')?.stat
    if (typeof stat !== 'function') throw error
    const targetPath =
      typeof fsService.processPath === 'function' ? fsService.processPath(target) : target
    try {
      await stat(targetPath)
    } catch (statError) {
      if (statError?.code === 'ENOENT') {
        throw Object.assign(new Error(`file not found: ${targetPath}`, { cause: error }), {
          code: 'ENOENT',
        })
      }
    }
    throw error
  }
}

export async function replaceAtomically(fsService, source, target, runtime = globalThis.process) {
  if (typeof fsService.rename === 'function') {
    await fsService.rename(source, target)
    return
  }
  if (typeof fsService.move === 'function') {
    await fsService.move(source, target)
    return
  }
  const nodeFs = runtime?.getBuiltinModule?.('node:fs/promises')
  if (typeof nodeFs?.rename === 'function') {
    const sourcePath = typeof fsService.processPath === 'function'
      ? fsService.processPath(source)
      : source
    const targetPath = typeof fsService.processPath === 'function'
      ? fsService.processPath(target)
      : target
    await nodeFs.rename(sourcePath, targetPath)
    return
  }
  throw Object.assign(new Error('filesystem does not support atomic replace'), {
    code: 'BOARD_V2_WRITE_FAILED',
  })
}

export async function removeFile(fsService, target, runtime = globalThis.process) {
  if (typeof fsService.remove === 'function') {
    await fsService.remove(target)
    return
  }
  if (typeof fsService.unlink === 'function') {
    await fsService.unlink(target)
    return
  }
  const nodeFs = runtime?.getBuiltinModule?.('node:fs/promises')
  if (typeof nodeFs?.unlink === 'function') {
    const targetPath =
      typeof fsService.processPath === 'function' ? fsService.processPath(target) : target
    await nodeFs.unlink(targetPath)
    return
  }
  throw new Error('filesystem does not support deleting a file')
}
