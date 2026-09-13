import { rm } from 'node:fs/promises'
import { basename, dirname, resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
if (process.platform === 'darwin' && process.env.MIRA_SIGNING_TEMP) {
  const directory = resolve(process.env.MIRA_SIGNING_TEMP)
  if (dirname(directory) !== resolve(tmpdir()) || !basename(directory).startsWith('mira-signing-')) throw new Error('Unexpected signing temporary directory')
  await execute('security', ['delete-keychain', join(directory, 'release.keychain-db')])
  await rm(directory, { recursive: true, force: true })
}
if (process.platform === 'win32' && /^[a-f0-9]{40}$/i.test(process.env.MIRA_WINDOWS_CERT_THUMBPRINT || '')) {
  await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; Remove-Item -LiteralPath "Cert:\CurrentUser\My\$env:MIRA_WINDOWS_CERT_THUMBPRINT"'])
}
