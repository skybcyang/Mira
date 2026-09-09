import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)

describe('detail panel boundaries', () => {
  it('keeps the lazy entry as drawer navigation and delegates each panel', async () => {
    const entry = await readFile(new URL('src/v2/DetailDrawer.tsx', root), 'utf8')

    for (const panel of ['ContentPanel', 'VersionPanel', 'RelationPanel', 'RunPanel']) {
      expect(entry).toContain(`from './detail/${panel}'`)
      expect(entry).toContain(`<${panel} `)
      expect(entry).not.toMatch(new RegExp(`function ${panel}\\(`))
    }
    expect(entry).toContain('drawerTabTargets(drawer, board, runs)')
    expect(entry).toContain('nextDrawerTabIndex(')
    expect(entry).not.toContain('v2Api.')
    expect(entry).not.toContain('reconcileDraftSnapshot(')
    expect(entry).not.toContain('runExclusiveAction(')
    expect(entry).not.toContain('workflowExtractionPreview(')
  })

  it('keeps panel dependencies inward and existing component exports stable', async () => {
    const entry = await readFile(new URL('src/v2/DetailDrawer.tsx', root), 'utf8')
    for (const name of [
      'ContentReaderView', 'ContentEditorView', 'CardTagEditor',
      'SaveWorkflowForm', 'SaveWorkflowControl', 'WorkflowProvenancePanel',
      'TransformationEditForm', 'TransformationDeleteControl', 'transformationEditCommandLabel',
      'TransformationRunControl', 'RunStopButton', 'CandidateDecisionActions', 'RunPanelView',
    ]) {
      expect(entry).toMatch(new RegExp(`export \\{[^}]*\\b${name}\\b[^}]*\\} from './detail/`))
    }
    const directory = new URL('src/v2/detail/', root)
    for (const filename of await readdir(directory)) {
      const source = await readFile(new URL(filename, directory), 'utf8')
      expect(source).not.toMatch(/from ['"][^'"]*(?:DetailDrawer|App|bridge)[^'"]*['"]/)
    }
  })
})
