import { spawnSync } from 'node:child_process'
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  MIRA_SERVICE_LABEL,
  createLaunchAgentPlist,
  launchActionsForStart,
  resolveServicePaths,
} from './macos-service-lib.mjs'

const workspaceRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const paths = resolveServicePaths({ homeDirectory: homedir(), workspaceRoot })
const launchDomain = `gui/${process.getuid()}`
const launchTarget = `${launchDomain}/${MIRA_SERVICE_LABEL}`
const serviceUrl = 'http://127.0.0.1:56300/graphmind/'

function requireMacOS() {
  if (process.platform !== 'darwin') {
    throw new Error('Mira background service management currently supports macOS only')
  }
}

function launchctl(args, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync('/bin/launchctl', args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !allowFailure) {
    const detail = capture ? (result.stderr || result.stdout || '').trim() : ''
    throw new Error(`launchctl ${args[0]} failed${detail ? `: ${detail}` : ''}`)
  }
  return result
}

function isLoaded() {
  return launchctl(['print', launchTarget], { allowFailure: true, capture: true }).status === 0
}

async function probeService(timeoutMs = 500) {
  try {
    const response = await fetch(serviceUrl, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok
  } catch {
    return false
  }
}

async function waitForService(expected, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await probeService()) === expected) return true
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  return false
}

async function assertInstallReady() {
  await access(resolve(workspaceRoot, 'dist', 'index.html')).catch(() => {
    throw new Error('Frontend build is missing; run pnpm build before installing the service')
  })
}

async function stopLoadedService() {
  if (!isLoaded()) return false
  launchctl(['bootout', launchTarget])
  if (!(await waitForService(false))) {
    throw new Error(`Mira did not release ${serviceUrl} after stopping`)
  }
  return true
}

async function assertPortAvailable() {
  if (await probeService()) {
    throw new Error(
      `${serviceUrl} is already served by another process; stop it before starting Mira`,
    )
  }
}

async function startInstalledService() {
  await access(paths.plistPath).catch(() => {
    throw new Error('Mira service is not installed; run pnpm service:install first')
  })
  const loaded = isLoaded()
  const healthy = await probeService()
  if (!loaded) {
    await assertPortAvailable()
  }
  for (const action of launchActionsForStart({ loaded, healthy })) {
    if (action === 'bootstrap') launchctl(['bootstrap', launchDomain, paths.plistPath])
    if (action === 'kickstart') launchctl(['kickstart', launchTarget])
  }
  if (healthy) return
  if (!(await waitForService(true))) {
    throw new Error(`Mira did not become healthy at ${serviceUrl}; inspect pnpm service:logs`)
  }
}

async function install() {
  await assertInstallReady()
  await stopLoadedService()
  await assertPortAvailable()
  await mkdir(dirname(paths.plistPath), { recursive: true })
  await mkdir(paths.logDirectory, { recursive: true })
  const plist = createLaunchAgentPlist({
    workspaceRoot,
    nodePath: process.execPath,
    homeDirectory: homedir(),
  })
  const temporaryPath = `${paths.plistPath}.tmp-${process.pid}`
  await writeFile(temporaryPath, plist, { encoding: 'utf8', mode: 0o600 })
  await rename(temporaryPath, paths.plistPath)
  await startInstalledService()
  console.log(`[mira] installed and running: ${serviceUrl}`)
}

async function start() {
  await startInstalledService()
  console.log(`[mira] running: ${serviceUrl}`)
}

async function stop() {
  const stopped = await stopLoadedService()
  console.log(stopped ? '[mira] stopped' : '[mira] service is already stopped')
}

async function restart() {
  await stopLoadedService()
  await assertPortAvailable()
  await startInstalledService()
  console.log(`[mira] restarted: ${serviceUrl}`)
}

async function status() {
  const loaded = isLoaded()
  const healthy = await probeService()
  console.log(`[mira] launchd: ${loaded ? 'loaded' : 'not loaded'}`)
  console.log(`[mira] http: ${healthy ? `healthy (${serviceUrl})` : 'unavailable'}`)
  console.log(`[mira] stdout: ${paths.stdoutPath}`)
  console.log(`[mira] stderr: ${paths.stderrPath}`)
  if (!loaded || !healthy) process.exitCode = 1
}

async function logs() {
  for (const path of [paths.stdoutPath, paths.stderrPath]) {
    console.log(`\n==> ${path} <==`)
    const content = await readFile(path, 'utf8').catch(() => '')
    const lines = content.trimEnd().split('\n').slice(-80).join('\n')
    console.log(lines || '(empty)')
  }
}

async function uninstall() {
  await stopLoadedService()
  await rm(paths.plistPath, { force: true })
  console.log('[mira] service uninstalled; logs and workspace data were preserved')
}

async function main(command) {
  requireMacOS()
  switch (command) {
    case 'install':
      return install()
    case 'start':
      return start()
    case 'stop':
      return stop()
    case 'restart':
      return restart()
    case 'status':
      return status()
    case 'logs':
      return logs()
    case 'uninstall':
      return uninstall()
    default:
      throw new Error(
        'Usage: node scripts/macos-service.mjs <install|start|stop|restart|status|logs|uninstall>',
      )
  }
}

main(process.argv[2]).catch((error) => {
  console.error(`[mira] ${error.message}`)
  process.exitCode = 1
})
