import type { FileBrowseEntry } from '../v2Api'

export type FilePickMode = 'reference' | 'copy'

export function pickModeForEntry(entry: FileBrowseEntry): FilePickMode {
  return entry.workspaceRelative === null ? 'copy' : 'reference'
}

export function confirmLabel(mode: FilePickMode): string {
  return mode === 'copy' ? '拷贝到工作区并添加' : '添加材料'
}

export function selectionDetail(entry: FileBrowseEntry, mode: FilePickMode): string {
  if (mode === 'copy') {
    return `文件不在工作区，添加时会先拷贝备份到 attachments/${entry.name}`
  }
  return `将引用工作区文件 ${entry.workspaceRelative ?? entry.path}`
}

export function locationLabel(result: {
  path?: string
  workspaceRelative?: string | null
}): string {
  if (result.workspaceRelative === '') return '工作区'
  if (typeof result.workspaceRelative === 'string') {
    return `工作区 / ${result.workspaceRelative}`
  }
  return result.path || ''
}

export function browseErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'NOT_FOUND' || code === 'FILES_UNAVAILABLE') {
    return '当前运行的 Mira 服务还没有文件浏览能力，请更新并重启服务后重试'
  }
  return error instanceof Error ? error.message : '目录读取失败'
}
