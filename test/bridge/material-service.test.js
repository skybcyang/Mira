import { expect, it, vi } from 'vitest'
import { createMaterialService } from '../../bridge/material-service.js'

const data = () => ({ text: '第一段\n第二段😀', title: '材料', url: 'https://example.com/article', sourceDigest: 'a'.repeat(64), reader: { id: 'test', version: '1' }, warnings: [], byteLength: 20 })
it('does not attach a changed PDF original to an earlier reading snapshot', async () => {
  const createCard = vi.fn()
  const service = createMaterialService({ readers: { pdf: async () => ({ ...data(), pages: [{ page: 1, start: 0, end: 10, status: 'text' }] }) }, createCard,
    managedMaterials: { importFile: async () => ({ path: 'changed.pdf', asset: { sha256: 'b'.repeat(64) } }) } })
  try {
    const { preview } = await service.preview({ kind: 'pdf', path: 'source.pdf' })
    await expect(service.saveCard('board', { previewId: preview.previewId, spans: [{ start: 0, end: 3 }] })).rejects.toMatchObject({ code: 'MATERIAL_PREVIEW_CONFLICT' })
    expect(createCard).not.toHaveBeenCalled()
  } finally { service.close() }
})
it('retains a web original only on explicit save, once, and attaches its path to copied excerpts', async () => {
  const path = `materials/${'a'.repeat(64)}/original.txt`
  const materials = { importText: vi.fn(async () => ({ path })) }
  const service = createMaterialService({ readers: { web: async () => data() }, managedMaterials: materials, createCard: async (_id, value) => value })
  try {
    const { preview } = await service.preview({ kind: 'web', url: 'https://example.com/article' })
    expect(materials.importText).not.toHaveBeenCalled()
    await service.saveOriginal(preview.previewId)
    const result = await service.saveCard('board', { previewId: preview.previewId, spans: [{ start: 0, end: 3 }] })
    expect(materials.importText).toHaveBeenCalledTimes(1)
    expect(materials.importText.mock.calls[0][0]).toBe(data().text)
    expect(result.materialOrigin.assetPath).toBe(path)
  } finally { service.close() }
})
it('bounds concurrent previews and disposes released or over-budget adapter results', async () => {
  let serial = 0
  const dispose = vi.fn()
  const service = createMaterialService({ readers: { web: async () => ({ ...data(), dispose }) }, newId: () => String(++serial) })
  try {
    const previews = await Promise.all(Array.from({ length: 5 }, () => service.preview({ kind: 'web', url: 'https://example.com' })))
    await expect(service.preview({ kind: 'web', url: 'https://example.com' })).rejects.toMatchObject({ code: 'MATERIAL_LIMIT' })
    service.release(previews[0].preview.previewId)
    expect(dispose).toHaveBeenCalledOnce()
    await service.preview({ kind: 'web', url: 'https://example.com' })
  } finally { service.close() }
  expect(dispose).toHaveBeenCalledTimes(6)
  const excessive = createMaterialService({ readers: { web: async () => ({ ...data(), dispose, byteLength: 70 * 1024 * 1024 }) } })
  try { await expect(excessive.preview({ kind: 'web', url: 'https://example.com' })).rejects.toMatchObject({ code: 'MATERIAL_LIMIT' }) }
  finally { excessive.close() }
})
it('freezes previews, saves only selected text once, rejects changed consumption and expires', async () => {
  let time = 1000
  const createCard = vi.fn(async (_id, input) => ({ card: { id: 'new', ...input } }))
  const read = vi.fn(async () => data())
  const service = createMaterialService({ readers: { web: read }, createCard, now: () => time, newId: () => 'preview-1' })
  const { preview } = await service.preview({ kind: 'web', url: 'https://example.com/article' })
  expect(createCard).not.toHaveBeenCalled()
  const body = { previewId: preview.previewId, spans: [{ start: 4, end: 9 }] }
  const saved = await service.saveCard('board', body)
  expect(saved.card.markdown).toContain('第二段😀')
  expect(saved.card.markdown).not.toContain('第一段')
  expect(saved.card.materialOrigin.locators).toEqual(body.spans)
  expect(await service.saveCard('board', body)).toEqual(saved)
  expect(createCard).toHaveBeenCalledTimes(1)
  await expect(service.saveCard('other', body)).rejects.toMatchObject({ code: 'MATERIAL_PREVIEW_CONFLICT' })
  time += 600001
  await expect(service.saveCard('board', body)).rejects.toMatchObject({ code: 'MATERIAL_PREVIEW_EXPIRED' })
  expect(read).toHaveBeenCalledTimes(1)
})
it('keeps capture separate from boards and does not retry uncertain writes', async () => {
  const capture = vi.fn(async input => ({ entry: input }))
  const service = createMaterialService({ readers: { web: async () => data() }, capture, newId: () => 'p' })
  await service.preview({ kind: 'web', url: 'https://example.com/article' })
  await expect(service.saveCapture({ previewId: 'p', spans: [{ start: 0, end: 3 }], boardId: 'injected' })).rejects.toMatchObject({ code: 'MATERIAL_INVALID' })
  const saved = await service.saveCapture({ previewId: 'p', spans: [{ start: 0, end: 3 }], note: '个人看法', tags: [] })
  expect(saved.entry.markdown).toContain('> 第一段')
  expect(saved.entry.markdown).toContain('## 我的备注\n\n个人看法')
  const failed = createMaterialService({ readers: { web: async () => data() }, createCard: async () => { throw Error('lost response') }, newId: () => 'q' })
  await failed.preview({ kind: 'web', url: 'https://example.com/article' })
  const body = { previewId: 'q', spans: [{ start: 0, end: 3 }] }
  await expect(failed.saveCard('b', body)).rejects.toThrow('lost response')
  await expect(failed.saveCard('b', body)).rejects.toMatchObject({ code: 'MATERIAL_PREVIEW_CONFLICT' })
})
