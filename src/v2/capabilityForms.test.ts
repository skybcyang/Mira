import { expect, it } from 'vitest'
import { connectionInput, objectInput, toolDependencyIds, dependencyPins, attachmentPreview, catalogChanges } from './capabilityForms'

it('keeps MCP arguments literal and separates transient credentials from connection configuration', () => {
  const result = connectionInput({ title: 'Local', transport: 'stdio', command: '/usr/bin/tool', args: '["a b","$(literal)"]', cwd: '', url: '', token: '', env: [{ name: 'KEY', value: 'secret' }] }, 7)
  expect(result).toEqual({ baseRevision: 7, connection: { title: 'Local', transport: 'stdio', command: '/usr/bin/tool', args: ['a b', '$(literal)'] }, credential: { env: { KEY: 'secret' } } })
  expect(JSON.stringify(result.connection)).not.toContain('secret')
})
it('rejects malformed parameters, credential URLs and duplicate environment names before connecting', () => {
  const draft = { title: 'Remote', transport: 'http' as const, url: 'https://user:secret@example.com/mcp', command: '', args: '[]', cwd: '', token: '', env: [] }
  expect(() => connectionInput(draft, 0)).toThrow()
  expect(() => connectionInput({ ...draft, transport: 'stdio', command: 'tool', args: 'not JSON' }, 0)).toThrow()
  expect(() => connectionInput({ ...draft, url: 'https://example.com/mcp', env: [{ name: 'KEY', value: 'one' }, { name: 'KEY', value: 'two' }] }, 0)).toThrow()
  for (const input of ['[]', 'null', 'invalid']) expect(() => objectInput(input)).toThrow()
})
it('validates explicit dependency IDs and exact Python package versions without installing anything', () => {
  expect(toolDependencyIds('builtin:calculate, mcp-a:read\npython-b')).toEqual(['builtin:calculate', 'mcp-a:read', 'python-b'])
  expect(() => toolDependencyIds('same,same')).toThrow()
  expect(dependencyPins('numpy==2.3.1\npandas==2.3.0')).toEqual(['numpy==2.3.1', 'pandas==2.3.0'])
  expect(() => dependencyPins('numpy; curl evil')).toThrow()
  expect(() => dependencyPins('numpy>=2')).toThrow()
})
it('bounds attachment previews and refuses paths or active document types', () => {
  expect(attachmentPreview({ name: 'result.csv', mimeType: 'text/csv', data: btoa('a,b\n1,2') }).text).toBe('a,b\n1,2')
  for (const file of [{ name: '../result.txt', mimeType: 'text/plain', data: 'eA==' }, { name: 'result.html', mimeType: 'text/html', data: 'eA==' }, { name: 'result.txt', mimeType: 'text/plain', data: 'not base64?' }]) expect(() => attachmentPreview(file)).toThrow()
})
it('compares catalog identities and definition versions, independent of display labels', () => {
  expect(catalogChanges([{ id: 'a', version: '1' }, { id: 'b', version: '1' }], [{ id: 'a', version: '2' }, { id: 'c', version: '1' }])).toEqual({ added: ['c'], changed: ['a'], removed: ['b'] })
})
