import type { FileBrowseEntry } from '../v2Api'

export type FilePickMode = 'reference' | 'copy'

export function pickModeForEntry(entry: FileBrowseEntry): FilePickMode {
  return /^materials\/[a-f0-9]{64}\/original\.(txt|pdf|bin)$/.test(entry.workspaceRelative || '') ? 'reference' : 'copy'
}

export function confirmLabel(mode: FilePickMode): string {
  return mode === 'copy' ? '导入到项目' : '查看已收纳材料'
}

export function selectionDetail(entry: FileBrowseEntry, mode: FilePickMode): string {
  if (mode === 'copy') {
    return `将 ${entry.name} 复制到项目材料库，原文件以后修改不会影响副本。`
  }
  return '复用已收纳的原件，不创建卡片。'
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
