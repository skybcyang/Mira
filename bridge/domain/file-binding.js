import { digestText } from './content.js'
import { typed } from './errors.js'
import { validateWorkspaceRelativePath } from './portable-format.js'

function headVersion(card) {
  return card.versions.find((version) => version.id === card.headVersionId)
}

function requireMarkdownCard(card) {
  if (card?.contentKind !== 'markdown') {
    throw typed('FILE_BINDING_INVALID', '只有 Markdown Card 可以绑定本地文件')
  }
  const head = headVersion(card)
  if (!head || head.content.kind !== 'markdown' || !head.content.markdown.trim()) {
    throw typed('FILE_BINDING_INVALID', '空的 Markdown Card 不能绑定本地文件')
  }
  return head
}

function safePath(path) {
  try {
    return validateWorkspaceRelativePath(path)
  } catch (error) {
    throw typed('FILE_BINDING_INVALID', '本地文件路径必须位于工作区内', { path }, error)
  }
}

function bindingFor(card, head, path, fileContent, timestamp) {
  return {
    ...card,
    fileBinding: {
      path,
      lastSyncedVersionId: head.id,
      lastSyncedFileDigest: digestText(fileContent),
      lastSyncedAt: timestamp,
    },
    updatedAt: timestamp,
  }
}

function isMissing(error) {
  return error?.code === 'ENOENT' || error?.code === 'FILE_NOT_FOUND'
}

export function createFileBindingService({ fs, newId, now = () => new Date().toISOString() }) {
  if (!fs?.readText || !fs?.writeText || !fs?.replace) {
    throw new TypeError('File binding requires a complete storage adapter')
  }

  async function read(card) {
    const path = safePath(card.fileBinding.path)
    try {
      const content = await fs.readText(path)
      return { path, content, digest: digestText(content) }
    } catch (error) {
      if (isMissing(error)) return { path, missing: true }
      return { path, error }
    }
  }

  async function atomicWrite(path, content) {
    const token = typeof newId === 'function' ? newId('file-sync') : undefined
    const tempPath = `.mira-file-sync-${String(token || Date.now())}.tmp`
    try {
      await fs.writeText(tempPath, content)
      await fs.replace(tempPath, path)
    } finally {
      try {
        await fs.remove?.(tempPath)
      } catch {
        // The atomic replace normally removes the temporary file.
      }
    }
  }

  async function inspect(card) {
    if (!card?.fileBinding) return { status: 'unbound' }
    const head = headVersion(card)
    if (!head) return { status: 'error', path: card.fileBinding.path, message: '绑定 Card 没有当前版本' }
    const file = await read(card)
    if (file.missing) {
      return { status: 'missing', path: file.path, fileBinding: card.fileBinding }
    }
    if (file.error) {
      return { status: 'error', path: file.path, fileBinding: card.fileBinding, message: file.error.message }
    }
    if (file.digest !== card.fileBinding.lastSyncedFileDigest) {
      return { status: 'conflict', path: file.path, fileBinding: card.fileBinding, fileDigest: file.digest }
    }
    if (head.id !== card.fileBinding.lastSyncedVersionId) {
      return { status: 'unsynced', path: file.path, fileBinding: card.fileBinding, fileDigest: file.digest }
    }
    return { status: 'synced', path: file.path, fileBinding: card.fileBinding, fileDigest: file.digest }
  }

  async function bind(card, { path: requestedPath, overwrite = false } = {}) {
    const head = requireMarkdownCard(card)
    const path = safePath(requestedPath)
    let file
    try {
      const content = await fs.readText(path)
      file = { content, digest: digestText(content) }
    } catch (error) {
      if (!isMissing(error)) throw typed('FILE_SYNC_FAILED', `本地文件读取失败：${error.message || error}`)
      await atomicWrite(path, head.content.markdown)
      return {
        card: bindingFor(card, head, path, head.content.markdown, now()),
        fileSync: { status: 'synced', path },
      }
    }
    if (file.content !== head.content.markdown && !overwrite) {
      throw typed('FILE_BINDING_CONFLICT', '本地文件内容与当前 Mira 版本不同', {
        path,
        fileDigest: file.digest,
      })
    }
    if (file.content !== head.content.markdown) await atomicWrite(path, head.content.markdown)
    return {
      card: bindingFor(card, head, path, head.content.markdown, now()),
      fileSync: { status: 'synced', path },
    }
  }

  async function sync(card, { resolution, expectedFileDigest } = {}) {
    const head = requireMarkdownCard(card)
    if (!card.fileBinding) return { card, fileSync: { status: 'unbound' } }
    const file = await read(card)
    if (file.error) return { card, fileSync: { status: 'error', path: file.path, message: file.error.message } }
    if (file.missing) {
      if (resolution !== 'overwrite') return { card, fileSync: { status: 'missing', path: file.path } }
      if (expectedFileDigest !== undefined && expectedFileDigest !== null) {
        throw typed('FILE_SYNC_CONFLICT', '本地文件状态已变化，请重新检查后再覆盖', { path: file.path })
      }
      await atomicWrite(file.path, head.content.markdown)
      return {
        card: bindingFor(card, head, file.path, head.content.markdown, now()),
        fileSync: { status: 'synced', path: file.path },
      }
    }
    const expected = expectedFileDigest ?? file.digest
    if (file.digest !== expected) {
      throw typed('FILE_SYNC_CONFLICT', '本地文件在处理期间发生变化，请重新检查', { path: file.path })
    }
    if (resolution === 'import') {
      return {
        card,
        fileSync: { status: 'import', path: file.path, fileDigest: file.digest, content: file.content },
      }
    }
    if (resolution !== 'overwrite' && file.digest !== card.fileBinding.lastSyncedFileDigest) {
      return { card, fileSync: { status: 'conflict', path: file.path, fileDigest: file.digest } }
    }
    if (resolution !== 'overwrite' && head.id === card.fileBinding.lastSyncedVersionId) {
      return { card, fileSync: { status: 'synced', path: file.path, fileDigest: file.digest } }
    }
    await atomicWrite(file.path, head.content.markdown)
    return {
      card: bindingFor(card, head, file.path, head.content.markdown, now()),
      fileSync: { status: 'synced', path: file.path },
    }
  }

  return { inspect, bind, sync }
}
