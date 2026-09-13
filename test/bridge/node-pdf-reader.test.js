import { expect, it } from 'vitest'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNodePdfReader } from '../../bridge/node-pdf-reader.js'

it('distinguishes unreadable graphics from blank pages and rejects malformed or cancelled reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-pdf-failures-'))
  let result
  try {
    const stream = 'BT /F1 12 Tf 40 140 Td (Selected evidence) Tj ET'
    await writeFile(join(root, 'graphics.pdf'), samplePdf().toString().replace(stream, '10 10 50 50 re f'.padEnd(stream.length)))
    const read = createNodePdfReader({ workspaceRoot: root })
    result = await read({ path: 'graphics.pdf' })
    expect(result.pages.map(page => page.status)).toEqual(['unreadable', 'empty'])
    expect(result.warnings.some(warning => warning.code === 'PDF_UNREADABLE' && warning.page === 1)).toBe(true)
    expect(await result.render(1)).toMatch(/^data:image\/png;base64,/)
    await writeFile(join(root, 'broken.pdf'), 'not a PDF')
    await expect(read({ path: 'broken.pdf' })).rejects.toMatchObject({ code: 'MATERIAL_READ_FAILED' })
    const controller = new AbortController(); controller.abort()
    await expect(read({ path: 'graphics.pdf' }, { signal: controller.signal })).rejects.toMatchObject({ code: 'MATERIAL_READ_FAILED' })
  } finally { await result?.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20000)

it('checks the actual frozen bytes against a managed original digest before parsing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-pdf-digest-'))
  try {
    await writeFile(join(root, 'document.pdf'), samplePdf())
    await expect(createNodePdfReader({ workspaceRoot: root })({ path: 'document.pdf' }, { expectedDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'MATERIAL_CORRUPT' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
// A deliberately small generated fixture: one text page and one truly blank page.
export function samplePdf(text = 'Selected evidence') {
  const stream = `BT /F1 12 Tf 40 140 Td (${text}) Tj ET`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>']
  let data = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(data)); data += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const xref = Buffer.byteLength(data)
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(data)
}
it('extracts physical pages and renders the same frozen PDF after its file changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mira-pdf-test-'))
  let result
  try {
    await writeFile(join(root, 'document.pdf'), samplePdf())
    result = await createNodePdfReader({ workspaceRoot: root })({ path: 'document.pdf' })
    expect(result.text).toContain('Selected evidence')
    expect(result.pages.map(page => page.status)).toEqual(['text', 'empty'])
    await writeFile(join(root, 'document.pdf'), 'changed')
    expect(await result.render(1)).toMatch(/^data:image\/png;base64,/)
    expect(result.text).not.toContain('changed')
    await symlink('/etc/hosts', join(root, 'outside.pdf'))
    await expect(createNodePdfReader({ workspaceRoot: root })({ path: 'outside.pdf' })).rejects.toMatchObject({ code: 'MATERIAL_SOURCE_BLOCKED' })
  } finally { await result?.dispose(); await rm(root, { recursive: true, force: true }) }
}, 20000)
