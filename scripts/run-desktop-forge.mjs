import { rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build as buildRenderer } from 'vite'
import { stageDesktopApp } from './stage-desktop.mjs'

const supportedArchitectures = new Set(['arm64', 'x64'])

export function validateDesktopTarget(platform, architecture) {
  if (
    !(platform === 'darwin' && supportedArchitectures.has(architecture))
    && !(platform === 'win32' && supportedArchitectures.has(architecture))
  ) {
    throw new Error(`Unsupported desktop target: ${platform}-${architecture}`)
  }
}

export function parseDesktopForgeArguments(args) {
  let architecture
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument.startsWith('--arch=')) {
      architecture = argument.slice('--arch='.length)
      continue
    }
    if (argument === '--arch') {
      architecture = args[index + 1]
      index += 1
    }
  }

  if (!supportedArchitectures.has(architecture)) {
    throw new Error('Desktop make requires --arch=arm64 or --arch=x64')
  }
  return { architecture }
}

export async function makeDesktopArtifacts({
  architecture,
  projectRoot,
  stageRoot = join(projectRoot, '.desktop-stage'),
  outDir = join(projectRoot, 'out', 'desktop'),
}) {
  validateDesktopTarget(process.platform, architecture)

  process.chdir(projectRoot)
  await buildRenderer({
    root: projectRoot,
    configFile: join(projectRoot, 'vite.config.ts'),
  })
  await stageDesktopApp({ projectRoot, stageRoot })

  const { api } = await import('@electron-forge/core')
  const results = await api.make({
    arch: architecture,
    dir: stageRoot,
    interactive: false,
    outDir,
    platform: process.platform,
  })
  return results
}

const currentFile = fileURLToPath(import.meta.url)
if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const projectRoot = resolve(dirname(currentFile), '..')
  const { architecture } = parseDesktopForgeArguments(process.argv.slice(2))
  validateDesktopTarget(process.platform, architecture)
  const outDir = join(projectRoot, 'out', 'desktop')

  // Forge replaces its architecture-specific output while preserving the other build.
  await rm(join(outDir, `Mira-${process.platform}-${architecture}`), {
    recursive: true,
    force: true,
  })
  const results = await makeDesktopArtifacts({ architecture, projectRoot, outDir })
  const artifacts = results.flatMap((result) => result.artifacts || [])
  console.log(`Desktop ${architecture} artifacts written below ${outDir}`)
  for (const artifact of artifacts) console.log(artifact)
}
