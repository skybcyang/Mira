import type { DrawerState, PanelState } from './storeTypes'

export interface DetailSurfaceSnapshot {
  detailSurfaceRevision: number
  drawer: DrawerState
  panel: PanelState
}

export function detailSurfaceSnapshot(
  detailSurfaceRevision: number,
  drawer: DrawerState,
  panel: PanelState,
): DetailSurfaceSnapshot {
  return { detailSurfaceRevision, drawer, panel }
}

function sameDrawer(left: DrawerState, right: DrawerState): boolean {
  if (left === right) return true
  if (!left || !right || left.tab !== right.tab) return false
  if (left.tab === 'content') {
    return right.tab === 'content' && left.cardId === right.cardId && left.mode === right.mode
  }
  if (left.tab === 'versions') {
    return right.tab === 'versions' && left.cardId === right.cardId
  }
  if (left.tab === 'relation') {
    return right.tab === 'relation' && left.transformationId === right.transformationId
      && left.edit === right.edit && left.preview === right.preview
  }
  return right.tab === 'run' && left.runId === right.runId
}

function sameDetailSurface(left: DetailSurfaceSnapshot, right: DetailSurfaceSnapshot): boolean {
  return left.panel === right.panel && sameDrawer(left.drawer, right.drawer)
}

export function transitionDetailSurface(
  current: DetailSurfaceSnapshot,
  drawer: DrawerState,
  panel: PanelState,
): DetailSurfaceSnapshot {
  if (sameDrawer(current.drawer, drawer) && current.panel === panel) {
    // Repeated explicit commands must reach the existing editor after it changed local mode.
    return drawer?.tab === 'content' ? { ...current, drawer } : current
  }
  return {
    detailSurfaceRevision: current.detailSurfaceRevision + 1,
    drawer,
    panel,
  }
}

export function resolveAsyncDetailSurface(
  started: DetailSurfaceSnapshot,
  current: DetailSurfaceSnapshot,
  requestedDrawer: DrawerState,
  mode: 'from-idle' | 'replace-origin' = 'from-idle',
): DetailSurfaceSnapshot {
  if (
    started.detailSurfaceRevision !== current.detailSurfaceRevision
    || !sameDetailSurface(started, current)
  ) return current
  if (mode === 'from-idle' && (started.drawer || started.panel)) return current
  return transitionDetailSurface(current, requestedDrawer, null)
}

export function userFacingStoreError(error: unknown): string {
  const code = (error as { code?: string })?.code
  if (code === 'SOURCE_VERSION_CHANGED') return '来源已变化，请重新绑定最新内容后重试。'
  if (code === 'CARD_VERSION_CONFLICT') return '这张卡刚刚有了新版本，请比较后重新提交。'
  if (code === 'CARD_NAME_CONFLICT') return '卡片名称已被修改，草稿已保留。请核对最新名称后再保存。'
  if (code === 'TARGET_BUSY') return '这个成果正在生成中。'
  if (code === 'CANDIDATE_PENDING') return '先采用或丢弃待比较结果，再修改、删除或重新生成。'
  if (code === 'TRANSFORMATION_CONFLICT') return '转化已在其他窗口更新，请刷新后重试'
  if (code === 'MODEL_UNAVAILABLE' || code === 'DSH_UNAVAILABLE') {
    return '生成服务暂时不可用，画板内容已安全保存。'
  }
  if (code === 'SOURCE_READ_FAILED') return '来源还没有可用内容，请先完成编辑。'
  if (code === 'CARD_IN_USE') return '所选卡片中有卡片属于已有转化，请先删除相关转化。'
  if (code === 'CARD_RESTORE_CONFLICT') return '这次撤销记录已失效，已从历史中移除。'
  if (code === 'ORGANIZATION_CONFLICT') return '分组、颜色或位置已变化，请检查最新画布后重试。'
  if (code === 'ORGANIZATION_INVALID') return '无法保存整理：请检查名称、颜色及成员数量（每组最多 100 张）。'
  if (code === 'BOARD_PURGE_INVALID') return '永久删除只适用于废纸篓中的画板，并需要再次确认。'
  if (code === 'BOARD_PURGE_FAILED' || code === 'BOARD_PURGE_ROLLBACK_FAILED') {
    return '永久删除未完成，画板内容保持不变。'
  }
  if (code === 'WORKFLOW_STEP_UNVERIFIED') return '请先完成每一步成果，再保存为方法。'
  if (code === 'WORKFLOW_PLAN_INCOMPLETE') return '请先完成整个计划，再保存为方法。'
  if (code === 'WORKFLOW_INPUT_INVALID') return '方法需要的内容定义不完整，请检查名称和来源。'
  if (code === 'WORKFLOW_BINDING_INVALID') return '请先完成所有必填输入，并检查单张或多张限制。'
  if (code === 'TRANSFORMATION_SOURCE_INVALID') return '来源不能重复、包含目标卡或形成依赖环，请重新选择。'
  const message = (error as { message?: unknown })?.message
  if (typeof message === 'string' && message.trim()) return message
  return error instanceof Error ? error.message : '操作未完成，已有内容保持不变。'
}

export function isPermanentCanvasHistoryError(error: unknown): boolean {
  return ['CARD_RESTORE_CONFLICT', 'ORGANIZATION_CONFLICT'].includes((error as { code?: string })?.code || '')
}

export function isTransientRunLoadError(error: unknown): boolean {
  const status = (error as { status?: number })?.status
  return status === undefined || status >= 500
}

export function isMissingRunError(error: unknown): boolean {
  return (error as { status?: number })?.status === 404
}

export function missingRunMessage(runIds: string[]): string {
  return `运行记录缺失：${runIds.join('、')}。画板内容仍可继续查看。`
}
