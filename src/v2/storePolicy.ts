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
    return right.tab === 'content' && left.cardId === right.cardId && left.mode === right.mode && left.batchId === right.batchId
  }
  if (left.tab === 'versions') {
    return right.tab === 'versions' && left.cardId === right.cardId
  }
  if (left.tab === 'relation') {
    return right.tab === 'relation' && left.transformationId === right.transformationId
      && left.edit === right.edit && left.preview === right.preview
      && left.scopeCardId === right.scopeCardId
      && left.guidance === right.guidance
      && left.output === right.output
      && left.tools === right.tools
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
  if (code === 'TOOL_POLICY_INVALID') return '工具配置不完整，请核对调用方式、参数和范围。'
  if (code === 'TOOL_UNAVAILABLE') return '工具当前不可用，请在能力管理中核对启用状态。'
  if (code === 'TOOL_CHANGED') return '工具或连接已变化，请重新选择并核对参数。'
  if (code === 'TOOL_DEPENDENCY_MISSING') return '指导缺少必需工具，请先补齐本步工具。'
  if (code === 'MODEL_TOOLS_UNAVAILABLE') return '当前模型通道不支持按需工具，请更换通道或调整调用方式。'
  if (code === 'CAPABILITY_CONFLICT') return '能力设置已在别处修改，草稿已保留。请重新读取并核对。'
  if (code === 'REVIEW_CONFLICT' || code === 'REVIEW_EXPIRED') return '这次审阅已处理或过期，请重新核对运行记录。'
  if (code === 'MCP_AUTH_REQUIRED') return '连接需要凭据，请在能力管理中重新填写并测试。'
  if (code === 'MCP_UNAVAILABLE' || code === 'MCP_INCOMPATIBLE') return 'MCP 连接不可用或不兼容，请重新测试连接。'
  if (code === 'PYTHON_UNAVAILABLE') return 'Python 隔离环境不可用，请在能力管理中核对环境。'
  if (code === 'TOOL_TIMEOUT') return '工具执行超时，已停止等待。请核对运行记录与外部结果。'
  if (code === 'TOOL_LIMIT') return '工具达到次数、时间或大小上限，请缩小任务后再明确运行。'
  if (code === 'TOOL_OUTCOME_UNKNOWN') return '外部操作结果未确认，请先核对目的地，不要重复执行。'
  if (code === 'TOOL_FAILED') return '工具未能完成，请核对本次参数和运行诊断。'
  if (code === 'MODEL_RESPONSE_LIMIT') return '模型响应超过大小上限，请缩小任务后重试。'
  if (code === 'MODEL_TIMEOUT') return '模型请求超时，请核对服务状态后再运行。'
  if (code === 'SOURCE_VERSION_CHANGED') return '来源已变化，请重新绑定最新内容后重试。'
  if (code === 'SOURCE_SCOPE_REQUIRED') return '请先选择输入范围，或明确改用全文。'
  if (code === 'SOURCE_SCOPE_CHANGED') return '原文或范围已变化，请重新读取原文并选择范围。'
  if (code === 'SOURCE_SCOPE_INVALID') return '无法使用这个范围，请重新选择不重叠的文字片段。'
  if (code === 'GUIDANCE_INVALID') return '指导或完成标准不完整，请核对后再保存。'
  if (code === 'OUTPUT_POLICY_INVALID') return '输出要求不完整或与提取格式冲突，请核对后再保存。'
  if (code === 'OUTPUT_POLICY_UNAVAILABLE') return '所选输出规则版本不可用，已保存规则保持不变，请重新核对。'
  if (code === 'MATERIAL_PREVIEW_EXPIRED') return '阅读预览已过期，请重新读取并核对。'
  if (code === 'MATERIAL_PREVIEW_CONFLICT') return '这份预览已保存或结果待核对，请检查目的地。'
  if (code === 'MATERIAL_INVALID') return '材料或所选范围无效，请重新核对选择。'
  if (code === 'MATERIAL_CORRUPT') return '项目材料缺失或已被修改。请从可信备份恢复原件。'
  if (code === 'MATERIAL_SOURCE_BLOCKED') return '地址或文件路径不可读取，请使用公开网页或工作区内 PDF。'
  if (code === 'MATERIAL_READ_FAILED') return '材料读取失败，请核对地址、文件和读取限制。'
  if (code === 'MATERIAL_LIMIT') return '材料或打开的预览超过上限，请减少后再试。'
  if (code === 'MATERIAL_UNAVAILABLE') return '当前宿主不支持这种材料读取。'
  if (code === 'GUIDANCE_UNAVAILABLE') return '这个内置指导版本不可用，请重新查看可用版本。'
  if (code === 'EXTRACTION_REVISION_INVALID') return '旧卡与清单对应无效，请核对条目和拟采用的正文。'
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
