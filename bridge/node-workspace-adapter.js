import * as nodeFs from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function badPath(path) {
  return Object.assign(new Error(`Path is outside the workspace: ${path}`), {
    code: 'BAD_PATH',
  })
}

export function resolveInside(root, path) {
  if (typeof path !== 'string' || path.includes('\0')) throw badPath(path)
  const absoluteRoot = resolve(root)
  const target = resolve(absoluteRoot, path || '.')
  const fromRoot = relative(absoluteRoot, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw badPath(path)
  }
  return target
}

export function createNodeWorkspaceAdapter(workspaceRoot, { fs = nodeFs } = {}) {
  const root = resolve(workspaceRoot)

  return {
    root,
    async readText(path) {
      return fs.readFile(resolveInside(root, path), 'utf8')
    },
    async writeText(path, content) {
      const target = resolveInside(root, path)
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.writeFile(target, content, 'utf8')
    },
    async replace(from, to) {
      const source = resolveInside(root, from)
      const target = resolveInside(root, to)
      await fs.mkdir(dirname(target), { recursive: true })
      await fs.rename(source, target)
    },
    async remove(path) {
      await fs.unlink(resolveInside(root, path))
    },
    async listJson(dir) {
      const entries = await fs.readdir(resolveInside(root, dir), { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
    },
  }
}
