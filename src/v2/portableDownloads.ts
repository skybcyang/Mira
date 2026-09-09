const RESERVED_FILENAME = /[\u0000-\u001f\u007f<>:"：/\\|?*]+/g

function compactSafeTitle(title: string): string {
  return title
    .normalize('NFC')
    .trim()
    .replace(RESERVED_FILENAME, '-')
    .replace(/\s*[-]+\s*/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
}

export function boardArtifactFileName(title: string): string {
  return `${compactSafeTitle(title) || 'mira-board'}.mira-board.json`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

export function backupFileName(at = new Date()): string {
  const stamp = [
    at.getFullYear(),
    twoDigits(at.getMonth() + 1),
    twoDigits(at.getDate()),
    '-',
    twoDigits(at.getHours()),
    twoDigits(at.getMinutes()),
  ].join('')
  return `mira-${stamp}.mira-backup.json`
}

export function downloadJson(value: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

export const portableDownloads = {
  downloadJson,
}
