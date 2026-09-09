import { readStyles } from '../helpers/read-styles.js'
import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

async function exists(path) {
  try {
    await access(new URL(path, root))
    return true
  } catch {
    return false
  }
}

describe('single Mira product surface', () => {
  it('removes the legacy application and Action/chain production modules', async () => {
    const removed = [
      'src/LegacyApp.tsx',
      'src/App 2.tsx',
      'src/store.ts',
      'src/types.ts',
      'src/api/client.ts',
      'src/components',
      'src/lib/exportCanvas.ts',
      'src/verify-export.tsx',
      'verify-export.html',
      'scripts/verify-server.mjs',
      'bridge/action-http.js',
      'bridge/action-runtime.js',
      'bridge/chain-runner.js',
      'bridge/board-store.js',
      'bridge/run-store.js',
      'bridge/context-assembly.js',
      'bridge/executable-model.js',
      'bridge/suggestion-service.js',
      'bridge/transformation-http.js',
      'bridge/legacy/boardV1Adapter.js',
    ]

    await expect(Promise.all(removed.map(exists))).resolves.toEqual(removed.map(() => false))
  })

  it('keeps the application entry and bridge wired only to the current model', async () => {
    const [
      app,
      bridgeEntry,
      application,
      http,
      nodeHost,
      dshAdapter,
      packageJson,
      vite,
      index,
    ] = await Promise.all([
      readFile(new URL('src/App.tsx', root), 'utf8'),
      readFile(new URL('bridge/main.js', root), 'utf8'),
      readFile(new URL('bridge/mira-application.js', root), 'utf8'),
      readFile(new URL('bridge/mira-http.js', root), 'utf8'),
      readFile(new URL('bridge/node-host.js', root), 'utf8'),
      readFile(new URL('bridge/dsh-cordis-adapter.js', root), 'utf8'),
      readFile(new URL('package.json', root), 'utf8'),
      readFile(new URL('vite.config.ts', root), 'utf8'),
      readFile(new URL('index.html', root), 'utf8'),
    ])
    const bridge = [bridgeEntry, application, http, nodeHost, dshAdapter].join('\n')

    expect(app).not.toMatch(/LegacyApp|advanced|高级模式/)
    expect(bridge).not.toMatch(
      /action-runtime|chain-runner|legacyStore|\bBoardStore\b|createRunStore/,
    )
    expect(packageJson).not.toMatch(/html-to-image|jspdf/)
    expect(JSON.parse(packageJson).name).toBe('mira')
    expect(vite).not.toMatch(/verify-export|verify:/)
    expect(index).not.toContain('Mira 原型')
  })

  it('finishes import, Candidate, and interrupted-run recovery before API work', async () => {
    const application = await readFile(
      new URL('bridge/mira-application.js', root),
      'utf8',
    )

    const importRecovery = application.indexOf('imported = await importCommitter.recover()')
    const runRecovery = application.indexOf(
      'runRecovery = await recoverRunsAtBoot({ handlers, runStore })',
    )
    expect(importRecovery).toBeGreaterThanOrEqual(0)
    expect(runRecovery).toBeGreaterThan(importRecovery)
    expect(application).toMatch(/async function dispatch[\s\S]*await ready/)
  })

  it('keeps the current Run lifecycle free of the removed confirmation state', async () => {
    const sources = await Promise.all([
      'src/domain/runs.ts',
      'src/v2Store.ts',
      'src/v2/ContentCard.tsx',
      'bridge/v2-run-store.js',
      'bridge/v2-http.js',
    ].map((path) => readFile(new URL(path, root), 'utf8')))

    expect(sources.join('\n')).not.toContain('waiting_confirmation')
  })

  it('keeps every selected source visible in the mobile context dock', async () => {
    const styles = await readStyles(new URL('src/styles.css', root))
    const mobile = styles.slice(styles.indexOf('@media (max-width: 719px)'))

    expect(mobile).toMatch(/\.v2-dock-sources\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*overflow-x:\s*visible;/s)
    expect(mobile).toMatch(/\.v2-source-chip\s*{[^}]*width:\s*100%;[^}]*max-width:\s*none;/s)
    expect(mobile).toMatch(/\.v2-source-chip strong\s*{[^}]*min-width:\s*0;[^}]*max-width:\s*none;/s)
  })
})
