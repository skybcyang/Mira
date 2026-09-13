import { FusesPlugin } from '@electron-forge/plugin-fuses'
import { FuseV1Options, FuseVersion } from '@electron/fuses'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { releaseProfile } from './scripts/release-policy.mjs'
import { finishReleaseSigning, finishReleaseArtifacts } from './scripts/release-signing.mjs'

const require = createRequire(import.meta.url)
const electronChecksums = require('electron/checksums.json')
const desktopIconPath = fileURLToPath(new URL('./desktop/assets/mira-app.icns', import.meta.url))

export const desktopPackagePolicy = Object.freeze({
  architectures: Object.freeze(['arm64', 'x64']),
  asar: true,
  formats: Object.freeze(['dmg', 'zip']),
  minimumMacOS: '13.0',
  signed: false,
  notarized: false,
  fuses: Object.freeze({
    runAsNode: false,
    enableCookieEncryption: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  }),
})

const forgeConfig = {
  packagerConfig: {
    asar: { unpackDir: 'pdf-runtime' },
    download: {
      checksums: electronChecksums,
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO',
        icon: desktopIconPath,
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
  ],
  plugins: [
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: desktopPackagePolicy.fuses.runAsNode,
      [FuseV1Options.EnableCookieEncryption]: desktopPackagePolicy.fuses.enableCookieEncryption,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:
        desktopPackagePolicy.fuses.enableNodeOptionsEnvironmentVariable,
      [FuseV1Options.EnableNodeCliInspectArguments]:
        desktopPackagePolicy.fuses.enableNodeCliInspectArguments,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:
        desktopPackagePolicy.fuses.enableEmbeddedAsarIntegrityValidation,
      [FuseV1Options.OnlyLoadAppFromAsar]: desktopPackagePolicy.fuses.onlyLoadAppFromAsar,
      [FuseV1Options.GrantFileProtocolExtraPrivileges]:
        desktopPackagePolicy.fuses.grantFileProtocolExtraPrivileges,
    }),
  ],
}

export function createDesktopForgeConfig(platform = process.platform) {
  const profile = releaseProfile(process.env, platform)
  return {
    ...forgeConfig,
    hooks: { postPackage: finishReleaseSigning, postMake: finishReleaseArtifacts },
    packagerConfig: {
      ...forgeConfig.packagerConfig,
      ...(platform === 'darwin' ? {
        appBundleId: 'com.mira.desktop',
        appCategoryType: 'public.app-category.productivity',
        icon: desktopIconPath,
        extendInfo: { LSMinimumSystemVersion: desktopPackagePolicy.minimumMacOS },
        osxSign: profile.mode === 'release' ? { identity: profile.identity, hardenedRuntime: true } : false,
        osxNotarize: profile.mode === 'release' ? { keychainProfile: profile.keychainProfile, ...(process.env.MIRA_MAC_NOTARY_KEYCHAIN ? { keychain: process.env.MIRA_MAC_NOTARY_KEYCHAIN } : {}) } : false,
      } : {}),
    },
  }
}

export default createDesktopForgeConfig()
