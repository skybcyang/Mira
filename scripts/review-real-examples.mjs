// Editorial pass for the checked-in 2026-09-10 generation; never rewrites Run output.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { posix } from 'node:path'
import { validateBoardArtifact } from '../bridge/domain/board-artifact.js'
import { validateWorkspaceBackup } from '../bridge/domain/workspace-backup.js'

const origin = process.argv[2]
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin || ''), 'Pass the isolated authoring Host URL')
const evidence = JSON.parse(await readFile(new URL('../docs/validation/evidence/2026-09-10-kimi-example-receipts.json', import.meta.url)))
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + '/graphmind/api/v2' + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  assert(response.ok, JSON.stringify({ path, code: data.code }))
  return data
}
const edits = {
  '提出本轮可交付范围': [
    ['测试仅依赖 `test/fixtures/coffee-layout.json` 最小几何数据', '其中 53 卡布局回归测试改用 `test/fixtures/coffee-layout.json` 最小几何数据，不能外推为全部测试的唯一依赖'],
    ['**尚缺前提**：', '**需在待发布快照复核的条件**（不表示历史报告未完成这些项目）：'],
    ['`docs/licenses/` 清单与随包许可证原文更新；', 'S2 已记录 673 条依赖许可记录及原文；待发布快照变化时核对 `docs/licenses/` 是否仍匹配；'],
  ],
  '生成可验收的后续清单': [
    ['两条互不解耦的轨道', '两条分别验收的轨道'],
    ['清空 pnpm 缓存后冻结安装成功，且 1,525 项测试（139 文件）通过', '在新容器或独立临时 pnpm store 中冻结安装成功，并运行当前基线全部测试（历史报告为 139 文件、1,525 项）'],
    ['无缓存环境（新容器或清缓存本机）', '无缓存的隔离环境；保留开发者现有缓存'],
    ['以上任务全部来自两份验证报告与开源操作文档中明示的"尚缺前提"，未新增来源外假设。', '上述清单是基于来源提出的候选验收设计，部分历史通过项需要在新快照复验；具体停止门槛、平台范围和分发方案属于建议，须由维护者确认，不能当成原文规则。'],
    ['任一安全服务未开启即不公开仓库', '核对平台权限与可用性；无法开启时记录限制和替代措施，由维护者决定是否暂停公开'],
  ],
}
const notes = {
  software: '案例编辑复核：本页为分析建议。报告时点、当前待发布快照与真正发布动作需分别核对；CI smoke 不等于 Windows/Intel 真机交互验收。原模型正文保存在历史版本与 Run 中。',
  reading: '案例编辑复核：文中的“只谈产量”“未论证”等限定仅针对提供的片段，不能外推到整章或斯密全部著作。“共和国公民”等背景未由这三段原文证明；教育的补救定位是解释性重建，不是原文已经证明效果充分。卡片 ID 是原运行的引用标记，导入后请按 R1/R2/R3 与卡片标题回查。',
  research: '案例编辑复核：固定 HTTP server 任务不等于参与者是新手。来源摘要没有提供长期维护指标，不应据此断言论文完全没有测量代码质量。自然对照与随机提供工具都不会自动消除选择偏差；试点的样本数、分层预期与计时规则是待评审设计，未执行、未估计因果效果。',
  writing: '案例编辑复核：限定为 2026-09-09/10 的文档时点；当前稿尚未发布。原模型提纲和待比较结果含来源外的 MIT 法律推断，不能采用为法律结论。事实核查中“去掉引号”不能弥补缺少来源，应删除该主张或补充并重新核查原文。方法复用时也须逐项人工复核。',
}
for (const item of evidence.boards) {
  const { board } = await request('/boards/' + item.boardId)
  for (const [i, card] of board.cards.entries()) {
    if (card.id === item.steps[2].cardId || card.name === '问题与边界') {
      await request(`/boards/${board.id}/cards/${card.id}`, { x: 1480 }, 'PATCH')
    }
    if (card.x === 0) await request(`/boards/${board.id}/cards/${card.id}`, { y: i * 250, height: 220 }, 'PATCH')
    if (item.key === 'reading' && card.inspirationRef) {
      await request(`/boards/${board.id}/cards/${card.id}`, { x: 0, y: 780, width: 370, height: 250 }, 'PATCH')
    }
    const sourceHead = card.versions.find(version => version.id === card.headVersionId)
    const sourcePath = sourceHead.content.markdown.match(/来源：Mira 仓库 (docs\/[^，]+)，/)?.[1]
    if (sourcePath && /\]\(\.\.?\//.test(sourceHead.content.markdown)) {
      const markdown = sourceHead.content.markdown
        .replace(/\[([^\]]+)\]\((\.\.?\/[^)]+)\)/g, (_, label, href) =>
          label + '（仓库路径：' + posix.normalize(posix.join(posix.dirname(sourcePath), href)) + '）')
        .replace('以下是该文档的原始内容；', '以下保留文档内容，将相对链接展开为仓库路径供源码内查阅；原始文本见初始版本。')
      await request(`/boards/${board.id}/cards/${card.id}/versions`, { baseVersionId: card.headVersionId, markdown })
    }
    if (!item.steps.some(step => step.cardId === card.id)) continue
    const current = card.versions.find(version => version.id === card.headVersionId).content.markdown
    if (current.includes(notes[item.key])) continue
    let markdown = current
    for (const [before, after] of edits[card.name] || []) {
      assert(markdown.includes(before), 'Editorial target changed: ' + card.name)
      markdown = markdown.replaceAll(before, after)
    }
    if (item.key === 'research') markdown = markdown
      .replaceAll('固定新手任务', '固定编程任务').replaceAll('固定的新手型练习', '固定编程练习')
      .replaceAll('新手固定任务', '固定任务')
      .replaceAll('长期维护成本（代码质量、返工）在 E1、E2 中均未测量', '所给摘要不足以判断 E1、E2 对长期维护成本、代码质量和返工的完整测量范围')
      .replaceAll('长期维护成本（代码质量、可维护性、返工）在 E1、E2 中均未测量，E3 也未解决', '所给摘要未提供可比较的长期维护成本、代码质量和返工指标')
      .replaceAll('长期维护成本的效果在所有材料中均未测量', '所给摘要不足以评估长期维护成本效果')
    if (item.key === 'writing' && card.name !== '逐项核查事实与主张') markdown = markdown
      .replaceAll('首个公开 push 不生成可下载产物', '首个公开 push 不生成可公开下载的内部安装包')
      .replaceAll('首次 push 不会生成任何可下载产物', '首次 push 不会生成可公开下载的内部安装包；通用源码 CI 不受此限制')
      .replaceAll('旧私仓 200 个提交', '旧私仓本地可达引用中 200 个含可扫描差异的提交')
      .replaceAll('三份 artifact 存在且可下载', '三份 artifact 在报告时点存在且可下载（记录保留期为 14 天）')
      .replace(/法律上的反方意见也成立：[\s\S]*?这条验证。/, '一种反方意见是：提供源码已经完成了交付。本文回应的只是可用性实践：当 README 引导读者导入数据与配置模型时，维护者应如实说明本地数据和外部模型调用边界；不据此推断法律义务。')
      .replace(/反方：MIT 许可证本身[\s\S]*?不主张其构成法律义务。/, '反方：提供源码是否就已经完成交付？回应：本文只讨论可用性实践，要求对 README 引导的操作与数据边界提供可核对的说明；给定材料不足以论证法律义务，删去相关推断。')
    if (item.key === 'reading') markdown = markdown.replaceAll('R1以"可完成的劳动量"为唯一尺度', 'R1所选片段以"可完成的劳动量"为评价尺度')
    markdown = markdown.replace(/\n\n## 案例编辑(?:复核|保留意见)[\s\S]*$/, '')
    await request(`/boards/${board.id}/cards/${card.id}/versions`, {
      baseVersionId: card.headVersionId,
      markdown: markdown + '\n\n## 人工复核与继续阅读\n\n' + notes[item.key],
    })
  }
  const artifact = await request(`/boards/${board.id}/export`)
  validateBoardArtifact(artifact)
  await writeFile(new URL(`../docs/examples/${item.key}.mira-board.json`, import.meta.url), JSON.stringify(artifact, null, 2) + '\n')
}
const backup = await request('/backup')
validateWorkspaceBackup(backup)
await writeFile(new URL('../docs/examples/mira-four-scenarios.mira-backup.json', import.meta.url), JSON.stringify(backup, null, 2) + '\n')
console.log(JSON.stringify({ reviewed: evidence.boards.length, runsPreserved: backup.runs.length }))
