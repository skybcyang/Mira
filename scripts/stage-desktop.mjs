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
    external: ['electron'],
    legalComments: 'none',
    logLevel: 'silent',
    sourcemap: false,
  })
}

export async function stageDesktopApp({ projectRoot, stageRoot }) {
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
