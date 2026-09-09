import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

// Resolve the parser through its declared owner instead of adding a test-only dependency.
const require = createRequire(import.meta.url)
const postcss = createRequire(require.resolve('vite/package.json'))('postcss')

/** @param {URL} url */
export async function readStyles(url) {
  const root = postcss.parse(await readFile(url, 'utf8'))
  for (const node of [...root.nodes]) {
    if (node.type !== 'atrule' || node.name !== 'import') continue
    const path = node.params.match(/^(['"])(\.\/[\w./-]+\.css)\1$/)?.[2]
    if (!path) throw new Error(`Unsupported stylesheet import: ${node.params}`)
    const child = postcss.parse(await readFile(new URL(path, url), 'utf8'))
    child.walkAtRules('import', () => { throw new Error(`Nested stylesheet import: ${path}`) })
    node.replaceWith(...child.nodes)
  }
  return root.toString()
}
