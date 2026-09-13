import { expect, it } from 'vitest'
import { validateReleaseSet, releaseProfile } from '../../scripts/release-policy.mjs'
import { assembleRelease, digestAsset, prepareTargetManifest } from '../../scripts/release-manifest.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const targets = ['darwin-arm64', 'darwin-x64', 'win32-arm64', 'win32-x64']
const assets = () => targets.map(target => ({ target, version: '0.1.0-beta.2', sourceSha: 'a'.repeat(40), file: `Mira-${target}-0.1.0-beta.2.zip`, bytes: 100, sha256: 'b'.repeat(64), signing: 'verified', buildUrl: 'https://github.com/skybcyang/Mira/actions/runs/123' }))
it('rejects a filename for another version or architecture', () => {
  for (const file of ['Mira-darwin-arm64-0.0.1.zip', 'Mira-win32-arm64-0.1.0-beta.2.zip']) {
    const list = assets(); list[0].file = file
    expect(() => validateReleaseSet(list, { version: list[0].version, sourceSha: list[0].sourceSha })).toThrow()
  }
})
it('checks actual artifact bytes and requires signing evidence before describing a target as verified', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-release-manifest-'))
  const before = process.env.MIRA_DESKTOP_BUILD_PROFILE
  try {
    const list = assets()
    for (const item of list) {
      await writeFile(join(root, item.file), item.target)
      Object.assign(item, await digestAsset(join(root, item.file)))
      await writeFile(join(root, `manifest-${item.target}.json`), JSON.stringify({ assets: [item] }))
    }
    const spec = { version: list[0].version, sourceSha: list[0].sourceSha }
    expect((await assembleRelease(root, spec)).assets).toHaveLength(4)
    await writeFile(join(root, list[0].file), 'changed bytes')
    await expect(assembleRelease(root, spec)).rejects.toThrow('checksum mismatch')
    process.env.MIRA_DESKTOP_BUILD_PROFILE = 'release'
    await expect(prepareTargetManifest({ directory: root, target: 'darwin-arm64', ...spec, buildUrl: list[0].buildUrl })).rejects.toThrow()
  } finally {
    if (before === undefined) delete process.env.MIRA_DESKTOP_BUILD_PROFILE; else process.env.MIRA_DESKTOP_BUILD_PROFILE = before
    await rm(root, { recursive: true, force: true })
  }
})
it('refuses incomplete, mixed-source, unsigned or tampered release descriptors', () => {
  expect(validateReleaseSet(assets(), { version: '0.1.0-beta.2', sourceSha: 'a'.repeat(40) })).toHaveLength(4)
  for (const list of [assets().slice(1), assets().map((item, index) => index ? item : { ...item, signing: 'unsigned' }), assets().map((item, index) => index ? item : { ...item, sourceSha: 'c'.repeat(40) })]) expect(() => validateReleaseSet(list, { version: '0.1.0-beta.2', sourceSha: 'a'.repeat(40) })).toThrow()
})
it('release mode fails closed without platform credentials while internal stays unsigned', () => {
  expect(releaseProfile({}, 'darwin')).toEqual({ mode: 'internal' })
  expect(() => releaseProfile({ MIRA_DESKTOP_BUILD_PROFILE: 'release' }, 'darwin')).toThrow('MIRA_MAC_SIGN_IDENTITY')
  expect(() => releaseProfile({ MIRA_DESKTOP_BUILD_PROFILE: 'release' }, 'win32')).toThrow('MIRA_WINDOWS_CERT_THUMBPRINT')
  expect(() => releaseProfile({ MIRA_DESKTOP_BUILD_PROFILE: 'other' }, 'darwin')).toThrow()
})
