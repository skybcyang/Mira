import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { writeFile } from 'node:fs/promises'
import { releaseProfile } from './release-policy.mjs'
import { digestAsset } from './release-manifest.mjs'
const execute = promisify(execFile)
const verifiedTargets = new Set()
export async function finishReleaseSigning(_config, result) {
  const profile = releaseProfile(process.env, result.platform)
  if (profile.mode !== 'release') return
  for (const outputPath of result.outputPaths) {
    if (result.platform === 'win32') await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./sign-windows-release.ps1', import.meta.url)), '-Directory', outputPath])
    else {
      const app = `${outputPath}/Mira.app`
      await execute('codesign', ['--verify', '--deep', '--strict', app])
      await execute('xcrun', ['stapler', 'staple', app])
      await execute('xcrun', ['stapler', 'validate', app])
      await execute('spctl', ['--assess', '--type', 'execute', app])
    }
  }
  if (!result.outputPaths.length) throw new Error('No signed application was verified')
  verifiedTargets.add(`${result.platform}-${result.arch}`)
}
export async function finishReleaseArtifacts(_config, results) {
  const profile = releaseProfile()
  if (profile.mode !== 'release') return results
  for (const result of results) for (const artifact of result.artifacts || []) {
    const target = `${result.platform}-${result.arch}`
    if (!verifiedTargets.has(target)) throw new Error('Application signature checks did not complete in this build')
    if (artifact.endsWith('.dmg')) {
    await execute('codesign', ['--sign', profile.identity, '--timestamp', artifact])
    await execute('codesign', ['--verify', '--strict', artifact])
    await execute('xcrun', ['notarytool', 'submit', artifact, '--keychain-profile', profile.keychainProfile,
      ...(process.env.MIRA_MAC_NOTARY_KEYCHAIN ? ['--keychain', process.env.MIRA_MAC_NOTARY_KEYCHAIN] : []), '--wait'])
    await execute('xcrun', ['stapler', 'staple', artifact])
    await execute('xcrun', ['stapler', 'validate', artifact])
    }
    await writeFile(`${artifact}.signature.json`, JSON.stringify({ ...await digestAsset(artifact), target, version: result.packageJSON.version, sourceSha: process.env.MIRA_RELEASE_SOURCE_SHA, signing: 'verified' }, null, 2) + '\n')
  }
  return results
}
