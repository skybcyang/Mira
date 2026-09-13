export async function verifyPackedMaterialReader(application) {
  const imported = await application.dispatch('POST', ['v2', 'files', 'import'], { path: 'packed-reader-smoke.pdf' })
  if (!imported.body.path.startsWith('materials/')) throw new Error('Packed PDF was not copied into managed materials')
  const { preview } = await application.materialService.preview({ kind: 'pdf', path: imported.body.path })
  try {
    if (!preview.text.includes('Selected evidence') || preview.pages?.[0]?.status !== 'text' || preview.pages?.[1]?.status !== 'empty') throw new Error('Packed PDF text/page verification failed')
    const { image } = await application.materialService.page(preview.previewId, 1)
    if (!image?.startsWith('data:image/png;base64,')) throw new Error('Packed PDF page rendering failed')
    const backup = await application.backupService.exportBackup()
    if (backup.formatVersion !== 4 || !backup.executionSettings || backup.assets.length !== 1) throw new Error('Packed backup did not include project settings and the PDF original')
  } finally { application.materialService.release(preview.previewId) }
}
