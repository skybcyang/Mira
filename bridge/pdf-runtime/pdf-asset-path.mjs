export function pdfAssetBasePath(root, directory) {
  return `${root.replaceAll('\\', '/').replace(/\/+$/, '')}/${directory}/`
}
