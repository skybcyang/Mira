import { projectApi, type OpenProjectInput } from './projectApi'
import { v2Api } from '../v2Api'
import { useV2Canvas } from '../v2Store'

function assertCanLeave() {
  const state = useV2Canvas.getState()
  if (!state.projectInfo?.canSwitch) throw new Error('当前宿主不支持切换项目。')
  if (state.loadState !== 'ready' || state.saveState === 'saving' || state.historyState === 'applying') {
    throw new Error('请等待当前加载或保存完成后再切换项目。')
  }
  return state
}

export async function executeProjectSwitch(input: OpenProjectInput) {
  const origin = assertCanLeave()
  await origin.flushBoardNavigation()
  const { activity } = await v2Api.getBoardActivity()
  if (Object.values(activity).some(counts => counts.activeRuns || counts.pendingCandidates)) {
    throw new Error('项目还有运行或待处理结果，请先打开对应画板处理。')
  }
  const current = assertCanLeave()
  if (current.projectInfo?.project.id !== origin.projectInfo?.project.id) throw new Error('项目已变化，请重试。')
  return projectApi.open(input)
}
