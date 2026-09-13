import { open, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, isAbsolute, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { Worker } from 'node:worker_threads'
import { resolveInside } from './node-workspace-adapter.js'
import { typed } from './domain/errors.js'

const LIMIT = 25 * 1024 * 1024
export function createNodePdfReader({ workspaceRoot, workerUrl = new URL('./pdf-runtime/pdf-reader-worker.mjs', import.meta.url) }) {
  return async ({ path }, { signal, expectedDigest } = {}) => {
    let bytes
    try {
      if (typeof path !== 'string' || isAbsolute(path) || path.split(/[\\/]/).includes('..') || !/\.pdf$/i.test(path)) throw typed('MATERIAL_SOURCE_BLOCKED', '请选择工作区内的 PDF 文件。')
      const root = await realpath(workspaceRoot), target = await realpath(resolveInside(root, path))
      const rel = relative(root, target)
      if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw typed('MATERIAL_SOURCE_BLOCKED', 'PDF 路径越出工作区。')
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > LIMIT) throw typed('MATERIAL_LIMIT', 'PDF 必须是最多 25 MiB 的普通文件。')
        const buffer = Buffer.alloc(stat.size + 1)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
        if (bytesRead !== stat.size) throw typed('MATERIAL_READ_FAILED', 'PDF 在读取时发生变化，请重新读取。')
        bytes = buffer.subarray(0, bytesRead)
      } finally { await handle.close() }
    } catch (error) {
      if (error?.code?.startsWith('MATERIAL_')) throw error
      throw typed('MATERIAL_READ_FAILED', 'PDF 文件无法读取。')
    }
    const sourceDigest = createHash('sha256').update(bytes).digest('hex')
    if (expectedDigest !== undefined && sourceDigest !== expectedDigest) throw typed('MATERIAL_CORRUPT', 'PDF 原件已被修改，请从可信备份恢复。')
    if (signal?.aborted) throw typed('MATERIAL_READ_FAILED', 'PDF 读取已取消。')
    const worker = new Worker(workerUrl, { workerData: { bytes }, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256 }, stdout: true, stderr: true })
    // Parser diagnostics may quote PDF content. They are not public application logs.
    worker.stdout.resume(); worker.stderr.resume()
    let dead = false, nextId = 0
    const requests = new Map()
    const stop = () => {
      if (dead) return
      dead = true; signal?.removeEventListener('abort', stop)
      for (const { reject, timer } of requests.values()) { clearTimeout(timer); reject(typed('MATERIAL_READ_FAILED', 'PDF 读取已取消、超时或关闭。')) }
      requests.clear(); return worker.terminate()
    }
    const wait = (id, timeout) => new Promise((resolve, reject) => {
      if (dead) { reject(typed('MATERIAL_READ_FAILED', 'PDF 阅读预览已关闭。')); return }
      requests.set(id, { resolve, reject, timer: setTimeout(stop, timeout) })
    })
    const ready = wait('ready', 60000)
    worker.on('message', message => {
      const id = message.id ?? 'ready', pending = requests.get(id)
      if (!pending) return
      clearTimeout(pending.timer); requests.delete(id)
      if (message.error) pending.reject(typed(message.error.code, message.error.message))
      else pending.resolve(message.ready || message.image)
    })
    worker.on('error', stop); worker.on('exit', stop)
    signal?.addEventListener('abort', stop, { once: true })
    try {
      const result = await ready
      return { ...result, title: basename(path), byteLength: bytes.length, sourceDigest,
        render(page) { const id = ++nextId, pending = wait(id, 20000); if (!dead) worker.postMessage({ id, page }); return pending },
        dispose: stop,
      }
    } catch (error) { await stop(); throw error }
  }
}
