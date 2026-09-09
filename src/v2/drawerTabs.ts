import type { BoardV2, TransformationRun } from '../domain'
import type { DrawerState } from './storeTypes'

export type DrawerTabId = 'content' | 'relation' | 'versions' | 'run'

export interface DrawerTabEntry {
  tab: DrawerTabId
  target: Exclude<DrawerState, null> | null
  active: boolean
}

const TAB_ORDER: DrawerTabId[] = ['content', 'relation', 'versions', 'run']

function activeTab(drawer: Exclude<DrawerState, null>): DrawerTabId {
  switch (drawer.tab) {
    case 'content': return 'content'
    case 'versions': return 'versions'
    case 'relation': return 'relation'
    case 'run': return 'run'
  }
}

/**
 * 计算详情侧栏四个页签可达的目标视图。
 * 纯映射：同一对象族内自由切换（Card 的内容/版本、转化的目标卡与最近运行、
 * 运行回到所属转化与目标卡）；对象已不存在或运行尚未载入时不提供目标。
 */
export function drawerTabTargets(
  drawer: DrawerState,
  board: BoardV2 | null,
  runs: Record<string, TransformationRun>,
): DrawerTabEntry[] {
  const targets: Partial<Record<DrawerTabId, Exclude<DrawerState, null>>> = {}
  if (drawer && board) {
    const cardExists = (cardId: string) => board.cards.some((card) => card.id === cardId)
    const cardTargets = (cardId: string) => {
      if (!cardExists(cardId)) return
      targets.content = { tab: 'content', cardId }
      targets.versions = { tab: 'versions', cardId }
    }
    const runTarget = (runId: string | undefined) => {
      if (runId && runs[runId]) targets.run = { tab: 'run', runId }
    }
    switch (drawer.tab) {
      case 'content':
      case 'versions': {
        cardTargets(drawer.cardId)
        const producer = board.transformations.find(
          (item) => item.targetCardId === drawer.cardId,
        )
        if (producer) {
          targets.relation = { tab: 'relation', transformationId: producer.id }
          runTarget(producer.lastRunId)
        }
        break
      }
      case 'relation': {
        const transformation = board.transformations.find((item) => item.id === drawer.transformationId)
        if (transformation) {
          targets.relation = drawer
          cardTargets(transformation.targetCardId)
          runTarget(transformation.lastRunId)
        }
        break
      }
      case 'run': {
        const run = runs[drawer.runId]
        if (run) {
          targets.run = drawer
          if (board.transformations.some((item) => item.id === run.transformationId)) {
            targets.relation = { tab: 'relation', transformationId: run.transformationId }
          }
          cardTargets(run.targetCardId)
        }
        break
      }
    }
  }
  const active = drawer ? activeTab(drawer) : null
  return TAB_ORDER.map((tab) => ({
    tab,
    target: targets[tab] ?? null,
    active: tab === active,
  }))
}
