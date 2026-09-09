import { isAbsolute, join, resolve } from 'node:path'

export const MIRA_SERVICE_LABEL = 'com.mira.standalone'

export function launchActionsForStart({ loaded, healthy }) {
  if (loaded && healthy) return []
  return loaded ? ['kickstart'] : ['bootstrap', 'kickstart']
}

function requiredAbsolutePath(value, name) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path`)
  }
  return resolve(value)
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function resolveServicePaths({ homeDirectory, workspaceRoot }) {
  const home = requiredAbsolutePath(homeDirectory, 'homeDirectory')
  const workspace = requiredAbsolutePath(workspaceRoot, 'workspaceRoot')
  const logDirectory = join(home, 'Library', 'Logs', 'Mira')

  return {
    label: MIRA_SERVICE_LABEL,
    plistPath: join(home, 'Library', 'LaunchAgents', `${MIRA_SERVICE_LABEL}.plist`),
    logDirectory,
    stdoutPath: join(logDirectory, 'standalone.log'),
    stderrPath: join(logDirectory, 'standalone.error.log'),
    workspaceRoot: workspace,
  }
}

export function createLaunchAgentPlist({ workspaceRoot, nodePath, homeDirectory }) {
  const paths = resolveServicePaths({ homeDirectory, workspaceRoot })
  const node = requiredAbsolutePath(nodePath, 'nodePath')
  const script = join(paths.workspaceRoot, 'scripts', 'macos-service-supervisor.mjs')
  const staticRoot = join(paths.workspaceRoot, 'dist')
  const xml = escapeXml

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MIRA_SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(paths.workspaceRoot)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>MIRA_HOST</key>
    <string>127.0.0.1</string>
    <key>MIRA_PORT</key>
    <string>56300</string>
    <key>MIRA_WORKSPACE_ROOT</key>
    <string>${xml(paths.workspaceRoot)}</string>
    <key>MIRA_STATIC_ROOT</key>
    <string>${xml(staticRoot)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StartInterval</key>
  <integer>15</integer>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(paths.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(paths.stderrPath)}</string>
</dict>
</plist>
`
}
