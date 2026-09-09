import { readFile, readdir, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { preProcessFile } from 'typescript'
import { describe, expect, it } from 'vitest'

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url))

async function sourceFiles(path) {
  const absolutePath = join(repositoryRoot, path)
  const pathStat = await stat(absolutePath)
  if (pathStat.isFile()) return [absolutePath]

  const entries = await readdir(absolutePath, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const child = join(path, entry.name)
    if (entry.isDirectory()) return sourceFiles(child)
    if (!/\.(?:js|mjs|ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return []
    }
    return [join(repositoryRoot, child)]
  }))
  return nested.flat()
}

function moduleSpecifiers(source) {
  return preProcessFile(source, true, true).importedFiles.map(({ fileName }) => fileName)
}

function isDesktopDependency(specifier) {
  const normalized = specifier.replaceAll('\\', '/')
  return normalized === 'electron'
    || normalized.startsWith('electron/')
    || normalized.startsWith('@electron/')
    || /(^|\/)desktop(?:\/|$)/i.test(normalized)
}

describe('macOS desktop shell boundaries', () => {
  it('keeps the browser product and DSH adapter independent from Electron', async () => {
    const protectedFiles = (await Promise.all([
      sourceFiles('src'),
      sourceFiles('bridge/dsh-cordis-adapter.js'),
      sourceFiles('packages/mira-bridge'),
    ])).flat()

    const violations = []
    for (const file of protectedFiles) {
      const source = await readFile(file, 'utf8')
      for (const specifier of moduleSpecifiers(source)) {
        if (isDesktopDependency(specifier)) {
          violations.push({
            file: relative(repositoryRoot, file),
            specifier,
          })
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps the Electron main process on the host boundary', async () => {
    const main = await readFile(join(repositoryRoot, 'desktop/main.mjs'), 'utf8')
    const forbiddenImports = moduleSpecifiers(main).filter((specifier) => (
      /(^|\/)(?:src|react|react-dom)(?:\/|$)/.test(specifier)
      || /(^|\/)(?:v2-http|v2-routes|v2-board-store|v2-run-store|workflow-store)(?:\.|\/|$)/.test(specifier)
    ))

    expect(forbiddenImports).toEqual([])
    expect(main).not.toMatch(/\b(?:createV2Handlers|createV2Routes|createRoot|ReactDOM)\b/)
    expect(main).not.toMatch(/<App(?:\s|\/|>)/)
    expect(main).toContain("app.on('window-all-closed'")
  })

  it('keeps preload narrow and incapable of raw business IPC or filesystem access', async () => {
    const preload = await readFile(join(repositoryRoot, 'desktop/preload.mjs'), 'utf8')
    const forbiddenBuiltins = new Set([
      'fs',
      'fs/promises',
      'node:fs',
      'node:fs/promises',
      'child_process',
      'node:child_process',
    ])

    expect(moduleSpecifiers(preload).filter((specifier) => forbiddenBuiltins.has(specifier))).toEqual([])
    expect(preload).not.toMatch(/\bipcRenderer\b/)
  })
})
