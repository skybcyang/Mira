import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
const repositoryPackage = require('../package.json')
const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export const DESKTOP_STAGE_ENTRIES = Object.freeze([
  Object.freeze({
    role: 'main',
    kind: 'file',
    source: 'desktop/main.mjs',
    target: 'main.mjs',
    bundled: true,
    format: 'esm',
  }),
  Object.freeze({
    role: 'preload',
    kind: 'file',
    source: 'desktop/preload.mjs',
    target: 'preload.js',
    bundled: true,
    format: 'iife',
  }),
  Object.freeze({
    role: 'pdf-reader',
    kind: 'file',
    source: 'bridge/pdf-runtime/pdf-reader-worker.mjs',
    target: 'pdf-runtime/pdf-reader-worker.mjs',
    bundled: true,
    format: 'esm',
  }),
  Object.freeze({
    role: 'renderer',
    kind: 'directory',
    source: 'dist',
    target: 'dist',
    bundled: false,
  }),
])

export function createDesktopPackageMetadata(projectPackage) {
  if (
    typeof projectPackage.version !== 'string'
    || !releaseVersionPattern.test(projectPackage.version)
  ) {
    throw new Error('Desktop staging requires a valid release version in package.json')
  }
  const electronVersion = projectPackage.devDependencies?.electron
  if (typeof electronVersion !== 'string' || !releaseVersionPattern.test(electronVersion)) {
    throw new Error('Desktop staging requires an exact Electron version in package.json')
  }
  return Object.freeze({
    name: 'mira-desktop',
    productName: 'Mira',
    version: projectPackage.version,
    private: true,
    type: 'module',
    main: 'main.mjs',
    devDependencies: Object.freeze({
      electron: electronVersion,
    }),
    config: Object.freeze({
      forge: '../forge.config.mjs',
    }),
  })
}

export const DESKTOP_PACKAGE_METADATA = createDesktopPackageMetadata(repositoryPackage)

function assertSafeStageRoot(projectRoot, stageRoot) {
  const resolvedProjectRoot = resolve(projectRoot)
  const resolvedStageRoot = resolve(stageRoot)
  if (resolvedStageRoot !== join(resolvedProjectRoot, '.desktop-stage')) {
    throw new Error('Desktop staging must use the project .desktop-stage directory')
  }
}

async function bundleDesktopEntry({ projectRoot, stageRoot, entry }) {
  const outputPath = join(stageRoot, entry.target)
  await mkdir(dirname(outputPath), { recursive: true })
  await build({
    entryPoints: [join(projectRoot, entry.source)],
    outfile: outputPath,
    bundle: true,
    platform: 'node',
    format: entry.format,
    target: 'node22',
    external: ['electron', 'pdfjs-dist/*'],
    ...(entry.format === 'esm' ? { banner: { js: 'import { createRequire as __miraCreateRequire } from "node:module"; const require = __miraCreateRequire(import.meta.url);' } } : {}),
    legalComments: 'none',
    logLevel: 'silent',
    sourcemap: false,
  })
}

export async function stagePdfRuntime({ projectRoot, stageRoot, architecture = process.arch, platform = process.platform }) {
  const projectRequire = createRequire(join(projectRoot, 'package.json'))
  const pdfPackage = projectRequire.resolve('pdfjs-dist/package.json')
  const canvasPackage = createRequire(pdfPackage).resolve('@napi-rs/canvas/package.json')
  const nativeName = `@napi-rs/canvas-${platform}-${architecture}${platform === 'win32' ? '-msvc' : platform === 'linux' ? '-gnu' : ''}`
  let nativePackage
  try { nativePackage = createRequire(canvasPackage).resolve(`${nativeName}/package.json`) } catch { throw new Error(`PDF rendering requires the installed target dependency ${nativeName}; install with pnpm supportedArchitectures before packaging.`) }
  const pdfTarget = join(stageRoot, 'pdf-runtime', 'node_modules', 'pdfjs-dist')
  await cp(join(projectRoot, 'docs', 'licenses', 'production-notices.txt'), join(stageRoot, 'THIRD_PARTY_NOTICES.txt'))
  for (const asset of ['package.json', 'LICENSE', 'legacy/build/pdf.mjs', 'legacy/build/pdf.worker.mjs', 'cmaps', 'standard_fonts']) {
    await mkdir(dirname(join(pdfTarget, asset)), { recursive: true })
    await cp(join(dirname(pdfPackage), asset), join(pdfTarget, asset), { recursive: true, dereference: true })
  }
  for (const [name, packagePath] of [['@napi-rs/canvas', canvasPackage], [nativeName, nativePackage]]) {
    await cp(dirname(packagePath), join(stageRoot, 'pdf-runtime', 'node_modules', name), { recursive: true, dereference: true })
  }
  return { 'pdfjs-dist': JSON.parse(await readFile(pdfPackage, 'utf8')).version, '@napi-rs/canvas': JSON.parse(await readFile(canvasPackage, 'utf8')).version, [nativeName]: JSON.parse(await readFile(nativePackage, 'utf8')).version }
}

export async function stageDesktopApp({ projectRoot, stageRoot, architecture = process.arch }) {
  assertSafeStageRoot(projectRoot, stageRoot)
  const projectPackage = JSON.parse(
    await readFile(join(projectRoot, 'package.json'), 'utf8'),
  )
  const packageMetadata = createDesktopPackageMetadata(projectPackage)

  await rm(stageRoot, { recursive: true, force: true })
  await mkdir(stageRoot, { recursive: true })

  for (const entry of DESKTOP_STAGE_ENTRIES) {
    if (entry.kind === 'file') {
      await bundleDesktopEntry({ projectRoot, stageRoot, entry })
      continue
    }

    await cp(join(projectRoot, entry.source), join(stageRoot, entry.target), {
      recursive: true,
    })
  }
  if (projectPackage.dependencies?.['pdfjs-dist']) await stagePdfRuntime({ projectRoot, stageRoot, architecture })

  await writeFile(
    join(stageRoot, 'package.json'),
    `${JSON.stringify(packageMetadata, null, 2)}\n`,
    'utf8',
  )

  return stageRoot
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const projectRoot = process.cwd()
  const stageRoot = join(projectRoot, '.desktop-stage')
  await stageDesktopApp({ projectRoot, stageRoot })
  console.log(`Desktop app staged at ${stageRoot}`)
}
