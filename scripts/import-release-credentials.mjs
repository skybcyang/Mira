import { mkdtemp, writeFile, rm, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execute = promisify(execFile)
const needed = name => { if (!process.env[name]) throw new Error(`Missing release secret: ${name}`); return process.env[name] }
const directory = await mkdtemp(join(tmpdir(), 'mira-signing-'))
let createdKeychain
try {
  const file = join(directory, 'certificate.p12')
  await writeFile(file, Buffer.from(needed('MIRA_SIGNING_P12_BASE64'), 'base64'), { mode: 0o600 })
  if (process.platform === 'darwin') {
    const keychain = join(directory, 'release.keychain-db')
    const password = needed('MIRA_KEYCHAIN_PASSWORD')
    await execute('security', ['create-keychain', '-p', password, keychain])
    createdKeychain = keychain
    await execute('security', ['set-keychain-settings', '-lut', '21600', keychain])
    await execute('security', ['unlock-keychain', '-p', password, keychain])
    await execute('security', ['import', file, '-k', keychain, '-P', needed('MIRA_SIGNING_P12_PASSWORD'), '-T', '/usr/bin/codesign'])
    await execute('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain])
    await execute('security', ['list-keychains', '-d', 'user', '-s', keychain])
    const profile = 'mira-release-notary'
    await execute('xcrun', ['notarytool', 'store-credentials', profile, '--apple-id', needed('MIRA_APPLE_ID'), '--team-id', needed('MIRA_APPLE_TEAM_ID'), '--password', needed('MIRA_APPLE_APP_PASSWORD'), '--keychain', keychain])
    await appendFile(needed('GITHUB_ENV'), `MIRA_MAC_NOTARY_PROFILE=${profile}\nMIRA_MAC_NOTARY_KEYCHAIN=${keychain}\nMIRA_SIGNING_TEMP=${directory}\n`)
  } else if (process.platform === 'win32') {
    const script = '$ErrorActionPreference="Stop"; $password=ConvertTo-SecureString $env:MIRA_SIGNING_P12_PASSWORD -AsPlainText -Force; $cert=Import-PfxCertificate -FilePath $env:MIRA_SIGNING_P12_FILE -CertStoreLocation Cert:\CurrentUser\My -Password $password; if(!$cert.HasPrivateKey){throw "Missing private key"}; $cert.Thumbprint'
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, MIRA_SIGNING_P12_FILE: file } })
    const thumbprint = stdout.trim()
    if (!/^[a-f0-9]{40}$/i.test(thumbprint)) throw new Error('Certificate import returned invalid thumbprint')
    await appendFile(needed('GITHUB_ENV'), `MIRA_WINDOWS_CERT_THUMBPRINT=${thumbprint}\n`)
    await rm(directory, { recursive: true, force: true })
  } else throw new Error('Unsupported signing host')
} catch {
  // Child-process errors can contain secret command arguments. Never log them.
  if (createdKeychain) await execute('security', ['delete-keychain', createdKeychain]).catch(() => {})
  await rm(directory, { recursive: true, force: true })
  console.error('Release credentials could not be imported; no unsigned fallback is permitted.')
  process.exitCode = 1
}
