import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = new URL('../../', import.meta.url)

async function filesBelow(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolutePath = join(current, entry.name)
    if (entry.isDirectory()) return filesBelow(root, absolutePath)
    return [relative(root, absolutePath)]
  }))
  return nested.flat().sort()
}

function configuredName(entry) {
  if (typeof entry === 'string') return entry
  if (Array.isArray(entry)) return entry[0]
  return entry?.name || entry?.constructor?.name || ''
}

describe('desktop package staging', () => {
  it('derives package versions from the repository release metadata', async () => {
    const rootPackage = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    )
    const bridgePackage = JSON.parse(
      await readFile(new URL('../../packages/mira-bridge/package.json', import.meta.url), 'utf8'),
    )
    const { DESKTOP_PACKAGE_METADATA } = await import('../../scripts/stage-desktop.mjs')

    expect(rootPackage.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
    expect(bridgePackage).not.toHaveProperty('version')
    expect(DESKTOP_PACKAGE_METADATA.version).toBe(rootPackage.version)
    expect(DESKTOP_PACKAGE_METADATA.devDependencies.electron).toBe(
      rootPackage.devDependencies.electron,
    )
  })

  it('stages only bundled host files, the renderer, and generated package metadata', async () => {
    const {
      DESKTOP_PACKAGE_METADATA,
      DESKTOP_STAGE_ENTRIES,
      stageDesktopApp,
    } = await import('../../scripts/stage-desktop.mjs')

    expect(DESKTOP_STAGE_ENTRIES.map(({ role }) => role).sort()).toEqual([
      'main',
      'preload',
      'renderer',
    ])
    expect(DESKTOP_STAGE_ENTRIES).toHaveLength(3)

    const main = DESKTOP_STAGE_ENTRIES.find(({ role }) => role === 'main')
    const preload = DESKTOP_STAGE_ENTRIES.find(({ role }) => role === 'preload')
    const renderer = DESKTOP_STAGE_ENTRIES.find(({ role }) => role === 'renderer')

    expect(main).toMatchObject({ kind: 'file', bundled: true })
    expect(preload).toMatchObject({ kind: 'file', bundled: true })
    expect(renderer).toMatchObject({ kind: 'directory', source: 'dist', target: 'dist' })
    expect(DESKTOP_PACKAGE_METADATA).toMatchObject({
      main: main.target,
      name: 'mira-desktop',
      private: true,
      productName: 'Mira',
    })
    expect(DESKTOP_PACKAGE_METADATA).not.toHaveProperty('dependencies')
    expect(DESKTOP_PACKAGE_METADATA).not.toHaveProperty('scripts')

    const declaredPaths = DESKTOP_STAGE_ENTRIES
      .flatMap(({ source, target }) => [source, target])
      .join('\n')
      .toLowerCase()
    for (const forbidden of [
      'boards-v2',
      'runs-v2',
      'workflows-v2',
      '.env',
      'archive',
      'reference',
      'test',
      'src',
    ]) {
      expect(declaredPaths).not.toContain(forbidden)
    }

    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mira-desktop-stage-source-'))
    const stageRoot = join(fixtureRoot, '.desktop-stage')
    const fixturePackage = {
      version: '9.8.7-fixture.1',
      devDependencies: { electron: '44.0.0-fixture' },
    }
    try {
      await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify(fixturePackage))
      for (const entry of DESKTOP_STAGE_ENTRIES) {
        const source = join(fixtureRoot, entry.source)
        if (entry.kind === 'directory') {
          await mkdir(source, { recursive: true })
          await writeFile(join(source, 'index.html'), '<main>Mira</main>')
        } else {
          await mkdir(dirname(source), { recursive: true })
          await writeFile(source, `// bundled ${entry.role}`)
        }
      }

      for (const forbidden of [
        'boards-v2/board.json',
        'runs-v2/run.json',
        'workflows-v2/workflow.json',
        '.env',
        'archive/history.json',
        'reference/private.md',
        'test/fixture.js',
        'src/App.tsx',
      ]) {
        const path = join(fixtureRoot, forbidden)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, 'must not ship')
      }

      await stageDesktopApp({ projectRoot: fixtureRoot, stageRoot })

      const expectedFiles = [
        ...DESKTOP_STAGE_ENTRIES.map(({ kind, target }) => (
          kind === 'directory' ? join(target, 'index.html') : target
        )),
        'package.json',
      ].sort()
      expect(await filesBelow(stageRoot)).toEqual(expectedFiles)

      const packageMetadata = JSON.parse(
        await readFile(join(stageRoot, 'package.json'), 'utf8'),
      )
      expect(packageMetadata).toEqual({
        ...DESKTOP_PACKAGE_METADATA,
        version: fixturePackage.version,
        devDependencies: fixturePackage.devDependencies,
      })
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('refuses to recursively replace a staging directory outside the project', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mira-desktop-safe-stage-source-'))
    const unsafeRoot = await mkdtemp(join(tmpdir(), 'mira-desktop-unsafe-stage-'))
    try {
      await writeFile(join(unsafeRoot, 'keep.txt'), 'must survive', 'utf8')
      const { stageDesktopApp } = await import('../../scripts/stage-desktop.mjs')

      await expect(stageDesktopApp({
        projectRoot: fixtureRoot,
        stageRoot: unsafeRoot,
      })).rejects.toThrow('project .desktop-stage')
      await expect(readFile(join(unsafeRoot, 'keep.txt'), 'utf8')).resolves.toBe('must survive')
    } finally {
      await Promise.all([
        rm(fixtureRoot, { recursive: true, force: true }),
        rm(unsafeRoot, { recursive: true, force: true }),
      ])
    }
  })

  it('preserves an existing stage when the project release version is invalid', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mira-desktop-invalid-version-'))
    const stageRoot = join(fixtureRoot, '.desktop-stage')
    try {
      await mkdir(stageRoot)
      await writeFile(join(stageRoot, 'keep.txt'), 'must survive', 'utf8')
      await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
        version: 'next',
        devDependencies: { electron: '44.0.0' },
      }))
      const { stageDesktopApp } = await import('../../scripts/stage-desktop.mjs')

      await expect(stageDesktopApp({ projectRoot: fixtureRoot, stageRoot }))
        .rejects.toThrow('valid release version')
      await expect(readFile(join(stageRoot, 'keep.txt'), 'utf8')).resolves.toBe('must survive')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })

  it('preserves an existing stage when the Electron version is missing', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'mira-desktop-missing-electron-'))
    const stageRoot = join(fixtureRoot, '.desktop-stage')
    try {
      await mkdir(stageRoot)
      await writeFile(join(stageRoot, 'keep.txt'), 'must survive', 'utf8')
      await writeFile(join(fixtureRoot, 'package.json'), JSON.stringify({
        version: '1.2.3-test.4',
        devDependencies: {},
      }))
      const { stageDesktopApp } = await import('../../scripts/stage-desktop.mjs')

      await expect(stageDesktopApp({ projectRoot: fixtureRoot, stageRoot }))
        .rejects.toThrow('Electron version')
      await expect(readFile(join(stageRoot, 'keep.txt'), 'utf8')).resolves.toBe('must survive')
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true })
    }
  })
})

describe('desktop artifact configuration', () => {
  it('reports a packed executable spawn error immediately', async () => {
    const { waitForPackedExit } = await import('../../scripts/packed-desktop-smoke.mjs')
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const failure = new Error('spawn EACCES')

    const ready = waitForPackedExit(child, 60_000)
    child.emit('error', failure)

    await expect(ready).rejects.toBe(failure)
  })

  it('runs packed smoke through the app executable with an isolated workspace', async () => {
    const {
      createPackedSmokeCommand,
      PACKED_READY_TIMEOUT_MS,
      PACKED_SHUTDOWN_TIMEOUT_MS,
    } = await import(
      '../../scripts/packed-desktop-smoke.mjs'
    )
    expect(PACKED_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
    expect(PACKED_SHUTDOWN_TIMEOUT_MS).toBeGreaterThanOrEqual(20_000)
    const command = createPackedSmokeCommand({
      platform: 'darwin',
      appPath: '/tmp/Mira-darwin-arm64/Mira.app',
      workspaceRoot: '/tmp/mira-packed-smoke-workspace',
      userDataRoot: '/tmp/mira-packed-smoke-user-data',
      inheritedEnv: { PATH: '/usr/bin' },
    })

    expect(command).toEqual({
      executable: join('/tmp/Mira-darwin-arm64/Mira.app', 'Contents', 'MacOS', 'Mira'),
      args: [],
      env: {
        PATH: '/usr/bin',
        MIRA_DESKTOP_SMOKE: '1',
        MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1',
        MIRA_DESKTOP_SMOKE_USER_DATA: '/tmp/mira-packed-smoke-user-data',
        MIRA_DESKTOP_SMOKE_WORKSPACE: '/tmp/mira-packed-smoke-workspace',
      },
    })
    expect(command.executable).not.toMatch(/(?:node|pnpm)$/)
  })

  it('passes restore inputs only through the explicitly gated packed smoke environment', async () => {
    const { createPackedSmokeCommand } = await import(
      '../../scripts/packed-desktop-smoke.mjs'
    )
    const command = createPackedSmokeCommand({
      appPath: '/tmp/Mira-darwin-arm64/Mira.app',
      workspaceRoot: '/tmp/mira-packed-restore-workspace',
      userDataRoot: '/tmp/mira-packed-restore-user-data',
      backupPath: '/tmp/mira-packed-restore-backup.json',
      inheritedEnv: { PATH: '/usr/bin' },
    })

    expect(command.env).toEqual({
      PATH: '/usr/bin',
      MIRA_DESKTOP_SMOKE: '1',
      MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1',
      MIRA_DESKTOP_SMOKE_USER_DATA: '/tmp/mira-packed-restore-user-data',
      MIRA_DESKTOP_SMOKE_MODE: 'restore',
      MIRA_DESKTOP_SMOKE_BACKUP: '/tmp/mira-packed-restore-backup.json',
      MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE: '/tmp/mira-packed-restore-workspace',
    })
    expect(command.env).not.toHaveProperty('MIRA_DESKTOP_SMOKE_WORKSPACE')
  })

  it('removes inherited restore controls from an ordinary packed smoke command', async () => {
    const { createPackedSmokeCommand } = await import(
      '../../scripts/packed-desktop-smoke.mjs'
    )
    const command = createPackedSmokeCommand({
      appPath: '/tmp/Mira-darwin-arm64/Mira.app',
      workspaceRoot: '/tmp/mira-packed-smoke-workspace',
      userDataRoot: '/tmp/mira-packed-smoke-user-data',
      inheritedEnv: {
        PATH: '/usr/bin',
        MIRA_DESKTOP_SMOKE_MODE: 'restore',
        MIRA_DESKTOP_SMOKE_BACKUP: '/untrusted/backup.json',
        MIRA_DESKTOP_SMOKE_RESTORE_WORKSPACE: '/untrusted/workspace',
      },
    })

    expect(command.env).toEqual({
      PATH: '/usr/bin',
      MIRA_DESKTOP_SMOKE: '1',
      MIRA_DESKTOP_SMOKE_EXIT_ON_READY: '1',
      MIRA_DESKTOP_SMOKE_USER_DATA: '/tmp/mira-packed-smoke-user-data',
      MIRA_DESKTOP_SMOKE_WORKSPACE: '/tmp/mira-packed-smoke-workspace',
    })
  })

  it('creates a valid restore fixture and parses the packed restore CLI mode', async () => {
    const {
      createPackedRestoreBackup,
      parsePackedSmokeOptions,
      PACKED_RESTORE_BOARD_ID,
      PACKED_RESTORE_CHECKPOINT_ID,
    } = await import('../../scripts/packed-desktop-smoke.mjs')

    expect(createPackedRestoreBackup()).toMatchObject({
      format: 'mira-backup',
      formatVersion: 2,
      boards: [{
        id: PACKED_RESTORE_BOARD_ID,
        lifecycle: { state: 'archived' },
      }],
      runs: [],
      workflows: [],
      checkpoints: [{
        id: PACKED_RESTORE_CHECKPOINT_ID,
        boardId: PACKED_RESTORE_BOARD_ID,
      }],
    })
    expect(parsePackedSmokeOptions(['--arch', 'arm64', '--restore'])).toEqual({
      architecture: 'arm64',
      restore: true,
    })
  })

  it('verifies the restored Board entity in addition to all managed directories', async () => {
    const {
      createPackedRestoreBackup,
      verifyPackedSmokeWorkspace,
      PACKED_RESTORE_BOARD_ID,
      PACKED_RESTORE_CHECKPOINT_ID,
    } = await import(
      '../../scripts/packed-desktop-smoke.mjs'
    )
    const { restoreWorkspaceBackup } = await import('../../bridge/node-backup-restore.js')
    const { boardCheckpointFilename } = await import('../../bridge/board-checkpoint-store.js')
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'mira-packed-restore-assertion-'))
    const root = join(temporaryRoot, 'workspace')
    try {
      const inputPath = join(temporaryRoot, 'backup.json')
      await writeFile(inputPath, JSON.stringify(createPackedRestoreBackup()), 'utf8')
      await restoreWorkspaceBackup({ inputPath, workspaceRoot: root })

      await expect(verifyPackedSmokeWorkspace(root, { restore: true })).resolves.toBeUndefined()
      await rm(join(root, 'boards-v2', `${PACKED_RESTORE_BOARD_ID}.json`))
      await expect(verifyPackedSmokeWorkspace(root, { restore: true }))
        .rejects.toThrow(PACKED_RESTORE_BOARD_ID)
      await writeFile(
        join(root, 'boards-v2', `${PACKED_RESTORE_BOARD_ID}.json`),
        JSON.stringify({ id: PACKED_RESTORE_BOARD_ID, title: 'Packed restore smoke' }),
        'utf8',
      )
      await rm(join(
        root,
        'board-checkpoints-v1',
        boardCheckpointFilename(PACKED_RESTORE_BOARD_ID, PACKED_RESTORE_CHECKPOINT_ID),
      ))
      await expect(verifyPackedSmokeWorkspace(root, { restore: true }))
        .rejects.toThrow(PACKED_RESTORE_CHECKPOINT_ID)
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true })
    }
  })

  it('exposes development, dual-architecture make, and packed-smoke commands', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    )
    const scripts = packageJson.scripts

    expect(scripts).toMatchObject({
      'desktop:dev': expect.any(String),
      'desktop:make': expect.any(String),
      'desktop:make:arm64': expect.any(String),
      'desktop:make:x64': expect.any(String),
      'desktop:smoke:packed': expect.any(String),
      'desktop:smoke:packed:arm64': expect.any(String),
      'desktop:smoke:packed:x64': expect.any(String),
    })
    expect(packageJson.engines.node).toMatch(/22\.12/)
    expect(packageJson.pnpm?.overrides).toMatchObject({
      '@electron/packager>extract-zip': 'npm:@electron-internal/extract-zip@1.0.5',
    })
    expect(scripts['desktop:make']).toContain('desktop:make:arm64')
    expect(scripts['desktop:make']).toContain('desktop:make:x64')
    expect(scripts['desktop:make:arm64']).toMatch(/--arch(?:=|\s+)arm64/)
    expect(scripts['desktop:make:x64']).toMatch(/--arch(?:=|\s+)x64/)
    expect(scripts['desktop:smoke:packed']).toMatch(/packed/i)
    expect(scripts['desktop:smoke:packed']).not.toContain('arm64 &&')
    expect(scripts['desktop:smoke:packed:arm64']).toMatch(/--arch(?:=|\s+)arm64/)
    expect(scripts['desktop:smoke:packed:x64']).toMatch(/--arch(?:=|\s+)x64/)
  })

  it('makes unsigned hardened DMG and ZIP artifacts from an asar', async () => {
    const {
      createDesktopForgeConfig,
      desktopPackagePolicy,
    } = await import('../../forge.config.mjs')
    const forgeConfig = createDesktopForgeConfig('darwin')

    expect(desktopPackagePolicy).toMatchObject({
      architectures: ['arm64', 'x64'],
      asar: true,
      formats: ['dmg', 'zip'],
      minimumMacOS: '13.0',
      notarized: false,
      signed: false,
      fuses: {
        enableEmbeddedAsarIntegrityValidation: true,
        enableNodeCliInspectArguments: false,
        enableNodeOptionsEnvironmentVariable: false,
        onlyLoadAppFromAsar: true,
        runAsNode: false,
      },
    })

    expect(forgeConfig.packagerConfig).toMatchObject({ asar: true })
    const desktopIconPath = fileURLToPath(
      new URL('../../desktop/assets/mira-app.icns', import.meta.url),
    )
    expect(forgeConfig.packagerConfig?.icon).toBe(desktopIconPath)
    const desktopIcon = await readFile(desktopIconPath)
    expect(desktopIcon.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(desktopIcon.byteLength).toBeGreaterThan(10_000)
    expect(forgeConfig.packagerConfig?.download?.checksums).toMatchObject({
      'electron-v44.0.0-darwin-arm64.zip':
        '076d79742986e1b100b69ebecc691cb07368045e54c9087cef631b8622b76a80',
      'electron-v44.0.0-darwin-x64.zip':
        '28429e700ad68d9624aaa90b6543ffe891a48c14121fd904cd294e5edcee63ff',
    })
    expect(forgeConfig.packagerConfig?.extendInfo).toMatchObject({
      LSMinimumSystemVersion: '13.0',
    })
    expect(forgeConfig.packagerConfig?.osxSign).toBeFalsy()
    expect(forgeConfig.packagerConfig?.osxNotarize).toBeFalsy()

    const makerNames = (forgeConfig.makers || []).map(configuredName).join('\n')
    expect(makerNames).toMatch(/maker-dmg|MakerDMG/i)
    expect(makerNames).toMatch(/maker-zip|MakerZIP/i)
    const dmgMaker = (forgeConfig.makers || []).find((entry) => (
      /maker-dmg|MakerDMG/i.test(configuredName(entry))
    ))
    expect(dmgMaker?.config?.icon).toBe(desktopIconPath)

    const pluginNames = (forgeConfig.plugins || []).map(configuredName).join('\n')
    expect(pluginNames).toMatch(/fuses/i)
  })
})
