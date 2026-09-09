import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const generatedRoot = mkdtempSync(join(tmpdir(), 'mira-coffee-layout-'))

execFileSync(process.execPath, [
  resolve(repositoryRoot, 'scripts/seed-coffee-shop-showcase.mjs'),
  generatedRoot,
])

const generatedBoard = JSON.parse(readFileSync(
  join(generatedRoot, 'boards-v2/board-showcase-11-coffee-opening.json'),
  'utf8',
))
const currentBoard = JSON.parse(readFileSync(
  resolve(repositoryRoot, 'test/fixtures/coffee-layout.json'),
  'utf8',
))

afterAll(() => rmSync(generatedRoot, { recursive: true, force: true }))

function stage(title) {
  const match = title.match(/^# ([A-GP])\d+/)
  if (!match) return null
  return { A: title.startsWith('# A') && Number(title.match(/^# A(\d+)/)?.[1]) > 6 ? 1 : 0,
    B: 2, C: 3, D: 4, E: 5, F: 6, P: 7, G: null }[match[1]]
}

function expectedColumn(card) {
  const markdown = card.versions.find((version) => version.id === card.headVersionId)?.content?.markdown || ''
  if (markdown.startsWith('# G1') || markdown.startsWith('# G2') || markdown.startsWith('# G3')) return 8
  if (markdown.startsWith('# G4')) return 9
  if (markdown.startsWith('# G5')) return 10
  return stage(markdown)
}

function expectEditorialStageGrid(board) {
  const positioned = board.cards.filter((card) => expectedColumn(card) !== null)
  expect(positioned.every((card) => Number.isInteger(card.x) && Number.isInteger(card.y))).toBe(true)
  for (const card of positioned) expect(card.x).toBe(expectedColumn(card) * 520)

  const columns = new Map()
  for (const card of positioned) {
    columns.set(card.x, [...(columns.get(card.x) || []), card])
  }
  for (const cards of columns.values()) {
    const ordered = [...cards].sort((left, right) => left.y - right.y)
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]
      expect(ordered[index].y - (previous.y + previous.height)).toBeGreaterThanOrEqual(80)
    }
  }
}

describe('coffee shop showcase layout', () => {
  it('generates a spacious left-to-right stage grid', () => {
    expectEditorialStageGrid(generatedBoard)
  })

  it('keeps the 53rd decision target clear of all 52 sources in the layout fixture', () => {
    expect(currentBoard.cards).toHaveLength(53)
    const aggregate = currentBoard.transformations.find(
      (transformation) => transformation.targetCardId === 'fixture-card-53',
    )
    expect(aggregate?.sourceCardIds).toHaveLength(52)
    expectEditorialStageGrid(currentBoard)
    const aggregateTarget = currentBoard.cards.find((card) => card.id === aggregate?.targetCardId)
    const sourceRight = Math.max(...aggregate.sourceCardIds.map((sourceId) => {
      const source = currentBoard.cards.find((card) => card.id === sourceId)
      return source.x + source.width
    }))
    expect(aggregateTarget).toMatchObject({ x: 6240, y: 900 })
    expect(aggregateTarget.x - sourceRight).toBeGreaterThanOrEqual(600)
  })
})
