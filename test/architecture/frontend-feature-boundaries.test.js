import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

describe('frontend feature boundaries', () => {
  it('loads non-canvas panels as independent feature chunks', async () => {
    const app = await readFile(new URL('src/App.tsx', root), 'utf8')

    expect(app).toContain("lazy(() => import('./v2/DetailDrawer'))")
    expect(app).toContain("lazy(() => import('./v2/WorkflowLibrary'))")
    expect(app).toContain("lazy(() => import('./v2/ModelSettings'))")
    expect(app).not.toMatch(/import DetailDrawer from/)
    expect(app).not.toMatch(/import WorkflowLibrary from/)
    expect(app).not.toMatch(/import ModelSettings from/)
  })

  it('loads the inspiration picker as an independent modal feature', async () => {
    const app = await readFile(new URL('src/App.tsx', root), 'utf8')

    expect(app).toContain("lazy(() => import('./v2/InspirationPicker'))")
    expect(app).toMatch(/<InspirationPicker\b/)
    expect(app).not.toMatch(/sidePanel\s*===\s*['"]inspiration['"]/)
    expect(app).not.toMatch(/setSidePanel\(['"]inspiration['"]\)/)
    expect(app).not.toMatch(/import InspirationPicker from/)
  })

  it('keeps the canvas store contract separate from Zustand orchestration', async () => {
    const [store, contract] = await Promise.all([
      readFile(new URL('src/v2Store.ts', root), 'utf8'),
      readFile(new URL('src/v2/storeTypes.ts', root), 'utf8'),
    ])

    expect(store).toContain("import type { V2CanvasState")
    expect(store).not.toMatch(/interface V2CanvasState/)
    expect(contract).toContain('export interface V2CanvasState')
    expect(contract).toContain('export type CanvasHistoryEntry')
  })

  it('isolates the stable canvas vendor bundle from product features', async () => {
    const vite = await readFile(new URL('vite.config.ts', root), 'utf8')

    expect(vite).toContain("return 'canvas-vendor'")
    expect(vite).toContain("id.includes('/node_modules/@xyflow/')")
  })

  it('delegates inspiration commands to a slice without copying their orchestration', async () => {
    const store = await readFile(new URL('src/v2Store.ts', root), 'utf8')

    expect(store).toContain("from './v2/inspirationSlice'")
    expect(store).toContain('createInspirationSlice({')
    expect(store).not.toContain('mapInspirationPoolSelectionToSnapshotInputs')
    expect(store).not.toContain('v2Api.createInspirationEntry(')

    const slice = await readFile(new URL('src/v2/inspirationSlice.ts', root), 'utf8')
    expect(slice).not.toMatch(/from ['"](?:react|\.\.\/v2Store)['"]/)
    expect(slice).toContain('contextIsCurrent(context)')
  })

  it('keeps Run polling and Candidate commands in the existing Run slice', async () => {
    const store = await readFile(new URL('src/v2Store.ts', root), 'utf8')

    expect(store).toContain("from './v2/runSlice'")
    expect(store).toContain('...runSlice.actions')
    expect(store).not.toMatch(/async function (?:trackRun|runToTransformation)\(/)
    expect(store).not.toContain('v2Api.adoptCandidate(')
  })
})
