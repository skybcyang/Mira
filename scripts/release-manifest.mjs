import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RELEASE_TARGETS, expectedReleaseAsset, validateReleaseSet } from './release-policy.mjs'
async function files(root) {
  const entries = await readdir(root, { withFileTypes: true })
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(join(root, entry.name)) : [join(root, entry.name)]))).flat()
}
export async function digestAsset(path) { return { file: basename(path), bytes: (await stat(path)).size, sha256: createHash('sha256').update(await readFile(path)).digest('hex') } }
export async function prepareTargetManifest({ directory, target, version, sourceSha, buildUrl }) {
  if (!RELEASE_TARGETS.includes(target) || process.env.MIRA_DESKTOP_BUILD_PROFILE !== 'release') throw new Error('Target manifest requires a verified release build')
  const paths = (await files(directory)).filter(path => /\.(?:zip|dmg)$/.test(path))
  if (!paths.length) throw new Error('No packaged release assets found')
  const assets = await Promise.all(paths.map(async path => {
    const digest = await digestAsset(path)
    if (!expectedReleaseAsset(digest.file, target, version)) throw new Error('Unexpected release asset version or target')
    const proof = JSON.parse(await readFile(`${path}.signature.json`, 'utf8'))
    if (proof.target !== target || proof.version !== version || proof.sourceSha !== sourceSha || proof.signing !== 'verified'
      || proof.file !== digest.file || proof.bytes !== digest.bytes || proof.sha256 !== digest.sha256) throw new Error('Missing or stale signing evidence')
    return { ...digest, target, version, sourceSha, buildUrl, signing: 'verified' }
  }))
  await writeFile(join(directory, `manifest-${target}.json`), JSON.stringify({ version, sourceSha, assets }, null, 2) + '\n')
  return assets
}
export async function assembleRelease(directory, { version, sourceSha }) {
  const paths = await files(directory)
  const reports = await Promise.all(paths.filter(path => /manifest-(darwin|win32)-(arm64|x64)\.json$/.test(path)).map(async path => JSON.parse(await readFile(path, 'utf8'))))
  const assets = validateReleaseSet(reports.flatMap(report => report.assets || []), { version, sourceSha })
  for (const asset of assets) {
    const matches = paths.filter(path => basename(path) === asset.file)
    if (matches.length !== 1) throw new Error(`Missing or duplicate release asset: ${asset.file}`)
    const actual = await digestAsset(matches[0])
    if (actual.bytes !== asset.bytes || actual.sha256 !== asset.sha256) throw new Error(`Release asset checksum mismatch: ${asset.file}`)
  }
  const manifest = { format: 'mira-release-v1', version, tag: `v${version}`, sourceSha, prerelease: version.includes('-'), assets }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  await writeFile(join(directory, 'SHA256SUMS'), assets.map(asset => `${asset.sha256}  ${asset.file}`).join('\n') + '\n')
  return manifest
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, directory, target] = process.argv.slice(2)
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const sourceSha = process.env.MIRA_RELEASE_SOURCE_SHA, buildUrl = `https://github.com/skybcyang/Mira/actions/runs/${process.env.GITHUB_RUN_ID}`
  if (mode === 'target') await prepareTargetManifest({ directory, target, version, sourceSha, buildUrl })
  else if (mode === 'assemble') await assembleRelease(directory, { version, sourceSha })
  else throw new Error('Use target or assemble; neither command publishes a release')
}
