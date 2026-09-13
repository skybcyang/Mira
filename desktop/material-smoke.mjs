export async function verifyPackedMaterialReader(application) {
  const { preview } = await application.materialService.preview({ kind: 'pdf', path: 'packed-reader-smoke.pdf' })
  try {
    if (!preview.text.includes('Selected evidence') || preview.pages?.[0]?.status !== 'text' || preview.pages?.[1]?.status !== 'empty') throw new Error('Packed PDF text/page verification failed')
    const { image } = await application.materialService.page(preview.previewId, 1)
    if (!image?.startsWith('data:image/png;base64,')) throw new Error('Packed PDF page rendering failed')
  } finally { application.materialService.release(preview.previewId) }
}
