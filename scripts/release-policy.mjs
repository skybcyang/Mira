export const RELEASE_TARGETS = Object.freeze(['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64'])
export const RELEASES_URL = 'https://github.com/skybcyang/Mira/releases'
export function expectedReleaseAsset(file, target, version) {
  return file === `Mira-${target}-${version}.zip` || (target.startsWith('darwin-') && file === `Mira-${version}-${target.slice(7)}.dmg`)
}
export function releaseProfile(env = process.env, platform = process.platform) {
  const mode = env.MIRA_DESKTOP_BUILD_PROFILE || 'internal'
  if (mode === 'internal') return { mode }
  if (mode !== 'release') throw new Error('Unknown desktop build profile')
  const requireValue = name => { if (!env[name]?.trim()) throw new Error(`Release profile requires ${name}`); return env[name].trim() }
  if (platform === 'darwin') return { mode, identity: requireValue('MIRA_MAC_SIGN_IDENTITY'), keychainProfile: requireValue('MIRA_MAC_NOTARY_PROFILE') }
  if (platform === 'win32') {
    const thumbprint = requireValue('MIRA_WINDOWS_CERT_THUMBPRINT')
    if (!/^[a-f0-9]{40}$/i.test(thumbprint)) throw new Error('Windows signing certificate thumbprint is invalid')
    return { mode, thumbprint }
  }
  throw new Error('Unsupported release platform')
}
export function validateReleaseSet(assets, { version, sourceSha }) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version || '') || !/^[a-f0-9]{40}$/.test(sourceSha || '')) throw new Error('Release requires exact SemVer and commit SHA')
  if (!Array.isArray(assets) || !assets.length) throw new Error('Release assets are missing')
  const seen = new Set()
  for (const asset of assets) {
    if (!RELEASE_TARGETS.includes(asset.target) || asset.version !== version || asset.sourceSha !== sourceSha || asset.signing !== 'verified'
      || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256 || '')
      || !expectedReleaseAsset(asset.file, asset.target, version) || seen.has(asset.file)
      || !/^https:\/\/github\.com\/skybcyang\/Mira\/actions\/runs\/\d+$/.test(asset.buildUrl || '')) throw new Error('Release asset metadata is inconsistent, unsigned or invalid')
    seen.add(asset.file)
  }
  for (const target of RELEASE_TARGETS) if (!assets.some(asset => asset.target === target && asset.file.endsWith('.zip'))) throw new Error(`Missing release ZIP: ${target}`)
  return assets
}
