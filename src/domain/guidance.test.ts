import { expect, it } from 'vitest'
import { listGuidance, resolveGuidance, validateGuidance } from './guidance.js'

it('offers the revised catalog without changing explicitly selected historical guidance', () => {
  const latest = listGuidance()[0]
  const historical = resolveGuidance({ id: latest.id, version: '1.0.0' })!
  expect(latest.version).toBe('1.0.1')
  expect(historical.version).toBe('1.0.0')
  expect(historical.digest).not.toBe(latest.digest)
  expect(latest.text).toContain(historical.text)
})

it('resolves one explicit catalog version and freezes edited visible guidance', () => {
  const catalog = listGuidance()
  expect(catalog.map(item => item.id)).toEqual(['mira-evidence-review', 'mira-close-reading', 'mira-revision'])
  expect(resolveGuidance(null)).toBeUndefined()
  const source = catalog[1]
  const snapshot = resolveGuidance({ id: source.id, version: source.version, text: '只回答我提出的问题。' })!
  expect(snapshot.customized).toBe(true)
  expect(snapshot.text).toBe('只回答我提出的问题。')
  expect(snapshot.digest).not.toBe(source.digest)
  expect(() => validateGuidance(snapshot)).not.toThrow()
  expect(() => validateGuidance({ ...snapshot, text: 'tampered' })).toThrow()
  expect(() => resolveGuidance({ id: source.id, version: 'unknown' })).toThrow()
  expect(() => resolveGuidance({ id: 'not-installed', version: '1' })).toThrow()
  expect(() => resolveGuidance({ ...source, script: 'run.js' })).toThrow()
})

it('preserves valid imported frozen text while never installing a catalog entry', () => {
  const snapshot = { ...listGuidance()[0], id: 'historical-guidance', version: '0.0.1' }
  expect(() => validateGuidance(snapshot)).not.toThrow()
  expect(() => resolveGuidance({ id: snapshot.id, version: snapshot.version })).toThrow()
  expect(listGuidance()).toHaveLength(3)
  expect(() => validateGuidance({ ...snapshot, text: ' '.repeat(20001) })).toThrow()
})
