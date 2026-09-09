import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  MIRA_SERVICE_LABEL,
  createLaunchAgentPlist,
  launchActionsForStart,
  resolveServicePaths,
} from '../../scripts/macos-service-lib.mjs'
import { createRestartingSupervisor } from '../../scripts/service-supervisor-lib.mjs'

describe('macOS background service', () => {
  it('uses stable user-scoped service and log paths', () => {
    expect(
      resolveServicePaths({
        homeDirectory: '/Users/example',
        workspaceRoot: '/work/Mira',
      }),
    ).toEqual({
      label: 'com.mira.standalone',
      plistPath: '/Users/example/Library/LaunchAgents/com.mira.standalone.plist',
      logDirectory: '/Users/example/Library/Logs/Mira',
      stdoutPath: '/Users/example/Library/Logs/Mira/standalone.log',
      stderrPath: '/Users/example/Library/Logs/Mira/standalone.error.log',
      workspaceRoot: '/work/Mira',
    })
    expect(MIRA_SERVICE_LABEL).toBe('com.mira.standalone')
  })

  it('creates a local-only, continuously kept-alive LaunchAgent without secrets', () => {
    const plist = createLaunchAgentPlist({
      workspaceRoot: '/Users/example/Mira & Notes',
      nodePath: '/opt/homebrew/bin/node',
      homeDirectory: '/Users/example',
    })

    expect(plist).toContain('<string>com.mira.standalone</string>')
    expect(plist).toContain('<string>/opt/homebrew/bin/node</string>')
    expect(plist).toContain(
      '<string>/Users/example/Mira &amp; Notes/scripts/macos-service-supervisor.mjs</string>',
    )
    expect(plist).toContain('<key>RunAtLoad</key>\n  <true/>')
    expect(plist).toContain('<key>KeepAlive</key>\n  <true/>')
    expect(plist).not.toContain('<key>SuccessfulExit</key>')
    expect(plist).toContain('<key>StartInterval</key>\n  <integer>15</integer>')
    expect(plist).toContain('<key>MIRA_HOST</key>\n    <string>127.0.0.1</string>')
    expect(plist).toContain('<key>MIRA_PORT</key>\n    <string>56300</string>')
    expect(plist).toContain(
      '<key>MIRA_WORKSPACE_ROOT</key>\n    <string>/Users/example/Mira &amp; Notes</string>',
    )
    expect(plist).toContain(
      '<key>MIRA_STATIC_ROOT</key>\n    <string>/Users/example/Mira &amp; Notes/dist</string>',
    )
    expect(plist).not.toMatch(/API_KEY|TOKEN|SECRET/i)
  })

  it('exposes explicit lifecycle commands through the package scripts', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
    )

    expect(packageJson.scripts).toMatchObject({
      'service:install': 'node scripts/macos-service.mjs install',
      'service:start': 'node scripts/macos-service.mjs start',
      'service:stop': 'node scripts/macos-service.mjs stop',
      'service:restart': 'node scripts/macos-service.mjs restart',
      'service:status': 'node scripts/macos-service.mjs status',
      'service:logs': 'node scripts/macos-service.mjs logs',
      'service:uninstall': 'node scripts/macos-service.mjs uninstall',
    })

    const command = await readFile(
      new URL('../../scripts/macos-service.mjs', import.meta.url),
      'utf8',
    )
    expect(command).toContain("case 'install'")
    expect(command).toContain("case 'status'")
    expect(command).toContain("case 'uninstall'")
  })

  it('explicitly starts a newly bootstrapped job on on-demand launchd domains', () => {
    expect(launchActionsForStart({ loaded: false, healthy: false })).toEqual([
      'bootstrap',
      'kickstart',
    ])
    expect(launchActionsForStart({ loaded: true, healthy: false })).toEqual([
      'kickstart',
    ])
    expect(launchActionsForStart({ loaded: true, healthy: true })).toEqual([])
  })

  it('restarts a crashed service child and stops it without another restart', () => {
    const children = []
    const scheduled = []
    const startChild = () => {
      const child = new EventEmitter()
      child.kill = (signal) => child.emit('killed', signal)
      children.push(child)
      return child
    }
    const supervisor = createRestartingSupervisor({
      startChild,
      schedule(callback, delay) {
        scheduled.push({ callback, delay })
        return scheduled.length
      },
      cancelSchedule() {},
      logger: { error() {} },
    })

    supervisor.start()
    children[0].emit('exit', 1, null)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0].delay).toBe(1_000)
    scheduled[0].callback()
    expect(children).toHaveLength(2)

    let stoppedWith
    children[1].once('killed', (signal) => {
      stoppedWith = signal
    })
    supervisor.stop()
    expect(stoppedWith).toBe('SIGTERM')
    children[1].emit('exit', 0, null)
    expect(scheduled).toHaveLength(1)
  })
})
