// 把 bridge/ ESM 源码打包成单个 function-body 文件（无 import/export），供 cordis_define 注入。
import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const globalName = 'MiraBridgeBundle'
const result = await build({
  entryPoints: ['bridge/dsh-cordis-adapter.js'],
  bundle: true,
  format: 'iife',
  globalName,
  outfile: 'dist-bridge/bridge.bundle.js',
  write: false,
  logLevel: 'info',
})

const output = result.outputFiles?.[0]
if (!output) throw new Error('bridge bundle 没有生成 JavaScript 输出')
const code = `${output.text}\n;return ${globalName}.default;\n`
const plugin = new Function(code)()
if (!plugin || typeof plugin.apply !== 'function') {
  throw new Error('bridge bundle 没有返回有效的 Cordis plugin')
}

mkdirSync('dist-bridge', { recursive: true })
writeFileSync('dist-bridge/bridge.cordis.js', code)
rmSync('dist-bridge/bridge.esm.js', { force: true })
console.log('dist-bridge/bridge.cordis.js written,', code.length, 'chars')
