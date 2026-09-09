import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateBoardV2 } from '../bridge/domain/validation.js'
import { validateWorkflow } from '../bridge/workflow-store.js'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outputRoot = resolve(process.argv[2] || '.mira-showcase-staging')

try {
  await access(outputRoot)
  throw new Error('Refusing to overwrite existing output directory: ' + outputRoot)
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

function md(...lines) {
  return lines.join('\n')
}

const materials = {
  'showcase-materials/knowledge/agent-course.md': md(
    '# Agent 工程课程讲义',
    '',
    '- 工具调用必须有明确输入、成功条件与失败回退。',
    '- 长任务应保存中间状态，不能依赖单次上下文。',
    '- 重试前要区分暂时性失败与确定性错误。',
    '- 人工修改是新的事实，不应被后台结果静默覆盖。',
  ),
  'showcase-materials/knowledge/reading-notes.md': md(
    '# 阅读笔记',
    '',
    '- Context engineering 的核心是选择相关事实，不是无限塞入材料。',
    '- 结构化输出适合稳定接口，自由文本适合探索阶段。',
    '- 可观测性至少包含输入版本、执行阶段、结果与错误。',
  ),
  'showcase-materials/knowledge/debug-log.md': md(
    '# 调试记录',
    '',
    '2026-08-12：工具超时后无条件重试，产生了重复写入。',
    '2026-08-16：来源笔记更新，但旧答案没有提示过期。',
    '2026-08-20：人工改稿期间后台结果返回，差异需要人工判断。',
  ),
  'showcase-materials/software/cache-failure.log': md(
    'request=218 key=user:42 cache=miss origin_call=1',
    'request=219 key=user:42 cache=miss origin_call=2',
    'request=220 key=user:42 cache=miss origin_call=3',
    'expected_origin_calls=1 actual_origin_calls=3',
  ),
  'showcase-materials/software/cache.ts': md(
    'export async function cached(key, load) {',
    '  const hit = memory.get(key)',
    '  if (hit) return hit',
    '  const value = await load()',
    '  memory.set(key, value)',
    '  return value',
    '}',
  ),
  'showcase-materials/software/cache.test.ts': md(
    'it("deduplicates concurrent misses", async () => {',
    '  const values = await Promise.all([',
    '    cached("user:42", load),',
    '    cached("user:42", load),',
    '    cached("user:42", load),',
    '  ])',
    '  expect(load).toHaveBeenCalledTimes(1)',
    '  expect(values).toEqual(["Ada", "Ada", "Ada"])',
    '})',
  ),
  'showcase-materials/travel/flights.txt': md(
    '去程：9 月 14 日 13:20 抵达羽田机场',
    '返程：9 月 21 日 16:40 从羽田机场起飞',
    '托运行李：一件；返程需提前两小时到机场。',
  ),
  'showcase-materials/travel/hotel.txt': md(
    '住宿：上野站步行 8 分钟',
    '入住：9 月 14 日 15:00 后',
    '退房：9 月 21 日 11:00 前',
    '连续住宿七晚，不更换酒店。',
  ),
  'showcase-materials/travel/saved-places.csv': md(
    'place,area,priority,closed',
    '国立西洋美术馆,上野,A,Monday',
    '清澄白河咖啡店,清澄白河,A,Tuesday',
    '江户东京建筑园,小金井,A,Monday',
    '代官山茑屋,代官山,B,None',
    '根津美术馆,青山,B,Monday',
  ),
  'showcase-materials/product/interviews.md': md(
    '# 四次记账产品访谈',
    '',
    '- 用户 A：月底才补记，最怕对不上银行卡。',
    '- 用户 B：分类太多，十秒内找不到就放弃。',
    '- 用户 C：愿意每天记，但不愿维护预算规则。',
    '- 用户 D：真正需要的是发现异常支出，而不是更多图表。',
  ),
  'showcase-materials/product/funnel.csv': md(
    'step,users,conversion',
    'created_account,1000,1.00',
    'linked_account,620,0.62',
    'completed_first_review,310,0.31',
    'returned_week_two,124,0.124',
  ),
  'showcase-materials/competition/rival-a.md': md(
    '# Rival A 本地快照',
    '',
    '- 目标：大型平台团队。',
    '- 定价：每席位每月 49 美元。',
    '- 强项：权限和审计。',
    '- 评论弱点：首次配置复杂。',
  ),
  'showcase-materials/competition/rival-b.md': md(
    '# Rival B 本地快照',
    '',
    '- 目标：独立开发者。',
    '- 定价：免费层 + 用量计费。',
    '- 强项：五分钟接入。',
    '- 评论弱点：历史追踪有限。',
  ),
  'showcase-materials/competition/rival-c.md': md(
    '# Rival C 本地快照',
    '',
    '- 目标：安全敏感团队。',
    '- 定价：仅销售询价。',
    '- 强项：本地部署。',
    '- 评论弱点：升级和维护成本高。',
  ),
  'showcase-materials/competition/reviews.csv': md(
    'product,theme,sentiment,count',
    'Rival A,setup,negative,38',
    'Rival A,audit,positive,41',
    'Rival B,onboarding,positive,52',
    'Rival B,history,negative,29',
    'Rival C,privacy,positive,34',
    'Rival C,maintenance,negative,31',
  ),
  'showcase-materials/career/master-resume.md': md(
    '# 林然｜产品设计师',
    '',
    '- 5 年视觉与品牌设计经验。',
    '- 主导设计系统改版，组件复用率从 42% 提升至 76%。',
    '- 参与 12 次用户访谈，但旧简历没有说明个人判断。',
  ),
  'showcase-materials/career/job-description.md': md(
    '# 目标职位：产品设计师',
    '',
    '- 独立完成问题定义、交互方案和验证。',
    '- 能用研究与数据解释设计取舍。',
    '- 有复杂 B2B 产品或设计系统经验。',
  ),
  'showcase-materials/career/portfolio-notes.md': md(
    '# 作品集素材',
    '',
    '- 设计系统：统一 47 个重复组件。',
    '- 审批流程：任务完成时间下降 23%。',
    '- 研究：访谈发现新手不理解批量操作的影响范围。',
  ),
  'showcase-materials/home/pantry.csv': md(
    'ingredient,amount,expires_in_days',
    '西兰花,2颗,2',
    '豆腐,600克,3',
    '番茄,6个,4',
    '鹰嘴豆,2罐,180',
    '意面,500克,300',
  ),
  'showcase-materials/home/calendar.ics': md(
    'MON: 19:00 到家',
    'TUE: 20:30 到家',
    'WED: 只有 20 分钟做饭',
    'THU: 19:30 到家',
    'FRI: 两人一起做饭',
  ),
  'showcase-materials/home/recipes.md': md(
    '# 常用菜谱',
    '',
    '- 番茄豆腐煲：30 分钟。',
    '- 鹰嘴豆意面：25 分钟。',
    '- 西兰花炒饭：20 分钟。',
    '- 花生酱拌面：15 分钟，但含花生。',
  ),
  'showcase-materials/podcast/interview-transcript.md': md(
    '# 老电影院访谈转录',
    '',
    '馆长：最难的不是修建筑，而是让附近居民重新走进来。',
    '放映员：胶片机每周只开一次，但年轻观众会提前两小时排队。',
    '居民：小时候这里是约会地点，关闭后街区晚上安静了很多。',
  ),
  'showcase-materials/podcast/research.md': md(
    '# 背景资料',
    '',
    '- 影院建于 1936 年，2018 年停止商业放映。',
    '- 社区修复计划由 312 位居民共同筹资。',
    '- 2026 年恢复每周一次胶片放映。',
  ),
  'showcase-materials/study/exam-outline.md': md(
    '# 云架构认证考试大纲',
    '',
    '- 网络设计 22%',
    '- 身份与权限 18%',
    '- 可用性与恢复 25%',
    '- 成本与运维 20%',
    '- 数据服务 15%',
  ),
  'showcase-materials/study/networking.md': md(
    '# 网络章节讲义',
    '',
    '- 子网规划与路由优先级。',
    '- 私网访问、NAT 与服务端点。',
    '- 跨区域连接、故障域和流量切换。',
    '- 网络安全组与应用层策略的职责边界。',
  ),
  'showcase-materials/study/error-log.csv': md(
    'topic,wrong,total',
    'route_priority,7,10',
    'private_endpoint,5,8',
    'nat_egress,4,6',
    'security_boundary,2,9',
  ),
}

const repositoryPaths = [
  'docs/product/product-definition.md',
  'docs/design/experience-design.md',
  'src/v2Store.ts',
  'bridge/v2-http.js',
]
const repositoryTexts = Object.fromEntries(await Promise.all(repositoryPaths.map(async (path) => [
  path,
  await readFile(resolve(repositoryRoot, path), 'utf8'),
])))
const sourceTexts = { ...materials, ...repositoryTexts }
const allowedTextExtensions = new Set([
  '.csv', '.html', '.ics', '.js', '.json', '.log', '.md', '.mjs', '.patch', '.ts', '.tsx', '.txt',
])

function digestText(value) {
  let hash = 0x811c9dc5
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte
    hash = Math.imul(hash, 0x01000193)
  }
  return 'fnv1a:' + (hash >>> 0).toString(16).padStart(8, '0')
}

function digestContent(content) {
  if (content.kind === 'markdown') return digestText('markdown\0' + content.markdown)
  return digestText('file-reference\0' + content.path + '\0' + (content.readonly ? '1' : '0'))
}

function boardId(boardKey) {
  return 'board-showcase-' + boardKey
}

function cardId(boardKey, key) {
  return 'card-' + boardKey + '-' + key
}

function versionId(boardKey, key, sequence) {
  return 'version-' + boardKey + '-' + key + '-' + sequence
}

function transformationId(boardKey, key) {
  return 'transformation-' + boardKey + '-' + key
}

function runId(boardKey, key) {
  return 'run-' + boardKey + '-' + key
}

function markdownCard(boardKey, key, x, y, versions = [], size = {}) {
  const id = cardId(boardKey, key)
  const normalized = versions.map((item, index) => {
    const content = { kind: 'markdown', markdown: item.markdown }
    return {
      id: versionId(boardKey, key, index + 1),
      cardId: id,
      sequence: index + 1,
      content,
      digest: digestContent(content),
      origin: item.origin || 'human',
      ...(item.sourceRunId ? { sourceRunId: item.sourceRunId } : {}),
      ...(item.restoredFromVersionId ? { restoredFromVersionId: item.restoredFromVersionId } : {}),
      createdAt: '',
    }
  })
  return {
    id,
    contentKind: 'markdown',
    x,
    y,
    width: size.width || 350,
    height: size.height || 240,
    headVersionId: normalized.at(-1)?.id || null,
    versions: normalized,
    createdAt: '',
    updatedAt: '',
  }
}

function emptyCard(boardKey, key, x, y, size = {}) {
  return markdownCard(boardKey, key, x, y, [], size)
}

function fileCard(boardKey, key, x, y, path, size = {}) {
  if (!(path in sourceTexts)) throw new Error('Missing readable source material: ' + path)
  if (!allowedTextExtensions.has(extname(path).toLowerCase())) {
    throw new Error('Unsupported file-reference extension: ' + path)
  }
  const id = cardId(boardKey, key)
  const content = { kind: 'file-reference', path, readonly: true }
  const version = {
    id: versionId(boardKey, key, 1),
    cardId: id,
    sequence: 1,
    content,
    digest: digestContent(content),
    origin: 'human',
    createdAt: '',
  }
  return {
    id,
    contentKind: 'file-reference',
    x,
    y,
    width: size.width || 350,
    height: size.height || 210,
    headVersionId: version.id,
    versions: [version],
    createdAt: '',
    updatedAt: '',
  }
}

function journeyCard(boardKey, title, persona, steps, review, branch, workflow, finalResult, boundary) {
  return markdownCard(boardKey, 'personal-path', 40, 20, [{
    markdown: md(
      '# 个人路径｜' + title,
      '',
      '## 个人使用者',
      persona,
      '',
      '## 从空画布开始',
      ...steps.map((step, index) => String(index + 1) + '. ' + step),
      '',
      '## 人工审阅与版本',
      review,
      '',
      '## 分支与 Workflow',
      branch,
      workflow,
      '',
      '## 最终成果',
      finalResult,
      '',
      '## 当前能力边界',
      boundary,
    ),
  }], { width: 520, height: 500 })
}

function transformation(boardKey, key, sources, target, label, instruction, acceptance, extra = {}) {
  return {
    id: transformationId(boardKey, key),
    sourceCardIds: sources.map((card) => card.id),
    targetCardId: target.id,
    label,
    instruction,
    acceptance,
    permissions: { workspaceWrite: false },
    ...extra,
    createdAt: '',
    updatedAt: '',
  }
}

function head(card, requestedVersionId = card.headVersionId) {
  const version = card.versions.find((item) => item.id === requestedVersionId)
  if (!version) throw new Error('Missing version ' + requestedVersionId + ' on ' + card.id)
  return version
}

function snapshot(card, requestedVersionId = card.headVersionId) {
  const version = head(card, requestedVersionId)
  const resolvedContent = version.content.kind === 'markdown'
    ? version.content.markdown
    : sourceTexts[version.content.path]
  return {
    cardId: card.id,
    versionId: version.id,
    contentKind: card.contentKind,
    resolvedContent,
    digest: digestText(resolvedContent),
  }
}

function runBase(boardKey, key, transformationValue, sourceCards, targetCard, options = {}) {
  return {
    id: runId(boardKey, key),
    boardId: boardId(boardKey),
    transformationId: transformationValue.id,
    sourceSnapshot: sourceCards.map((card) => (
      snapshot(card, options.sourceVersionIds?.[card.id] || card.headVersionId)
    )),
    targetCardId: targetCard.id,
    targetBaseVersionId: options.targetBaseVersionId || null,
    intent: options.targetBaseVersionId ? 'update' : 'create',
    createdAt: '',
    startedAt: '',
    finishedAt: '',
  }
}

function appliedRun(boardKey, key, transformationValue, sourceCards, targetCard, options = {}) {
  const targetVersion = head(targetCard, options.targetVersionId)
  if (targetVersion.content.kind !== 'markdown') throw new Error('Run target must be markdown')
  return {
    ...runBase(boardKey, key, transformationValue, sourceCards, targetCard, options),
    status: 'succeeded',
    result: {
      output: targetVersion.content.markdown,
      digest: digestText(targetVersion.content.markdown),
      disposition: 'applied',
      appliedVersionId: targetVersion.id,
    },
  }
}

function candidateRun(boardKey, key, transformationValue, sourceCards, targetCard, output, targetBaseVersionId) {
  return {
    ...runBase(boardKey, key, transformationValue, sourceCards, targetCard, { targetBaseVersionId }),
    status: 'succeeded',
    result: {
      output,
      digest: digestText(output),
      disposition: 'candidate',
    },
  }
}

function failedRun(boardKey, key, transformationValue, sourceCards, targetCard, code, message) {
  return {
    ...runBase(boardKey, key, transformationValue, sourceCards, targetCard, {
      targetBaseVersionId: targetCard.headVersionId,
    }),
    status: 'failed',
    error: { code, message, retryable: true },
  }
}

function interruptedRun(boardKey, key, transformationValue, sourceCards, targetCard) {
  return {
    ...runBase(boardKey, key, transformationValue, sourceCards, targetCard, {
      targetBaseVersionId: targetCard.headVersionId,
    }),
    status: 'interrupted',
    error: {
      code: 'RUN_INTERRUPTED',
      message: '用户停止了本次生成，现有版本保持不变。',
      retryable: true,
    },
  }
}

function makeBoard(boardKey, title, cards, _legacyRelations, transformations) {
  return {
    schemaVersion: 2,
    id: boardId(boardKey),
    title,
    cards,
    transformations,
    viewport: { x: 0, y: 0, zoom: 0.72 },
    createdAt: '',
    updatedAt: '',
  }
}

const boards = []
const runs = []
const workflows = []

// 01: personal knowledge base with ordered synthesis and explicit branches.
{
  const key = '01-knowledge'
  const path = journeyCard(
    key,
    '把课程、笔记与踩坑记录变成个人知识库',
    '周屿，一名自学 Agent 工程的后端开发者；他需要的是随时能查的答案网络，不是一篇课程总结。',
    [
      '新建空画布，用“文件”加入课程讲义、阅读笔记和调试记录，再写一张“我现在卡在哪里”的 Markdown 来源卡。',
      '按“问题 → 讲义 → 笔记 → 实践记录”的顺序选择来源，创建第一个 Transformation“建立知识索引”；创建关系不会触发运行。',
      '点击“生成成果”显式启动 Run，得到索引 v1；逐条核对出处后人工补上遗漏，提交为同一 Card 的 v2。',
      '只选知识索引 v2 创建下一条 Transformation“形成概念地图”，审阅后再主动运行。',
      '从概念地图分别创建“概念速查”“实战配方”“故障 FAQ”三条 Transformation，形成用户明确选择的分支。',
    ],
    '每次模型结果都是普通 CardVersion。周屿先看来源与版本，再人工审阅；恢复旧版也只会追加新版本。',
    '三份下游材料是三条独立的 1→1 Transformation，不是一条自动产生多个目标的操作。',
    '这张分支画板不强行保存完整 Workflow；若以后验证出稳定的单一路径，只保存分支前的线性方法。',
    '一组可导航的概念速查、实战配方和故障 FAQ 卡片。',
    'Mira 不抓取网页，也不会自动拆成无限多张卡；知识卡与分支都由用户明确创建。',
  )
  const course = fileCard(key, 'course', 40, 570, 'showcase-materials/knowledge/agent-course.md')
  const notes = fileCard(key, 'notes', 40, 810, 'showcase-materials/knowledge/reading-notes.md')
  const debug = fileCard(key, 'debug', 40, 1050, 'showcase-materials/knowledge/debug-log.md')
  const questions = markdownCard(key, 'questions', 40, 1290, [{
    markdown: md(
      '# 我现在卡在哪里',
      '',
      '1. 工具调用失败后何时重试？',
      '2. 来源更新后如何知道旧答案过期？',
      '3. 人工改稿与后台结果冲突时如何处理？',
    ),
  }])
  const indexAppliedId = runId(key, 'index-applied')
  const index = markdownCard(key, 'index', 620, 650, [
    {
      origin: 'ai',
      sourceRunId: indexAppliedId,
      markdown: md(
        '# Agent 工程知识索引 v1',
        '',
        '- 工具调用：输入、超时、重试。',
        '- 上下文：选择事实与结构化输出。',
        '- 状态：来源版本与中间结果。',
        '- 人工控制：冲突时保留人工内容。',
      ),
    },
    {
      markdown: md(
        '# Agent 工程知识索引 v2｜人工校订',
        '',
        '## 运行安全',
        '- 重试前判断错误类型；写操作必须考虑幂等。',
        '',
        '## 来源新鲜度',
        '- 保存生成时读取的版本；来源 Head 变化后提示 stale。',
        '',
        '## 人工控制',
        '- 后台结果与人工 Head 冲突时进入 Candidate。',
        '',
        '## 待补',
        '- 长任务中断后的恢复策略。',
      ),
    },
  ], { width: 390, height: 340 })
  const mapRunId = runId(key, 'map')
  const conceptMap = markdownCard(key, 'map', 1090, 660, [{
    origin: 'ai',
    sourceRunId: mapRunId,
    markdown: md(
      '# 概念地图',
      '',
      '来源快照 → stale 判断 → 用户决定是否重跑',
      '',
      '目标基线 → 并发比较 → applied 或 Candidate',
      '',
      '错误分类 → 可重试性 → 幂等与人工回退',
      '',
      '三个主题共同服务于：不丢失人的判断。',
    ),
  }], { width: 370, height: 300 })
  const quickRunId = runId(key, 'quick')
  const quick = markdownCard(key, 'quick', 1540, 520, [{
    origin: 'ai',
    sourceRunId: quickRunId,
    markdown: md(
      '# 概念速查',
      '',
      '- Head：当前默认展示版本。',
      '- Snapshot：Run 启动时冻结的来源。',
      '- stale：最近采用结果所用来源已落后。',
      '- Candidate：不能安全覆盖当前 Head 的整份候选结果。',
    ),
  }])
  const recipeRunId = runId(key, 'recipe')
  const recipe = markdownCard(key, 'recipe', 1540, 820, [{
    origin: 'ai',
    sourceRunId: recipeRunId,
    markdown: md(
      '# 实战配方｜安全重试',
      '',
      '1. 冻结输入版本。',
      '2. 判断错误是否可重试。',
      '3. 保持目标 Card 身份不变。',
      '4. 返回时比较目标基线。',
      '5. 冲突则交给用户整份判断。',
    ),
  }])
  const faqRunId = runId(key, 'faq')
  const faq = markdownCard(key, 'faq', 1540, 1120, [{
    origin: 'ai',
    sourceRunId: faqRunId,
    markdown: md(
      '# 故障排查 FAQ',
      '',
      'Q：来源变了会自动更新吗？',
      'A：不会，只显示 stale。',
      '',
      'Q：重新生成会产生分支吗？',
      'A：不会，只追加同一目标 Card 的版本。',
    ),
  }])
  const t1 = transformation(key, 'index', [questions, course, notes, debug], index, '建立知识索引', '按问题、权威材料、个人理解和实践证据的顺序建立知识索引。', '每个主题都能回到来源，并单列未知项。', {
    lastRunId: indexAppliedId,
    lastAppliedRunId: indexAppliedId,
  })
  const t2 = transformation(key, 'map', [index], conceptMap, '形成概念地图', '把知识索引整理为概念、前置关系和常见混淆。', '关系使用文字箭头表达，结论不超出索引。', {
    lastRunId: mapRunId,
    lastAppliedRunId: mapRunId,
  })
  const t3 = transformation(key, 'quick', [conceptMap], quick, '制作概念速查', '把概念地图压缩成日常可查的定义表。', '每项不超过三行并保持术语准确。', {
    lastRunId: quickRunId,
    lastAppliedRunId: quickRunId,
  })
  const t4 = transformation(key, 'recipe', [conceptMap], recipe, '制作实战配方', '把概念地图转成可执行的安全重试步骤。', '步骤有明确顺序和判断点。', {
    lastRunId: recipeRunId,
    lastAppliedRunId: recipeRunId,
  })
  const t5 = transformation(key, 'faq', [conceptMap], faq, '制作故障 FAQ', '围绕常见误解形成问答。', '回答简短且与当前能力边界一致。', {
    lastRunId: faqRunId,
    lastAppliedRunId: faqRunId,
  })
  runs.push(
    appliedRun(key, 'index-applied', t1, [questions, course, notes, debug], index, { targetVersionId: index.versions[0].id }),
    appliedRun(key, 'map', t2, [index], conceptMap),
    appliedRun(key, 'quick', t3, [conceptMap], quick),
    appliedRun(key, 'recipe', t4, [conceptMap], recipe),
    appliedRun(key, 'faq', t5, [conceptMap], faq),
  )
  boards.push(makeBoard(
    key,
    '01 · 知识库生成：个人 Agent 工程手册',
    [path, course, notes, debug, questions, index, conceptMap, quick, recipe, faq],
    [],
    [t1, t2, t3, t4, t5],
  ))
}

// 02: software development produces reviewable Markdown artifacts only.
{
  const key = '02-software'
  const path = journeyCard(
    key,
    '从并发缓存 Issue 到可人工应用的补丁',
    '沈澈，一名独立维护 TypeScript 服务的开发者；他希望先把缺陷讲清楚，再把补丁提案带回编辑器。',
    [
      '新建空画布，写 Issue 卡，并用“文件”加入 UTF-8 日志、源码和测试文件。',
      '按“Issue → 日志 → 源码 → 测试”的顺序创建 Transformation“定义复现契约”，再显式启动 Run。',
      '人工审阅行为契约后，再依次创建“设计最小补丁”“生成 Unified Diff”“设计回归测试”“整理 PR”四个 Transformation。',
      '补丁提案已有可用版本后，一次重跑遇到 MODEL_TIMEOUT，最新 Run 保持 failed；旧版本仍在，用户可点重试。',
      '用户把 Markdown diff 复制到编辑器中人工应用，并在 Mira 外执行测试；当前 PR 卡保留“真实结果待填写”，之后可人工补成新 Version。',
    ],
    'Mira 内的模型结果只是一份可审阅提案。测试设计与真实执行结果分开记录，人工提交的结果是新 Version。',
    '若想比较替代修法，用户需明确创建另一目标卡；失败重跑不会自动产生分支。',
    '这条路径走通后可保存线性 Workflow，但模板仍只保存方法，不会修改仓库或运行测试。',
    '行为契约、Unified Diff 提案、测试设计和 PR 文案。',
    '当前执行器不写工作区、不运行命令；failed 表示技术执行失败，不代表测试断言失败。',
  )
  const issue = markdownCard(key, 'issue', 40, 570, [{
    markdown: md(
      '# Issue｜并发 miss 重复回源',
      '',
      '三个请求同时读取 user:42 时，load 被调用三次。',
      '期望：同一个 key 的并发 miss 共享一次进行中的 Promise。',
      '约束：不同 key 不得互相阻塞；失败后不得永久缓存 rejection。',
    ),
  }])
  const log = fileCard(key, 'log', 40, 840, 'showcase-materials/software/cache-failure.log')
  const source = fileCard(key, 'source', 40, 1080, 'showcase-materials/software/cache.ts')
  const tests = fileCard(key, 'tests', 40, 1320, 'showcase-materials/software/cache.test.ts')
  const behaviorRunId = runId(key, 'behavior')
  const behavior = markdownCard(key, 'behavior', 620, 650, [{
    origin: 'ai',
    sourceRunId: behaviorRunId,
    markdown: md(
      '# 可复现行为契约',
      '',
      '- Given：同一 key 尚无缓存，load 返回未决 Promise。',
      '- When：三个调用在第一个 Promise 完成前进入。',
      '- Then：load 只调用一次，三方收到同一值。',
      '- 失败路径：Promise reject 后清除 in-flight，下一次允许重试。',
      '- 隔离：不同 key 各自维护 in-flight。',
    ),
  }])
  const patchRunId = runId(key, 'patch')
  const patchPlan = markdownCard(key, 'patch', 1050, 650, [
    {
      origin: 'ai',
      sourceRunId: patchRunId,
      markdown: md(
        '# 最小补丁设计 v1',
        '',
        '增加 inFlight Map；miss 时先查 inFlight。',
        'Promise settle 后删除对应 key。',
        '不改已有命中缓存语义。',
      ),
    },
    {
      markdown: md(
        '# 最小补丁设计 v2｜人工补充',
        '',
        '1. 增加 Map<string, Promise<unknown>>。',
        '2. 先查 memory，再查 inFlight。',
        '3. load reject 与 resolve 后都在 finally 清理。',
        '4. 仅删除仍指向当前 Promise 的条目，避免旧 finally 删除新任务。',
      ),
    },
  ], { width: 380, height: 290 })
  const diffAppliedId = runId(key, 'diff-applied')
  const diff = markdownCard(key, 'diff', 1480, 630, [{
    origin: 'ai',
    sourceRunId: diffAppliedId,
    markdown: md(
      '# Unified Diff 提案',
      '',
      '    diff --git a/src/cache.ts b/src/cache.ts',
      '    +const inFlight = new Map()',
      '    +if (inFlight.has(key)) return inFlight.get(key)',
      '    +const pending = load().then(store)',
      '    +inFlight.set(key, pending)',
      '    +return pending.finally(() => {',
      '    +  if (inFlight.get(key) === pending) inFlight.delete(key)',
      '    +})',
      '',
      '这是 Markdown 提案，需在编辑器中人工校正类型并应用。',
    ),
  }], { width: 410, height: 330 })
  const testRunId = runId(key, 'test-design')
  const testDesign = markdownCard(key, 'test-design', 1950, 650, [{
    origin: 'ai',
    sourceRunId: testRunId,
    markdown: md(
      '# 回归测试设计',
      '',
      '1. 同 key 三个并发 miss：load 一次。',
      '2. 不同 key 并发：互不阻塞。',
      '3. 首次 reject：in-flight 被清理。',
      '4. reject 后再次调用：重新执行 load。',
      '5. 旧 Promise finally 不删除同 key 的新任务。',
    ),
  }])
  const prRunId = runId(key, 'pr')
  const pr = markdownCard(key, 'pr', 2380, 650, [{
    origin: 'ai',
    sourceRunId: prRunId,
    markdown: md(
      '# PR 文案',
      '',
      '## 问题',
      '同 key 并发 miss 重复回源。',
      '',
      '## 方案',
      '用 key 级 in-flight Promise 去重，并在 settle 后安全清理。',
      '',
      '## 人工验证待办',
      '- 应用 diff。',
      '- 执行并发与失败路径测试。',
      '- 填写真实命令输出。',
    ),
  }])
  const t1 = transformation(key, 'behavior', [issue, log, source, tests], behavior, '定义可复现行为', '从问题、日志、源码与测试形成可验证行为契约。', '覆盖成功、失败、并发与隔离条件。', {
    lastRunId: behaviorRunId,
    lastAppliedRunId: behaviorRunId,
  })
  const t2 = transformation(key, 'patch', [behavior], patchPlan, '设计最小补丁', '在不改变命中语义的前提下设计最小修复。', '列出数据结构、清理时机和竞态风险。', {
    lastRunId: patchRunId,
    lastAppliedRunId: patchRunId,
  })
  const failedId = runId(key, 'diff-failed')
  const t3 = transformation(key, 'diff', [patchPlan], diff, '生成 Unified Diff 提案', '把补丁设计写成可人工应用的 Markdown unified diff。', '只输出提案，不声称已经修改文件或执行测试。', {
    lastRunId: failedId,
    lastAppliedRunId: diffAppliedId,
  })
  const t4 = transformation(key, 'test-design', [diff], testDesign, '设计回归测试', '为补丁提案设计正常、并发和失败路径测试。', '每个测试有前置、动作和断言。', {
    lastRunId: testRunId,
    lastAppliedRunId: testRunId,
  })
  const t5 = transformation(key, 'pr', [testDesign], pr, '整理 PR 文案', '把问题、提案与验证待办整理成 PR 描述。', '真实测试结果保留待填写，不伪造已通过。', {
    lastRunId: prRunId,
    lastAppliedRunId: prRunId,
  })
  runs.push(
    appliedRun(key, 'behavior', t1, [issue, log, source, tests], behavior),
    appliedRun(key, 'patch', t2, [behavior], patchPlan, { targetVersionId: patchPlan.versions[0].id }),
    appliedRun(key, 'diff-applied', t3, [patchPlan], diff),
    appliedRun(key, 'test-design', t4, [diff], testDesign),
    appliedRun(key, 'pr', t5, [testDesign], pr),
    failedRun(key, 'diff-failed', t3, [patchPlan], diff, 'MODEL_TIMEOUT', '模型响应超时；现有 Unified Diff 提案没有被覆盖。'),
  )
  boards.push(makeBoard(
    key,
    '02 · 软件开发：缓存穿透修复提案',
    [path, issue, log, source, tests, behavior, patchPlan, diff, testDesign, pr],
    [],
    [t1, t2, t3, t4, t5],
  ))
}

// 03: a concrete travel plan with user-selected route and explicit fallback branch.
{
  const key = '03-tokyo'
  const path = journeyCard(
    key,
    '把固定订单与个人偏好变成东京七日行程',
    '许宁，第一次独自去东京的上班族；她不赶早、喜欢建筑和咖啡，希望每天都能直接照计划行动。',
    [
      '新建空画布，写旅行偏好与营业信息 Markdown 卡，再加入航班、酒店和收藏地点三个文本文件引用。',
      '按“个人偏好 → 航班 → 酒店”创建 Transformation“整理硬约束”，显式启动 Run。',
      '把硬约束、收藏地点和营业信息作为有序来源，创建“比较路线”；人工审阅三个候选后在同一 Card 提交选定路线 v2。',
      '把选定路线与营业信息一起作为来源创建“七日行程”并运行；再分别创建“出发执行包”和“雨天替代”两个分支。',
      '把营业信息和收藏地点作为有序来源，分别支撑对应的行程卡；Transformation 本身不会自动运行。',
    ],
    '路线 v1 是模型候选集合，v2 是许宁的明确取舍。行程 Run 读取路线 v2 与营业信息 v1；营业信息后来变为 v2，所以行程显示 stale。',
    '出发执行包与雨天替代是用户明确创建的两个目标，不是系统自动分支。',
    '由于第二步合并了新来源，本案例不保存整条 Workflow；可将稳定的“行程 → 执行包”线性段另行验证后保存。',
    '七日行程、预约与行李清单、雨天替代路线。',
    '材料都是本地 UTF-8 文本快照；Mira 不查询实时票价、天气、地图或营业状态。',
  )
  const preference = markdownCard(key, 'preference', 40, 570, [{
    markdown: md(
      '# 旅行偏好',
      '',
      '- 建筑、咖啡、街区摄影。',
      '- 10:00 后开始主要活动。',
      '- 每天步行不超过 15 公里。',
      '- 同一区域集中安排，保留午后休息。',
    ),
  }])
  const flights = fileCard(key, 'flights', 40, 820, 'showcase-materials/travel/flights.txt')
  const hotel = fileCard(key, 'hotel', 40, 1060, 'showcase-materials/travel/hotel.txt')
  const places = fileCard(key, 'places', 40, 1300, 'showcase-materials/travel/saved-places.csv')
  const hours = markdownCard(key, 'hours', 40, 1540, [
    {
      markdown: md(
        '# 营业与交通快照 v1',
        '',
        '- 周一：多家美术馆闭馆。',
        '- 上野到清澄白河约 25 分钟。',
        '- 上野到小金井约 55 分钟。',
        '- 羽田到上野预留 70 分钟。',
      ),
    },
    {
      markdown: md(
        '# 营业与交通快照 v2｜人工更新',
        '',
        '- 周一：多家美术馆闭馆。',
        '- 根津美术馆周五临时闭馆，需移到周六机动日。',
        '- 上野到清澄白河约 25 分钟。',
        '- 上野到小金井约 55 分钟。',
        '- 羽田到上野预留 70 分钟。',
      ),
    },
  ])
  const constraintsRunId = runId(key, 'constraints')
  const constraints = markdownCard(key, 'constraints', 620, 700, [{
    origin: 'ai',
    sourceRunId: constraintsRunId,
    markdown: md(
      '# 不可变约束',
      '',
      '- 9 月 14 日 15:00 后入住上野。',
      '- 9 月 21 日 14:40 前抵达羽田。',
      '- 每天 10:00 后开始，步行上限 15 公里。',
      '- 七晚均以上野为起终点。',
    ),
  }])
  const routesRunId = runId(key, 'routes')
  const routes = markdownCard(key, 'routes', 1070, 700, [
    {
      origin: 'ai',
      sourceRunId: routesRunId,
      markdown: md(
        '# 路线候选 v1',
        '',
        'A：东侧优先，前四天集中上野、清澄白河。',
        'B：兴趣优先，跨区较多。',
        'C：慢节奏，每天一个主区域。',
      ),
    },
    {
      markdown: md(
        '# 已选路线 v2｜东侧三日 + 西侧三日',
        '',
        '- 周日：抵达与上野散步。',
        '- 周一：谷中、代官山，避开闭馆。',
        '- 周二：清澄白河。',
        '- 周三：上野美术馆群。',
        '- 周四：小金井建筑园。',
        '- 周五：青山与代官山。',
        '- 周六：机动补位。',
      ),
    },
  ], { width: 390, height: 340 })
  const itineraryRunId = runId(key, 'itinerary')
  const itinerary = markdownCard(key, 'itinerary', 1540, 690, [{
    origin: 'ai',
    sourceRunId: itineraryRunId,
    markdown: md(
      '# 东京七日行程',
      '',
      '## 周二｜清澄白河',
      '10:30 咖啡店 → 12:30 午餐 → 14:00 街区摄影 → 16:30 返回上野。',
      '',
      '## 周四｜小金井',
      '10:00 出发 → 11:10 建筑园 → 15:30 返程 → 17:00 休息。',
      '',
      '其余日期均保留 60-90 分钟交通与排队缓冲。',
    ),
  }], { width: 400, height: 330 })
  const packRunId = runId(key, 'pack')
  const pack = markdownCard(key, 'pack', 2010, 560, [{
    origin: 'ai',
    sourceRunId: packRunId,
    markdown: md(
      '# 出发执行包',
      '',
      '## 出发前预约',
      '- 建筑园门票。',
      '- 周五晚餐。',
      '',
      '## 随身',
      '- 交通卡、充电器、轻便雨具。',
      '',
      '## 每晚复核',
      '- 次日营业快照与交通预留。',
    ),
  }])
  const rainRunId = runId(key, 'rain')
  const rain = markdownCard(key, 'rain', 2010, 890, [{
    origin: 'ai',
    sourceRunId: rainRunId,
    markdown: md(
      '# 雨天替代',
      '',
      '- 小金井日与上野美术馆日互换。',
      '- 清澄白河保留室内咖啡店，取消长距离摄影。',
      '- 机动日用于补回被取消的室外地点。',
    ),
  }])
  const t1 = transformation(key, 'constraints', [preference, flights, hotel], constraints, '整理旅行硬约束', '把个人节奏、航班和住宿整理为不可违反的时间与体力约束。', '所有日期和时点可回到来源。', {
    lastRunId: constraintsRunId,
    lastAppliedRunId: constraintsRunId,
  })
  const t2 = transformation(key, 'routes', [constraints, places, hours], routes, '比较路线候选', '在约束内按区域聚类收藏地点，提出三套路线。', '说明通勤、兴趣密度和闭馆冲突。', {
    lastRunId: routesRunId,
    lastAppliedRunId: routesRunId,
  })
  const t3 = transformation(key, 'itinerary', [routes, hours], itinerary, '编排七日行程', '把用户选定路线与营业信息展开成每天的时段、地点、交通和缓冲。', '每天不早于十点，步行不超过约束。', {
    lastRunId: itineraryRunId,
    lastAppliedRunId: itineraryRunId,
  })
  const t4 = transformation(key, 'pack', [itinerary], pack, '形成出发执行包', '从行程提取预约、随身与每日复核清单。', '清单按行动时点分组。', {
    lastRunId: packRunId,
    lastAppliedRunId: packRunId,
  })
  const t5 = transformation(key, 'rain', [itinerary], rain, '准备雨天替代', '为室外项目准备不增加跨区通勤的替代。', '说明互换规则和取消条件。', {
    lastRunId: rainRunId,
    lastAppliedRunId: rainRunId,
  })
  runs.push(
    appliedRun(key, 'constraints', t1, [preference, flights, hotel], constraints),
    appliedRun(key, 'routes', t2, [constraints, places, hours], routes, {
      targetVersionId: routes.versions[0].id,
      sourceVersionIds: { [hours.id]: hours.versions[0].id },
    }),
    appliedRun(key, 'itinerary', t3, [routes, hours], itinerary, {
      sourceVersionIds: { [hours.id]: hours.versions[0].id },
    }),
    appliedRun(key, 'pack', t4, [itinerary], pack),
    appliedRun(key, 'rain', t5, [itinerary], rain),
  )
  boards.push(makeBoard(
    key,
    '03 · 东京旅行：七日自由行执行板',
    [path, preference, flights, hotel, places, hours, constraints, routes, itinerary, pack, rain],
    [],
    [t1, t2, t3, t4, t5],
  ))
}

// 04: product research shows stale through a Markdown source revision.
{
  const key = '04-product'
  const path = journeyCard(
    key,
    '把四次访谈变成七天可执行的原型测试',
    '顾遥，一名独立开发轻量记账工具的产品作者；她要决定下一周做什么，而不是积累更多访谈摘要。',
    [
      '新建空画布，加入访谈转录与漏斗数据文件，再手写客服反馈 Markdown 卡。',
      '按“访谈 → 漏斗 → 客服反馈”选择来源，创建 Transformation“聚类用户证据”，显式启动 Run。',
      '人工审阅证据簇，继续依次创建“排序机会”“形成原型假设”“生成测试脚本”，每步完成后再运行下一步。',
      '后来补入一条新的客服反馈，来源卡从 v1 变为 v2；已采用的证据簇显示 stale，但不会自动重跑或覆盖下游。',
      '顾遥先检查变化是否足以影响判断，再决定重跑、保留旧版，或明确创建新的方向分支。',
    ],
    'stale 只说明最近采用的 Run 读取了旧来源版本。人工审阅后才决定是否追加新的成果 Version。',
    '若两种机会都值得验证，用户为第二个方向明确创建新目标；重新生成同一目标不会暗中分支。',
    '走通并复核后，可把线性四步保存为 Workflow；模板只保留方法，不复制这四次访谈。',
    '问题证据簇、机会排序、原型假设和一套七天测试任务。',
    '新反馈通过 Markdown CardVersion 变化触发 stale；修改磁盘中文件内容本身不会让 Card 自动产生新版本。',
  )
  const interviews = fileCard(key, 'interviews', 40, 570, 'showcase-materials/product/interviews.md')
  const funnel = fileCard(key, 'funnel', 40, 820, 'showcase-materials/product/funnel.csv')
  const feedback = markdownCard(key, 'feedback', 40, 1060, [
    {
      markdown: md(
        '# 客服反馈 v1',
        '',
        '- 14 人询问银行卡记录为何未自动匹配。',
        '- 9 人在首次复盘前退出。',
        '- 6 人要求增加更多分类。',
      ),
    },
    {
      markdown: md(
        '# 客服反馈 v2｜补入新样本',
        '',
        '- 14 人询问银行卡记录为何未自动匹配。',
        '- 9 人在首次复盘前退出。',
        '- 6 人要求增加更多分类。',
        '- 新增：5 人其实已连接账户，但不知道“首次复盘”入口在哪里。',
      ),
    },
  ], { width: 370, height: 280 })
  const evidenceRunId = runId(key, 'evidence')
  const evidence = markdownCard(key, 'evidence', 620, 690, [{
    origin: 'ai',
    sourceRunId: evidenceRunId,
    markdown: md(
      '# 用户证据主题簇',
      '',
      '1. 首次价值未发生：连接账户后没有完成首次复盘。',
      '2. 记录信任不足：自动匹配失败时用户不知道如何修正。',
      '3. 分类负担：用户要更快找到分类，而非增加更多层级。',
      '4. 未知：入口可见性是否是独立问题。',
    ),
  }], { width: 390, height: 310 })
  const opportunityRunId = runId(key, 'opportunity')
  const opportunity = markdownCard(key, 'opportunity', 1080, 700, [{
    origin: 'ai',
    sourceRunId: opportunityRunId,
    markdown: md(
      '# 机会排序',
      '',
      '| 机会 | 痛苦 | 覆盖 | 验证成本 | 顺序 |',
      '|---|---|---|---|---|',
      '| 首次复盘引导 | 高 | 高 | 低 | 1 |',
      '| 匹配纠错 | 高 | 中 | 中 | 2 |',
      '| 分类搜索 | 中 | 中 | 低 | 3 |',
    ),
  }])
  const hypothesisRunId = runId(key, 'hypothesis')
  const hypothesis = markdownCard(key, 'hypothesis', 1510, 700, [{
    origin: 'ai',
    sourceRunId: hypothesisRunId,
    markdown: md(
      '# 原型假设',
      '',
      '若连接账户后立即展示三步首次复盘，并解释一笔异常匹配，用户会更快感到“账目已经可控”。',
      '',
      '本轮不做：新增预算系统、更多分类层级、长期留存优化。',
    ),
  }])
  const scriptRunId = runId(key, 'script')
  const script = markdownCard(key, 'script', 1940, 690, [{
    origin: 'ai',
    sourceRunId: scriptRunId,
    markdown: md(
      '# 七天原型测试',
      '',
      '- 样本：8 位已连接账户但未完成复盘的用户。',
      '- 任务：找到异常支出并完成首次复盘。',
      '- 观察：是否看见入口、是否理解匹配状态、求助点。',
      '- 成功：6/8 无提示完成，且能复述异常原因。',
      '- 停止：入口改善后仍无法理解匹配状态。',
    ),
  }], { width: 390, height: 310 })
  const t1 = transformation(key, 'evidence', [interviews, funnel, feedback], evidence, '聚类用户证据', '整合访谈、行为漏斗和客服反馈，区分事实、反例与未知项。', '每个主题可追溯来源，不把频次当因果。', {
    lastRunId: evidenceRunId,
    lastAppliedRunId: evidenceRunId,
  })
  const t2 = transformation(key, 'opportunity', [evidence], opportunity, '排序产品机会', '按痛苦、覆盖、替代方式和验证成本排列机会。', '排序理由明确并保留未知项。', {
    lastRunId: opportunityRunId,
    lastAppliedRunId: opportunityRunId,
  })
  const t3 = transformation(key, 'hypothesis', [opportunity], hypothesis, '形成原型假设', '把最高优先机会写成可证伪的原型假设。', '明确本轮范围与非目标。', {
    lastRunId: hypothesisRunId,
    lastAppliedRunId: hypothesisRunId,
  })
  const t4 = transformation(key, 'script', [hypothesis], script, '生成七天测试脚本', '为原型假设设计一周内可完成的测试。', '包含样本、任务、观察、成功与停止条件。', {
    lastRunId: scriptRunId,
    lastAppliedRunId: scriptRunId,
  })
  runs.push(
    appliedRun(key, 'evidence', t1, [interviews, funnel, feedback], evidence, {
      sourceVersionIds: { [feedback.id]: feedback.versions[0].id },
    }),
    appliedRun(key, 'opportunity', t2, [evidence], opportunity),
    appliedRun(key, 'hypothesis', t3, [opportunity], hypothesis),
    appliedRun(key, 'script', t4, [hypothesis], script),
  )
  boards.push(makeBoard(
    key,
    '04 · 产品访谈：证据到七天原型测试',
    [path, interviews, funnel, feedback, evidence, opportunity, hypothesis, script],
    [],
    [t1, t2, t3, t4],
  ))
}

// 05: competitor facts become several practical tools through explicit fan-out.
{
  const key = '05-competition'
  const path = journeyCard(
    key,
    '把竞品本地快照变成销售与首页工具',
    '唐墨，一名准备发布开发者工具的独立创始人；他需要能应答客户、修改首页和继续访谈的具体材料。',
    [
      '新建空画布，加入三家竞品官网的本地 Markdown 快照、评论 CSV，再写自己的产品承诺卡。',
      '按“竞品 A → B → C → 评论 → 自有承诺”创建 Transformation“建立事实矩阵”，显式启动 Run。',
      '从事实矩阵生成“定位空位”；人工审阅并删除没有证据的判断，提交 v2。',
      '从定位空位明确创建“销售 Battlecard”“首页差异化文案”“客户反问清单”三条独立 Transformation，并逐条运行。',
      '把本地证据作为有序来源，标记每个判断对应的依据；Transformation 不参与自动执行。',
    ],
    '事实矩阵把事实与推断分栏；定位卡的人工 v2 是三个下游 Run 的共同来源。',
    '三个工具是显式 fan-out。重新生成任一工具只给该目标追加版本，不影响另外两个分支。',
    '保存 Workflow 时只能保存到无歧义的线性段；分支后的三个方向不会被系统擅自选中。',
    '销售 Battlecard、首页文案和下一轮客户反问清单。',
    'Mira 不访问实时官网；所有竞品信息来自工作区内的 UTF-8 本地快照。',
  )
  const rivalA = fileCard(key, 'rival-a', 40, 570, 'showcase-materials/competition/rival-a.md')
  const rivalB = fileCard(key, 'rival-b', 40, 810, 'showcase-materials/competition/rival-b.md')
  const rivalC = fileCard(key, 'rival-c', 40, 1050, 'showcase-materials/competition/rival-c.md')
  const reviews = fileCard(key, 'reviews', 40, 1290, 'showcase-materials/competition/reviews.csv')
  const promise = markdownCard(key, 'promise', 40, 1530, [{
    markdown: md(
      '# 自有产品承诺',
      '',
      '让 5-30 人开发团队在十分钟内接入，同时保留每次人工确认和历史版本。',
      '定价目标：团队每月 29 美元。',
    ),
  }])
  const matrixRunId = runId(key, 'matrix')
  const matrix = markdownCard(key, 'matrix', 620, 730, [{
    origin: 'ai',
    sourceRunId: matrixRunId,
    markdown: md(
      '# 竞品事实矩阵',
      '',
      '| 产品 | 目标用户 | 价格 | 强项 | 可核验弱点 |',
      '|---|---|---|---|---|',
      '| A | 大型平台 | 49/席位 | 审计 | 38 条配置负评 |',
      '| B | 独立开发者 | 用量计费 | 接入快 | 29 条历史负评 |',
      '| C | 安全团队 | 询价 | 本地部署 | 31 条维护负评 |',
    ),
  }], { width: 430, height: 300 })
  const positionRunId = runId(key, 'position')
  const position = markdownCard(key, 'position', 1120, 730, [
    {
      origin: 'ai',
      sourceRunId: positionRunId,
      markdown: md(
        '# 定位空位 v1',
        '',
        '中小团队缺少同时满足“快速接入、历史清楚、价格透明”的产品。',
      ),
    },
    {
      markdown: md(
        '# 定位空位 v2｜人工收紧',
        '',
        '目标不是所有中小团队，而是需要人工确认 AI 结果的 5-30 人开发团队。',
        '',
        '可证据化差异：',
        '- 十分钟接入。',
        '- 每次人工确认与历史版本可回看。',
        '- 团队月费公开为 29 美元。',
      ),
    },
  ], { width: 390, height: 300 })
  const battleRunId = runId(key, 'battle')
  const battle = markdownCard(key, 'battle', 1580, 540, [{
    origin: 'ai',
    sourceRunId: battleRunId,
    markdown: md(
      '# 销售 Battlecard',
      '',
      '客户说 A 审计更全：若是大型平台优先考虑 A；若核心是快速启用，展示十分钟接入。',
      '',
      '客户说 B 更便宜：比较完整历史与人工确认，不使用模糊“更安全”表述。',
      '',
      '客户说 C 可本地部署：诚实说明当前不提供本地部署。',
    ),
  }], { width: 400, height: 310 })
  const homepageRunId = runId(key, 'homepage')
  const homepage = markdownCard(key, 'homepage', 1580, 880, [{
    origin: 'ai',
    sourceRunId: homepageRunId,
    markdown: md(
      '# 首页差异化文案',
      '',
      '十分钟接入，关键结果仍由你确认。',
      '',
      '为 5-30 人开发团队保留每次修改、每次生成和每个当前版本。',
      '',
      '团队月费 29 美元，价格无需询价。',
    ),
  }])
  const questionsRunId = runId(key, 'questions')
  const questions = markdownCard(key, 'questions', 1580, 1180, [{
    origin: 'ai',
    sourceRunId: questionsRunId,
    markdown: md(
      '# 客户反问清单',
      '',
      '1. 你们现在最慢的是首次接入还是后续审阅？',
      '2. 历史结果丢失会造成什么实际成本？',
      '3. 本地部署是合规硬要求还是偏好？',
      '4. 透明定价会影响采购周期吗？',
    ),
  }])
  const t1 = transformation(key, 'matrix', [rivalA, rivalB, rivalC, reviews, promise], matrix, '建立竞品事实矩阵', '统一比较目标用户、价格、强项与本地评论证据。', '事实与推断分开，不能补写快照之外的信息。', {
    lastRunId: matrixRunId,
    lastAppliedRunId: matrixRunId,
  })
  const t2 = transformation(key, 'position', [matrix], position, '识别定位空位', '从事实矩阵中寻找可被当前产品承诺支撑的空位。', '每个差异可证据化并明确不适合的人群。', {
    lastRunId: positionRunId,
    lastAppliedRunId: positionRunId,
  })
  const t3 = transformation(key, 'battle', [position], battle, '制作销售 Battlecard', '把定位判断转成诚实的客户异议应答。', '不贬低竞品，不隐藏本产品边界。', {
    lastRunId: battleRunId,
    lastAppliedRunId: battleRunId,
  })
  const t4 = transformation(key, 'homepage', [position], homepage, '形成首页差异化文案', '把定位空位写成首页主张与证据。', '避免最高级和无法核验的安全承诺。', {
    lastRunId: homepageRunId,
    lastAppliedRunId: homepageRunId,
  })
  const t5 = transformation(key, 'questions', [position], questions, '形成客户反问清单', '把定位假设转成下一轮可验证问题。', '问题开放且不诱导答案。', {
    lastRunId: questionsRunId,
    lastAppliedRunId: questionsRunId,
  })
  runs.push(
    appliedRun(key, 'matrix', t1, [rivalA, rivalB, rivalC, reviews, promise], matrix),
    appliedRun(key, 'position', t2, [matrix], position, { targetVersionId: position.versions[0].id }),
    appliedRun(key, 'battle', t3, [position], battle),
    appliedRun(key, 'homepage', t4, [position], homepage),
    appliedRun(key, 'questions', t5, [position], questions),
  )
  boards.push(makeBoard(
    key,
    '05 · 竞品分析：事实到销售工具',
    [path, rivalA, rivalB, rivalC, reviews, promise, matrix, position, battle, homepage, questions],
    [],
    [t1, t2, t3, t4, t5],
  ))
}

// 06: Mira uses its own repository as read-only input and saves a verified method.
{
  const key = '06-mira'
  const path = journeyCard(
    key,
    '用 Mira 推进 Mira 的一次交互改进',
    '白榆，独立维护 Mira 的产品工程师；她要把一条真实反馈收敛成可审阅的规格、补丁提案与回归清单。',
    [
      '新建空画布，写用户反馈卡，并引用仓库里的产品定义、体验设计、v2Store.ts 与 v2-http.js 四个真实 UTF-8 文件。',
      '按“反馈 → 产品事实 → 体验契约 → 前端状态 → HTTP 边界”创建 Transformation“定义行为缺口”，显式启动 Run。',
      '人工审阅缺口卡并提交 v2，再依次运行“形成最小规格”“生成 Markdown Diff 提案”“形成回归清单”。',
      '白榆在 Mira 外人工应用 diff、执行测试；若结果与提案不同，把真实验证事实写回卡片的新 Version。',
      '四步都已有非空 Head 后，从这段无分支路径保存 Workflow“证据驱动的 Mira 迭代”。',
    ],
    '仓库文件只作为只读来源。模型输出是 Markdown 建议；人工确认后的规格版本才进入下一步。',
    '若有两个 UI 方向，用户明确创建两个目标分支；重新生成不会自动分叉。',
    'Workflow 只保存四步的 label、instruction 与 acceptance，不复制源码、反馈、Run 或坐标。',
    '行为缺口、最小规格、Markdown Diff 提案与可执行回归清单。',
    '当前 Mira 不修改仓库、不运行测试，也不把测试清单写成已通过；真实实施发生在 Mira 外。',
  )
  const issue = markdownCard(key, 'issue', 40, 570, [{
    markdown: md(
      '# 用户反馈',
      '',
      '应用 Workflow 后我看到三张空卡，以为系统已经在后台执行。',
      '我需要明确知道：计划已铺出，但还没有任何 Run。',
    ),
  }])
  const productDefinition = fileCard(key, 'product-definition', 40, 820, 'docs/product/product-definition.md')
  const experience = fileCard(key, 'experience', 40, 1060, 'docs/design/experience-design.md')
  const store = fileCard(key, 'store', 40, 1300, 'src/v2Store.ts')
  const http = fileCard(key, 'http', 40, 1540, 'bridge/v2-http.js')
  const gapRunId = runId(key, 'gap')
  const gap = markdownCard(key, 'gap', 620, 760, [
    {
      origin: 'ai',
      sourceRunId: gapRunId,
      markdown: md(
        '# 行为缺口 v1',
        '',
        '产品保证应用 Workflow 零 Run，但完成提示与空目标卡的组合可能让用户误解。',
      ),
    },
    {
      markdown: md(
        '# 行为缺口 v2｜人工确认',
        '',
        '## 当前事实',
        '- 应用接口只创建普通 Card 与 Transformation。',
        '- store 提示“尚未开始运行”。',
        '',
        '## 缺口',
        '- 计划首步的主动作不够醒目。',
        '- 后续空卡只显示“等待执行”，没有说明要先完成上一步。',
        '',
        '## 不变量',
        '- 不新增“运行全部”。',
        '- 不在应用时创建 Run。',
      ),
    },
  ], { width: 410, height: 350 })
  const specRunId = runId(key, 'spec')
  const spec = markdownCard(key, 'spec', 1100, 760, [{
    origin: 'ai',
    sourceRunId: specRunId,
    markdown: md(
      '# 最小交互规格',
      '',
      '1. 应用完成消息保留“尚未开始运行”。',
      '2. 第一步按钮使用“生成这一步”。',
      '3. 后续步骤来源未完成时使用“先完成上一步”。',
      '4. 关系详情显示当前步骤 n/N 与同计划导航。',
      '5. 禁止出现“运行全部”。',
    ),
  }], { width: 390, height: 320 })
  const diffRunId = runId(key, 'diff')
  const diff = markdownCard(key, 'diff', 1570, 750, [{
    origin: 'ai',
    sourceRunId: diffRunId,
    markdown: md(
      '# Markdown Diff 提案',
      '',
      '建议触点：',
      '- ContentCard：空卡等待文案。',
      '- DetailDrawer：步骤动作和 provenance。',
      '- v2Store：保持应用完成消息。',
      '- workflowUx.test：增加零 Run 与步骤门禁断言。',
      '',
      '不声称已经修改任何文件。',
    ),
  }], { width: 390, height: 320 })
  const regressionRunId = runId(key, 'regression')
  const regression = markdownCard(key, 'regression', 2040, 750, [{
    origin: 'ai',
    sourceRunId: regressionRunId,
    markdown: md(
      '# 回归清单',
      '',
      '- 应用模板后 Run 数量不变。',
      '- 第一步可运行，第二步来源未完成时禁用。',
      '- 普通 Transformation 文案不受影响。',
      '- Candidate pending 仍阻止重跑。',
      '- 删除模板不删除已有计划。',
      '- 桌面与窄屏无文字重叠。',
      '',
      '状态：待在 Mira 外执行并填写证据。',
    ),
  }], { width: 400, height: 350 })
  const t1 = transformation(key, 'gap', [issue, productDefinition, experience, store, http], gap, '定义行为缺口', '对照反馈、产品事实、体验契约和实现边界，定义真实行为缺口。', '区分当前事实、用户误解、不变量与非目标。', {
    lastRunId: gapRunId,
    lastAppliedRunId: gapRunId,
  })
  const t2 = transformation(key, 'spec', [gap], spec, '形成最小交互规格', '把行为缺口收敛为最小可验收交互规格。', '每条可观察，不新增运行全部或自动执行。', {
    lastRunId: specRunId,
    lastAppliedRunId: specRunId,
  })
  const t3 = transformation(key, 'diff', [spec], diff, '生成 Markdown Diff 提案', '列出可能触点与修改建议，不执行工作区写入。', '明确文件、行为和测试触点，不声称已落盘。', {
    lastRunId: diffRunId,
    lastAppliedRunId: diffRunId,
  })
  const t4 = transformation(key, 'regression', [diff], regression, '形成回归清单', '把提案转成可在 Mira 外执行的验证清单。', '覆盖核心不变量并保留待填写证据。', {
    lastRunId: regressionRunId,
    lastAppliedRunId: regressionRunId,
  })
  runs.push(
    appliedRun(key, 'gap', t1, [issue, productDefinition, experience, store, http], gap, { targetVersionId: gap.versions[0].id }),
    appliedRun(key, 'spec', t2, [gap], spec),
    appliedRun(key, 'diff', t3, [spec], diff),
    appliedRun(key, 'regression', t4, [diff], regression),
  )
  boards.push(makeBoard(
    key,
    '06 · Mira 自迭代：反馈到补丁提案',
    [path, issue, productDefinition, experience, store, http, gap, spec, diff, regression],
    [],
    [t1, t2, t3, t4],
  ))
  workflows.push({
    id: 'workflow-mira-iteration',
    title: '证据驱动的 Mira 迭代',
    description: '从真实反馈到行为缺口、最小规格、Markdown Diff 提案和回归清单。',
    steps: [
      { id: 'workflow-step-mira-gap', label: t1.label, instruction: t1.instruction, acceptance: t1.acceptance },
      { id: 'workflow-step-mira-spec', label: t2.label, instruction: t2.instruction, acceptance: t2.acceptance },
      { id: 'workflow-step-mira-diff', label: t3.label, instruction: t3.instruction, acceptance: t3.acceptance },
      { id: 'workflow-step-mira-regression', label: t4.label, instruction: t4.instruction, acceptance: t4.acceptance },
    ],
    createdAt: '',
    updatedAt: '',
  })
}

// 07: candidate result remains whole and reachable while the user owns the current resume.
{
  const key = '07-career'
  const path = journeyCard(
    key,
    '把经历证据变成定制求职申请包',
    '林然，一名从视觉设计转向产品设计的个人求职者；她要让每句话都能回到真实项目证据。',
    [
      '新建空画布，加入 Markdown 格式的主简历、职位描述和作品集素材，再写个人贡献证据卡。',
      '按“职位要求 → 主简历 → 作品集 → 贡献证据”创建 Transformation“建立要求—证据映射”，显式启动 Run。',
      '从映射卡明确创建“定制简历”“STAR 故事”“求职信”三个分支，并逐条运行。',
      '一次定制简历重跑期间，林然手工把真实提升数据写入当前 Card，形成 v2；Run 返回的整份结果进入 Candidate。',
      '她可以整份采用、整份丢弃，或先人工把有用段落合并到当前卡的新 Version 后再丢弃 Candidate。',
    ],
    'Candidate 不会作为新卡或新分支出现。未处理前，对应简历 Transformation 不能重跑、编辑或删除。',
    'STAR、求职信和简历是用户从同一证据映射明确创建的三个目标。',
    '该分支案例不强行保存完整 Workflow；稳定的“职位材料 → 证据映射”或单一下游路径可另行验证后保存。',
    '定制简历、STAR 故事库、求职信和模拟面试问题。',
    'Candidate 只能整份采用或丢弃；Mira 没有“只采用候选中的某几段”按钮。',
  )
  const masterResume = fileCard(key, 'master-resume', 40, 570, 'showcase-materials/career/master-resume.md')
  const job = fileCard(key, 'job', 40, 810, 'showcase-materials/career/job-description.md')
  const portfolio = fileCard(key, 'portfolio', 40, 1050, 'showcase-materials/career/portfolio-notes.md')
  const evidence = markdownCard(key, 'evidence', 40, 1290, [{
    markdown: md(
      '# 个人贡献证据',
      '',
      '- 我负责访谈提纲、5 次访谈和洞察归纳。',
      '- 我推动先修批量操作反馈，再统一视觉。',
      '- 上线后任务完成时间下降 23%。',
      '- 组件复用率 42% → 76% 来自设计系统项目。',
    ),
  }])
  const mappingRunId = runId(key, 'mapping')
  const mapping = markdownCard(key, 'mapping', 620, 690, [{
    origin: 'ai',
    sourceRunId: mappingRunId,
    markdown: md(
      '# 要求—证据映射',
      '',
      '| 职位要求 | 直接证据 | 缺口 |',
      '|---|---|---|',
      '| 问题定义 | 5 次访谈与批量操作洞察 | 需说明取舍 |',
      '| 数据解释 | 完成时间下降 23% | 补测量口径 |',
      '| 设计系统 | 复用率 42%→76% | 已有 |',
      '| B2B 复杂度 | 审批流程案例 | 补权限约束 |',
    ),
  }], { width: 420, height: 310 })
  const resumeAppliedId = runId(key, 'resume-applied')
  const tailored = markdownCard(key, 'tailored', 1110, 520, [
    {
      origin: 'ai',
      sourceRunId: resumeAppliedId,
      markdown: md(
        '# 定制简历 v1',
        '',
        '产品设计师，拥有设计系统与 B2B 流程经验。',
        '- 参与用户研究并优化批量操作。',
        '- 改版设计系统并提高组件复用。',
      ),
    },
    {
      markdown: md(
        '# 定制简历 v2｜人工事实优先',
        '',
        '产品设计师｜从研究证据推进复杂 B2B 体验',
        '',
        '- 独立完成 5 次访谈与洞察归纳，推动优先修正批量操作反馈；上线后任务完成时间下降 23%。',
        '- 主导 47 个重复组件收敛，组件复用率从 42% 提升至 76%。',
      ),
    },
  ], { width: 410, height: 310 })
  const starRunId = runId(key, 'star')
  const star = markdownCard(key, 'star', 1110, 880, [{
    origin: 'ai',
    sourceRunId: starRunId,
    markdown: md(
      '# STAR 故事库',
      '',
      '## 批量操作',
      'S：新手不理解影响范围。T：降低误操作。A：访谈、原型、先补反馈。R：任务时间下降 23%。',
      '',
      '## 设计系统',
      'S：47 个重复组件。A：按使用频率收敛。R：复用率升至 76%。',
    ),
  }])
  const coverRunId = runId(key, 'cover')
  const cover = markdownCard(key, 'cover', 1580, 650, [{
    origin: 'ai',
    sourceRunId: coverRunId,
    markdown: md(
      '# 求职信',
      '',
      '我希望把视觉背景转化为对复杂信息层级的敏感度，同时用访谈与行为结果解释设计取舍。贵职位强调问题定义、B2B 流程和设计系统，这三项分别对应我的批量操作、审批流程与组件治理经验。',
    ),
  }], { width: 400, height: 270 })
  const mockRunId = runId(key, 'mock')
  const mock = markdownCard(key, 'mock', 2040, 650, [{
    origin: 'ai',
    sourceRunId: mockRunId,
    markdown: md(
      '# 模拟面试问题',
      '',
      '1. 为什么先修反馈而不是重做整个批量流程？',
      '2. 23% 的任务时间下降如何测量？',
      '3. 如何处理设计系统统一与业务例外？',
      '4. 哪个决定由你个人推动？',
    ),
  }])
  const t1 = transformation(key, 'mapping', [job, masterResume, portfolio, evidence], mapping, '建立要求—证据映射', '逐项匹配职位要求与真实经历证据。', '每项注明直接证据、缺口和需要补充的口径。', {
    lastRunId: mappingRunId,
    lastAppliedRunId: mappingRunId,
  })
  const candidateId = runId(key, 'resume-candidate')
  const t2 = transformation(key, 'tailored', [mapping], tailored, '生成定制简历', '用职位语言重写简历，但只使用证据映射中的事实。', '每条成果包含个人动作和可核验结果。', {
    lastRunId: candidateId,
    lastAppliedRunId: resumeAppliedId,
  })
  const t3 = transformation(key, 'star', [mapping], star, '整理 STAR 故事', '把证据映射转为面试可讲的 STAR 故事。', '情境、任务、动作、结果齐全，个人贡献清楚。', {
    lastRunId: starRunId,
    lastAppliedRunId: starRunId,
  })
  const t4 = transformation(key, 'cover', [mapping], cover, '生成求职信', '把匹配证据组织为简洁求职信。', '不增加材料中没有的经历。', {
    lastRunId: coverRunId,
    lastAppliedRunId: coverRunId,
  })
  const t5 = transformation(key, 'mock', [star], mock, '生成模拟面试', '围绕 STAR 故事提出追问。', '问题检验取舍、口径和个人贡献。', {
    lastRunId: mockRunId,
    lastAppliedRunId: mockRunId,
  })
  const candidateOutput = md(
    '# 定制简历｜整份 Candidate',
    '',
    '资深产品设计师，主导大量用户研究并显著提升核心指标。',
    '- 全面负责批量操作重构。',
    '- 将设计效率提升 80%。',
    '',
    '这份候选包含无法由来源证明的夸大表述，只能整份采用或丢弃。',
  )
  runs.push(
    appliedRun(key, 'mapping', t1, [job, masterResume, portfolio, evidence], mapping),
    appliedRun(key, 'resume-applied', t2, [mapping], tailored, { targetVersionId: tailored.versions[0].id }),
    appliedRun(key, 'star', t3, [mapping], star),
    appliedRun(key, 'cover', t4, [mapping], cover),
    appliedRun(key, 'mock', t5, [star], mock),
    candidateRun(key, 'resume-candidate', t2, [mapping], tailored, candidateOutput, tailored.versions[0].id),
  )
  boards.push(makeBoard(
    key,
    '07 · 求职：经历证据到定制申请包',
    [path, masterResume, job, portfolio, evidence, mapping, tailored, star, cover, mock],
    [],
    [t1, t2, t3, t4, t5],
  ))
}

// 08: everyday planning turns constraints into a menu and two execution branches.
{
  const key = '08-dinner'
  const path = journeyCard(
    key,
    '把冰箱库存变成五日晚餐执行清单',
    '程青，一名工作日为两个人做素食晚餐的上班族；她要少浪费食材，也不能让周三的晚餐超过二十分钟。',
    [
      '新建空画布，加入库存 CSV、日程 ICS 和菜谱 Markdown 文件，再写饮食限制卡。',
      '按“饮食限制 → 库存 → 日程 → 菜谱”创建 Transformation“整理可用条件”，显式启动 Run。',
      '从条件卡生成“五日晚餐菜单”，人工审阅后把周二与周四互换，形成菜单 v2。',
      '从菜单 v2 明确创建“合并采购清单”和“周日备餐时间线”两个 Transformation，并分别运行。',
      '把含花生的菜谱和饮食限制作为有序来源，提醒这是需要人工排除的来源事实。',
    ],
    '人工调整后的菜单 v2 是两个下游 Run 的来源；旧菜单仍在版本历史中。',
    '采购与备餐是两个独立目标。若再做“带饭版”，用户需要明确创建第三条分支。',
    '这类分支板不保存整条 Workflow；可把“条件 → 菜单”两步单独验证成模板。',
    '五日晚餐菜单、按超市区域分节的 Markdown 采购清单和周日备餐时间线。',
    'Mira 不读取实时价格或库存；过敏判断仍需个人确认。',
  )
  const pantry = fileCard(key, 'pantry', 40, 570, 'showcase-materials/home/pantry.csv')
  const calendar = fileCard(key, 'calendar', 40, 810, 'showcase-materials/home/calendar.ics')
  const recipes = fileCard(key, 'recipes', 40, 1050, 'showcase-materials/home/recipes.md')
  const dietary = markdownCard(key, 'dietary', 40, 1290, [{
    markdown: md(
      '# 饮食限制',
      '',
      '- 两人份，素食。',
      '- 花生过敏。',
      '- 周三只有 20 分钟。',
      '- 优先消耗两天内到期的西兰花。',
    ),
  }])
  const conditionsRunId = runId(key, 'conditions')
  const conditions = markdownCard(key, 'conditions', 620, 700, [{
    origin: 'ai',
    sourceRunId: conditionsRunId,
    markdown: md(
      '# 可用条件',
      '',
      '- 周一先用西兰花。',
      '- 周二前使用豆腐。',
      '- 周三选择 20 分钟内菜品。',
      '- 花生酱拌面排除。',
      '- 周五可安排共同烹饪。',
    ),
  }])
  const menuRunId = runId(key, 'menu')
  const menu = markdownCard(key, 'menu', 1070, 690, [
    {
      origin: 'ai',
      sourceRunId: menuRunId,
      markdown: md(
        '# 五日晚餐菜单 v1',
        '',
        '- 周一：西兰花炒饭。',
        '- 周二：鹰嘴豆意面。',
        '- 周三：番茄豆腐煲。',
        '- 周四：蔬菜咖喱。',
        '- 周五：手工素饺。',
      ),
    },
    {
      markdown: md(
        '# 五日晚餐菜单 v2｜人工调整',
        '',
        '- 周一：西兰花炒饭。',
        '- 周二：番茄豆腐煲。',
        '- 周三：预制鹰嘴豆意面，20 分钟。',
        '- 周四：蔬菜咖喱。',
        '- 周五：一起做手工素饺。',
      ),
    },
  ], { width: 380, height: 300 })
  const groceryRunId = runId(key, 'grocery')
  const grocery = markdownCard(key, 'grocery', 1530, 570, [{
    origin: 'ai',
    sourceRunId: groceryRunId,
    markdown: md(
      '# 合并采购清单',
      '',
      '## 蔬果',
      '- 洋葱 3 个、胡萝卜 4 根、香菇 300 克。',
      '',
      '## 冷藏',
      '- 素饺皮 1 包。',
      '',
      '## 干货',
      '- 咖喱块、番茄罐头。',
      '',
      '已从清单排除库存中的豆腐、番茄、鹰嘴豆与意面。',
    ),
  }], { width: 390, height: 320 })
  const prepRunId = runId(key, 'prep')
  const prep = markdownCard(key, 'prep', 1530, 930, [{
    origin: 'ai',
    sourceRunId: prepRunId,
    markdown: md(
      '# 周日 60 分钟备餐',
      '',
      '00-10：洗切西兰花、洋葱、胡萝卜。',
      '10-25：煮鹰嘴豆意面酱。',
      '25-40：处理番茄豆腐煲底料。',
      '40-50：分装周三意面。',
      '50-60：标日期、整理台面。',
    ),
  }])
  const t1 = transformation(key, 'conditions', [dietary, pantry, calendar, recipes], conditions, '整理可用条件', '按饮食安全、临期库存、时间和菜谱顺序整理条件。', '排除花生并标出周三时间上限。', {
    lastRunId: conditionsRunId,
    lastAppliedRunId: conditionsRunId,
  })
  const t2 = transformation(key, 'menu', [conditions], menu, '生成五日晚餐菜单', '在条件内安排五日晚餐并减少浪费。', '每日可执行，周三不超过二十分钟。', {
    lastRunId: menuRunId,
    lastAppliedRunId: menuRunId,
  })
  const t3 = transformation(key, 'grocery', [menu], grocery, '合并采购清单', '从菜单扣除已有库存，按超市区域分节。', '数量适合两人且不含花生。', {
    lastRunId: groceryRunId,
    lastAppliedRunId: groceryRunId,
  })
  const t4 = transformation(key, 'prep', [menu], prep, '安排周日备餐', '把可提前完成的动作压缩到六十分钟。', '逐段有时间和产物。', {
    lastRunId: prepRunId,
    lastAppliedRunId: prepRunId,
  })
  runs.push(
    appliedRun(key, 'conditions', t1, [dietary, pantry, calendar, recipes], conditions),
    appliedRun(key, 'menu', t2, [conditions], menu, { targetVersionId: menu.versions[0].id }),
    appliedRun(key, 'grocery', t3, [menu], grocery),
    appliedRun(key, 'prep', t4, [menu], prep),
  )
  boards.push(makeBoard(
    key,
    '08 · 晚餐：五日菜单与备餐执行板',
    [path, pantry, calendar, recipes, dietary, conditions, menu, grocery, prep],
    [],
    [t1, t2, t3, t4],
  ))
}

// 09: the latest and final Run is interrupted while an applied script version remains.
{
  const key = '09-podcast'
  const path = journeyCard(
    key,
    '把访谈素材变成可录制的播客 Rundown',
    '季南，一名独立制作城市文化播客的主播；她要保留受访者原意，同时把材料变成可录制节奏。',
    [
      '新建空画布，加入访谈转录与背景资料文件，写节目语调和本期核心问题两张 Markdown 卡。',
      '按“核心问题 → 访谈 → 背景 → 语调”创建 Transformation“提出叙事角度”，显式启动 Run。',
      '人工审阅三个角度并选定“居民如何重新走进影院”，提交 v2；继续生成故事大纲、口播脚本和录音 Rundown。',
      '后来准备重跑口播脚本时，主播发现这次生成不应继续，在结果返回前点击停止。',
      '最终最新 Run 保持 interrupted；脚本现有 v2 与已完成 Rundown 都不被覆盖，用户可先修改 Transformation 再决定是否重跑。',
    ],
    '停止时界面不展示流式正文。已有 applied 版本与人工 v2 保持可见，中断不会创建新 Version。',
    '若要尝试另一种叙事，用户明确创建独立目标；本次停止不产生隐式分支。',
    '稳定的“角度 → 大纲 → 脚本 → Rundown”可保存 Workflow，但当前先保留中断状态用于展示运行安全。',
    '经人工校调的口播脚本和分钟级录音 Rundown。',
    'Mira 不处理原始音频；案例使用 UTF-8 访谈转录。最新 Run 必须保持 interrupted 才能从当前 UI 到达。',
  )
  const transcript = fileCard(key, 'transcript', 40, 570, 'showcase-materials/podcast/interview-transcript.md')
  const research = fileCard(key, 'research', 40, 810, 'showcase-materials/podcast/research.md')
  const tone = markdownCard(key, 'tone', 40, 1050, [{
    markdown: md(
      '# 节目语调',
      '',
      '- 克制、具体，不替受访者煽情。',
      '- 先让原声说话，再补背景。',
      '- 不把社区修复包装成个人英雄故事。',
    ),
  }])
  const question = markdownCard(key, 'question', 40, 1290, [{
    markdown: '# 核心问题\n\n一座关闭八年的老电影院，为什么能让附近居民重新走进来？',
  }])
  const anglesRunId = runId(key, 'angles')
  const angles = markdownCard(key, 'angles', 620, 690, [
    {
      origin: 'ai',
      sourceRunId: anglesRunId,
      markdown: md(
        '# 三个叙事角度 v1',
        '',
        'A：一台胶片机的复活。',
        'B：居民如何重新走进影院。',
        'C：老建筑修复的技术难题。',
      ),
    },
    {
      markdown: md(
        '# 选定角度 v2｜居民重新走进影院',
        '',
        '主线：关闭后的街区空缺 → 居民共同筹资 → 每周一次放映成为新的相遇。',
        '胶片机是线索，不是主角；避免个人英雄叙事。',
      ),
    },
  ], { width: 390, height: 290 })
  const outlineRunId = runId(key, 'outline')
  const outline = markdownCard(key, 'outline', 1080, 690, [{
    origin: 'ai',
    sourceRunId: outlineRunId,
    markdown: md(
      '# 故事大纲',
      '',
      '00:00 冷开场：放映机启动声。',
      '01:30 影院关闭后街区发生了什么。',
      '05:00 312 位居民为何愿意筹资。',
      '11:00 每周一次放映如何重新形成关系。',
      '17:00 回到馆长的判断：修建筑不是最难的。',
    ),
  }], { width: 390, height: 310 })
  const scriptAppliedId = runId(key, 'script-applied')
  const script = markdownCard(key, 'script', 1540, 650, [
    {
      origin: 'ai',
      sourceRunId: scriptAppliedId,
      markdown: md(
        '# 口播脚本 v1',
        '',
        '机器响起以前，这里已经安静了八年。馆长说，最难修复的并不是墙面，而是居民走进来的理由。',
        '',
        '接下来先听放映员描述第一次重新开机。',
      ),
    },
    {
      markdown: md(
        '# 口播脚本 v2｜主播校调',
        '',
        '【放映机原声 6 秒】',
        '',
        '这台机器停了八年。馆长更在意的，却是门外的人会不会回来。',
        '',
        '【馆长原声】最难的不是修建筑，而是让附近居民重新走进来。',
        '',
        '312 位居民给出了第一部分答案。',
      ),
    },
  ], { width: 410, height: 330 })
  const rundownRunId = runId(key, 'rundown')
  const rundown = markdownCard(key, 'rundown', 2020, 660, [{
    origin: 'ai',
    sourceRunId: rundownRunId,
    markdown: md(
      '# 录音 Rundown',
      '',
      '| 时间 | 内容 | 声音 |',
      '|---|---|---|',
      '| 00:00 | 冷开场 | 放映机 6 秒 |',
      '| 00:20 | 主播引题 | 干声 |',
      '| 01:30 | 关闭后的街区 | 居民原声 |',
      '| 05:00 | 共同筹资 | 轻环境声 |',
      '| 11:00 | 每周放映 | 排队现场 |',
      '| 17:00 | 回扣主题 | 馆长原声 |',
    ),
  }], { width: 390, height: 320 })
  const t1 = transformation(key, 'angles', [question, transcript, research, tone], angles, '提出叙事角度', '围绕核心问题提出三个不歪曲材料的叙事角度。', '每个角度说明主线、证据与风险。', {
    lastRunId: anglesRunId,
    lastAppliedRunId: anglesRunId,
  })
  const t2 = transformation(key, 'outline', [angles], outline, '形成故事大纲', '把人工选定角度展开为有时间节奏的章节。', '每章有功能、证据与原声位置。', {
    lastRunId: outlineRunId,
    lastAppliedRunId: outlineRunId,
  })
  const interruptedId = runId(key, 'script-interrupted')
  const t3 = transformation(key, 'script', [outline], script, '生成口播脚本', '保持克制语调，把大纲写成口播与原声交替的脚本。', '不替受访者添加情绪或事实。', {
    lastRunId: interruptedId,
    lastAppliedRunId: scriptAppliedId,
  })
  const t4 = transformation(key, 'rundown', [script], rundown, '形成录音 Rundown', '把脚本转为分钟、口播、原声与音乐提示。', '总时长十八分钟内，声音提示清晰。', {
    lastRunId: rundownRunId,
    lastAppliedRunId: rundownRunId,
  })
  runs.push(
    appliedRun(key, 'angles', t1, [question, transcript, research, tone], angles, { targetVersionId: angles.versions[0].id }),
    appliedRun(key, 'outline', t2, [angles], outline),
    appliedRun(key, 'script-applied', t3, [outline], script, { targetVersionId: script.versions[0].id }),
    appliedRun(key, 'rundown', t4, [script], rundown),
    interruptedRun(key, 'script-interrupted', t3, [outline], script),
  )
  boards.push(makeBoard(
    key,
    '09 · 播客：老电影院一期制作板',
    [path, transcript, research, tone, question, angles, outline, script, rundown],
    [],
    [t1, t2, t3, t4],
  ))
}

// 10: applying a Workflow creates a visible plan; only step one has been run.
{
  const key = '10-study'
  const path = journeyCard(
    key,
    '把网络章节材料放进已验证的认证学习流程',
    '陆言，一名利用晚间准备云架构认证的在职工程师；他已经在另一个章节走通“缺口 → 解释 → 题库 → 日历”的方法。',
    [
      '在这张空画布加入考试大纲、网络讲义、错题 CSV，并写可用时间 Markdown 卡。',
      '按“大纲 → 章节 → 错题 → 时间”选择起始来源，预览并应用 Workflow“章节攻坚四步法”。',
      '应用只铺出四张普通目标 Card 与四条 Transformation，零 Run；用户看到计划已放到画板但尚未开始。',
      '陆言点击第一步“生成这一步”启动 Run，人工审阅知识缺口卡；当前第二步可执行，第三、四步仍需等待上一步。',
      '每一步都可以在运行前修改 instruction 或 acceptance；若人工改稿与结果冲突，仍使用普通 Candidate 规则。',
    ],
    '当前 seed 只完成第 1/4 步。知识缺口的 Head 可继续人工改成新 Version，再决定是否执行第 2 步。',
    'WorkflowPlan 本身保持线性；如需为某个薄弱点另开专项题库，用户从相应 Card 明确创建计划外分支。',
    '详情展示模板名、applicationId 和步骤导航。删除模板也不会级联删除已铺出的普通计划对象。',
    '完成后得到个人知识缺口、通俗解释、情景题库和四周复习日历；当前停在可继续执行的 1/4 状态。',
    '没有“运行全部”；应用 Workflow、来源变化和完成上一步都不会自动启动后续 Run。',
  )
  const outline = fileCard(key, 'exam-outline', 40, 570, 'showcase-materials/study/exam-outline.md')
  const chapter = fileCard(key, 'networking', 40, 810, 'showcase-materials/study/networking.md')
  const errors = fileCard(key, 'error-log', 40, 1050, 'showcase-materials/study/error-log.csv')
  const time = markdownCard(key, 'time', 40, 1290, [{
    markdown: md(
      '# 可用时间',
      '',
      '- 工作日：每天 45 分钟。',
      '- 周六：2 小时，可做整套情景题。',
      '- 周日：1 小时复盘错题。',
      '- 四周后参加考试。',
    ),
  }])
  const gapRunId = runId(key, 'gap')
  const gap = markdownCard(key, 'gap', 620, 700, [{
    origin: 'ai',
    sourceRunId: gapRunId,
    markdown: md(
      '# 网络知识缺口｜步骤 1/4',
      '',
      '1. route priority：错误率 70%，无法稳定判断最长前缀与显式优先级。',
      '2. private endpoint：混淆私网解析与访问路径。',
      '3. NAT egress：不清楚有状态返回路径。',
      '4. security boundary：掌握较好，只需情景复核。',
    ),
  }], { width: 390, height: 300 })
  const explain = emptyCard(key, 'explain', 1080, 730, { width: 370, height: 250 })
  const questions = emptyCard(key, 'questions', 1520, 730, { width: 370, height: 250 })
  const calendar = emptyCard(key, 'calendar', 1960, 730, { width: 370, height: 250 })
  const workflowId = 'workflow-study-chapter'
  const applicationId = 'workflow-application-study-networking'
  const t1 = transformation(key, 'gap', [outline, chapter, errors, time], gap, '定位知识缺口', '结合考试权重、章节内容、错题和时间定位知识缺口。', '按错误率、考试权重和前置关系排序。', {
    lastRunId: gapRunId,
    lastAppliedRunId: gapRunId,
    workflowRef: { workflowId, stepId: 'workflow-step-study-gap', applicationId },
  })
  const t2 = transformation(key, 'explain', [gap], explain, '形成通俗解释卡', '针对最高优先缺口形成对比、例子与判断口诀。', '每个概念包含反例，不只背定义。', {
    workflowRef: { workflowId, stepId: 'workflow-step-study-explain', applicationId },
  })
  const t3 = transformation(key, 'questions', [explain], questions, '生成情景题库', '把解释卡转成需要做架构取舍的情景题。', '每题有答案、理由和常见误区。', {
    workflowRef: { workflowId, stepId: 'workflow-step-study-questions', applicationId },
  })
  const t4 = transformation(key, 'calendar', [questions], calendar, '安排四周复习日历', '按可用时间安排练习、复盘和模拟。', '每天任务可在时间上限内完成。', {
    workflowRef: { workflowId, stepId: 'workflow-step-study-calendar', applicationId },
  })
  runs.push(appliedRun(key, 'gap', t1, [outline, chapter, errors, time], gap))
  boards.push(makeBoard(
    key,
    '10 · 认证学习：章节攻坚 WorkflowPlan',
    [path, outline, chapter, errors, time, gap, explain, questions, calendar],
    [],
    [t1, t2, t3, t4],
  ))
  workflows.push({
    id: workflowId,
    title: '章节攻坚四步法',
    description: '把一组章节材料逐步变成缺口、解释、题库和复习日历；应用后逐步执行。',
    steps: [
      { id: 'workflow-step-study-gap', label: t1.label, instruction: t1.instruction, acceptance: t1.acceptance },
      { id: 'workflow-step-study-explain', label: t2.label, instruction: t2.instruction, acceptance: t2.acceptance },
      { id: 'workflow-step-study-questions', label: t3.label, instruction: t3.instruction, acceptance: t3.acceptance },
      { id: 'workflow-step-study-calendar', label: t4.label, instruction: t4.instruction, acceptance: t4.acceptance },
    ],
    createdAt: '',
    updatedAt: '',
  })
}

const expectedShowcaseBoards = [
  ['01-knowledge', '知识库生成'],
  ['02-software', '软件开发'],
  ['03-tokyo', '东京旅行'],
  ['04-product', '产品访谈'],
  ['05-competition', '竞品分析'],
  ['06-mira', 'Mira 自迭代'],
  ['07-career', '求职'],
  ['08-dinner', '晚餐'],
  ['09-podcast', '播客'],
  ['10-study', '认证学习'],
]

const BASE_TIME = Date.parse('2026-08-24T01:00:00.000Z')
let clock = 0
const nextTime = () => new Date(BASE_TIME + clock++ * 60_000).toISOString()

function versionForSnapshot(boardValue, source) {
  const card = boardValue.cards.find((item) => item.id === source.cardId)
  if (!card) throw new Error('Run source Card is missing: ' + source.cardId)
  const version = card.versions.find((item) => item.id === source.versionId)
  if (!version) throw new Error('Run source Version is missing: ' + source.versionId)
  return { card, version }
}

function assignVersionChain(card, requestedVersion) {
  const requestedIndex = card.versions.findIndex((item) => item.id === requestedVersion.id)
  if (requestedIndex < 0) throw new Error('Version does not belong to Card: ' + requestedVersion.id)
  for (let index = 0; index <= requestedIndex; index += 1) {
    const version = card.versions[index]
    if (version.createdAt) continue
    if (version.origin === 'ai') {
      throw new Error('AI Version is used before its source Run finishes: ' + version.id)
    }
    version.createdAt = nextTime()
  }
}

function finalizeChronology() {
  const referencedWorkflowIds = new Set(boards.flatMap((boardValue) => (
    boardValue.transformations
      .map((item) => item.workflowRef?.workflowId)
      .filter(Boolean)
  )))
  for (const workflow of workflows) {
    if (!referencedWorkflowIds.has(workflow.id)) continue
    workflow.createdAt = nextTime()
    workflow.updatedAt = workflow.createdAt
  }

  for (const boardValue of boards) {
    boardValue.createdAt = nextTime()

    for (const card of boardValue.cards) {
      card.createdAt = nextTime()
      const first = card.versions[0]
      if (first && first.origin !== 'ai') first.createdAt = card.createdAt
    }

    for (const transformationValue of boardValue.transformations) {
      transformationValue.createdAt = nextTime()
      transformationValue.updatedAt = transformationValue.createdAt
      const target = boardValue.cards.find((card) => card.id === transformationValue.targetCardId)
      if (!target) throw new Error('Transformation target Card is missing: ' + transformationValue.id)
      target.createdAt = transformationValue.createdAt
    }

    if (boardValue.id === boardId('10-study')) {
      const applicationTime = boardValue.transformations[0].createdAt
      const planTargetIds = new Set(boardValue.transformations.map((item) => item.targetCardId))
      for (const card of boardValue.cards) {
        if (planTargetIds.has(card.id)) card.createdAt = applicationTime
      }
      for (const transformationValue of boardValue.transformations) {
        transformationValue.createdAt = applicationTime
        transformationValue.updatedAt = applicationTime
      }
    }

    const boardRuns = runs.filter((run) => run.boardId === boardValue.id)
    for (const run of boardRuns) {
      for (const source of run.sourceSnapshot) {
        const { card, version } = versionForSnapshot(boardValue, source)
        assignVersionChain(card, version)
      }

      if (run.targetBaseVersionId) {
        const target = boardValue.cards.find((card) => card.id === run.targetCardId)
        const base = target?.versions.find((version) => version.id === run.targetBaseVersionId)
        if (!target || !base) throw new Error('Run target baseline is missing: ' + run.id)
        assignVersionChain(target, base)
      }

      run.createdAt = nextTime()
      run.startedAt = nextTime()

      if (run.result?.disposition === 'candidate') {
        const target = boardValue.cards.find((card) => card.id === run.targetCardId)
        if (!target) throw new Error('Candidate target is missing: ' + run.id)
        for (const version of target.versions) {
          if (version.createdAt) continue
          if (version.origin === 'ai') {
            throw new Error('Candidate cannot create an AI CardVersion: ' + version.id)
          }
          version.createdAt = nextTime()
        }
      }

      run.finishedAt = nextTime()

      if (run.result?.disposition === 'applied') {
        const target = boardValue.cards.find((card) => card.id === run.targetCardId)
        const applied = target?.versions.find((version) => version.id === run.result.appliedVersionId)
        if (!target || !applied) throw new Error('Applied Run target Version is missing: ' + run.id)
        if (applied.origin !== 'ai' || applied.sourceRunId !== run.id) {
          throw new Error('Applied Run does not own its AI Version: ' + run.id)
        }
        if (applied.createdAt) throw new Error('Applied AI Version existed before Run finished: ' + applied.id)
        applied.createdAt = run.finishedAt
      }
    }

    for (const transformationValue of boardValue.transformations) {
      const lastRun = boardRuns.find((run) => run.id === transformationValue.lastRunId)
      const lastAppliedRun = boardRuns.find((run) => run.id === transformationValue.lastAppliedRunId)
      const requiredUpdatedAt = Math.max(
        Date.parse(transformationValue.updatedAt),
        lastRun ? Date.parse(lastRun.startedAt) : Number.NEGATIVE_INFINITY,
        lastAppliedRun ? Date.parse(lastAppliedRun.finishedAt) : Number.NEGATIVE_INFINITY,
      )
      transformationValue.updatedAt = new Date(requiredUpdatedAt).toISOString()
    }

    for (const card of boardValue.cards) {
      for (const version of card.versions) {
        if (version.createdAt) continue
        if (version.origin === 'ai') throw new Error('AI Version has no finalized Run: ' + version.id)
        version.createdAt = nextTime()
      }
      card.updatedAt = card.versions.at(-1)?.createdAt || card.createdAt
    }

    boardValue.updatedAt = nextTime()
  }

  for (const workflow of workflows) {
    if (workflow.createdAt) continue
    workflow.createdAt = nextTime()
    workflow.updatedAt = workflow.createdAt
  }
}

finalizeChronology()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function parseTime(value, label) {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error('Invalid timestamp for ' + label + ': ' + value)
  return parsed
}

function staleState(boardValue, transformationValue) {
  if (!transformationValue.lastAppliedRunId) return false
  const applied = runs.find((run) => run.id === transformationValue.lastAppliedRunId)
  if (!applied) return false
  if (applied.sourceSnapshot.length !== transformationValue.sourceCardIds.length) return true
  return applied.sourceSnapshot.some((source, index) => {
    const currentCard = boardValue.cards.find((card) => card.id === transformationValue.sourceCardIds[index])
    return !currentCard
      || source.cardId !== currentCard.id
      || source.versionId !== currentCard.headVersionId
  })
}

assert(boards.length === expectedShowcaseBoards.length, 'Showcase requires 10 Boards, got ' + boards.length)
assert(new Set(boards.map((item) => item.id)).size === boards.length, 'Duplicate Board id')
assert(new Set(runs.map((item) => item.id)).size === runs.length, 'Duplicate Run id')
assert(new Set(workflows.map((item) => item.id)).size === workflows.length, 'Duplicate Workflow id')

const boardById = new Map(boards.map((item) => [item.id, item]))
const runById = new Map(runs.map((item) => [item.id, item]))
const workflowById = new Map(workflows.map((item) => [item.id, item]))

for (const [key, titleFragment] of expectedShowcaseBoards) {
  const boardValue = boardById.get(boardId(key))
  assert(boardValue, 'Missing showcase Board: ' + key)
  assert(boardValue.title.includes(titleFragment), boardValue.id + ' title must include ' + titleFragment)
  assert(boardValue.cards.some((card) => card.contentKind === 'file-reference'), boardValue.id + ' needs a file-reference')
  assert(boardValue.transformations.length > 0, boardValue.id + ' needs a Transformation')

  const journeyCards = boardValue.cards.filter((card) => card.versions.some((version) => (
    version.content.kind === 'markdown'
      && version.content.markdown.startsWith('# 个人路径｜')
  )))
  assert(journeyCards.length === 1, boardValue.id + ' must have exactly one personal journey Card')
  const journey = head(journeyCards[0]).content.markdown
  for (const required of [
    '## 个人使用者',
    '## 从空画布开始',
    'Transformation',
    'Run',
    '人工审阅',
    '版本',
    '## 分支与 Workflow',
    '## 最终成果',
    '## 当前能力边界',
  ]) {
    assert(journey.includes(required), boardValue.id + ' journey is missing: ' + required)
  }
}

for (const boardValue of boards) {
  const boardErrors = validateBoardV2(boardValue)
  assert(boardErrors.length === 0, boardValue.id + ': ' + boardErrors.join('; '))
  assert(boardValue.title.trim(), 'Board has no title: ' + boardValue.id)
  const cardById = new Map(boardValue.cards.map((item) => [item.id, item]))
  const transformationById = new Map(boardValue.transformations.map((item) => [item.id, item]))
  const boardCreatedAt = parseTime(boardValue.createdAt, boardValue.id + '.createdAt')
  const boardUpdatedAt = parseTime(boardValue.updatedAt, boardValue.id + '.updatedAt')
  const memberTimes = []

  for (const card of boardValue.cards) {
    assert([card.x, card.y, card.width, card.height].every(Number.isFinite), 'Card has invalid geometry: ' + card.id)
    const cardCreatedAt = parseTime(card.createdAt, card.id + '.createdAt')
    const cardUpdatedAt = parseTime(card.updatedAt, card.id + '.updatedAt')
    assert(boardCreatedAt <= cardCreatedAt, 'Card predates Board: ' + card.id)
    memberTimes.push(cardCreatedAt, cardUpdatedAt)

    let previousVersionAt = cardCreatedAt
    const firstVersion = card.versions[0]
    if (firstVersion && firstVersion.origin !== 'ai') {
      assert(
        firstVersion.createdAt === card.createdAt,
        'Initial human or file Version must share its Card creation timestamp: ' + card.id,
      )
    }
    for (const version of card.versions) {
      const versionCreatedAt = parseTime(version.createdAt, version.id + '.createdAt')
      assert(previousVersionAt <= versionCreatedAt, 'Card Version chronology is invalid: ' + version.id)
      previousVersionAt = versionCreatedAt
      memberTimes.push(versionCreatedAt)
      assert(version.digest === digestContent(version.content), 'Version digest mismatch: ' + version.id)

      if (version.content.kind === 'file-reference') {
        const path = version.content.path
        assert(!path.startsWith('/') && !path.split('/').includes('..'), 'Unsafe file-reference path: ' + path)
        assert(allowedTextExtensions.has(extname(path).toLowerCase()), 'Unsupported file-reference type: ' + path)
        assert(path in sourceTexts, 'Unreadable file-reference: ' + path)
        assert(!['.pdf', '.docx'].includes(extname(path).toLowerCase()), 'Binary source is not supported: ' + path)
      }

      if (version.origin === 'ai') {
        const sourceRun = runById.get(version.sourceRunId)
        assert(
          sourceRun
            && sourceRun.boardId === boardValue.id
            && sourceRun.targetCardId === card.id,
          'AI Version has invalid source Run: ' + version.id,
        )
        assert(
          versionCreatedAt >= parseTime(sourceRun.finishedAt, sourceRun.id + '.finishedAt'),
          'AI Version predates source Run completion: ' + version.id,
        )
      }
    }
    assert(cardUpdatedAt >= previousVersionAt, 'Card updatedAt predates latest Version: ' + card.id)
  }

  for (const transformationValue of boardValue.transformations) {
    assert(
      transformationValue.permissions.workspaceWrite === false,
      'Showcase Transformation cannot enable workspaceWrite: ' + transformationValue.id,
    )
    const transformationCreatedAt = parseTime(transformationValue.createdAt, transformationValue.id + '.createdAt')
    const transformationUpdatedAt = parseTime(transformationValue.updatedAt, transformationValue.id + '.updatedAt')
    memberTimes.push(transformationCreatedAt, transformationUpdatedAt)
    assert(transformationCreatedAt <= transformationUpdatedAt, 'Transformation chronology is invalid: ' + transformationValue.id)
    const targetCard = cardById.get(transformationValue.targetCardId)
    assert(
      targetCard?.createdAt === transformationValue.createdAt,
      'Transformation and its initial target Card must share a creation timestamp: ' + transformationValue.id,
    )

    for (const field of ['lastRunId', 'lastAppliedRunId']) {
      const referencedRunId = transformationValue[field]
      if (!referencedRunId) continue
      const referencedRun = runById.get(referencedRunId)
      assert(
        referencedRun
          && referencedRun.boardId === boardValue.id
          && referencedRun.transformationId === transformationValue.id
          && referencedRun.targetCardId === transformationValue.targetCardId,
        transformationValue.id + ' has invalid ' + field + ': ' + referencedRunId,
      )
    }

    if (transformationValue.lastAppliedRunId) {
      const applied = runById.get(transformationValue.lastAppliedRunId)
      assert(
        applied.status === 'succeeded' && applied.result?.disposition === 'applied',
        transformationValue.id + ' lastAppliedRunId is not applied',
      )
      assert(
        transformationUpdatedAt >= parseTime(applied.finishedAt, applied.id + '.finishedAt'),
        transformationValue.id + ' updatedAt must include the applied Run completion',
      )
    }

    if (transformationValue.lastRunId) {
      const latest = runById.get(transformationValue.lastRunId)
      assert(
        transformationUpdatedAt >= parseTime(latest.startedAt, latest.id + '.startedAt'),
        transformationValue.id + ' updatedAt must include the latest Run start',
      )
    }

    const expectedTransformationUpdatedAt = Math.max(
      transformationCreatedAt,
      transformationValue.lastRunId
        ? parseTime(runById.get(transformationValue.lastRunId).startedAt, transformationValue.lastRunId + '.startedAt')
        : Number.NEGATIVE_INFINITY,
      transformationValue.lastAppliedRunId
        ? parseTime(runById.get(transformationValue.lastAppliedRunId).finishedAt, transformationValue.lastAppliedRunId + '.finishedAt')
        : Number.NEGATIVE_INFINITY,
    )
    assert(
      transformationUpdatedAt === expectedTransformationUpdatedAt,
      'Transformation updatedAt must match its latest API mutation: ' + transformationValue.id,
    )

    if (transformationValue.workflowRef) {
      const workflow = workflowById.get(transformationValue.workflowRef.workflowId)
      assert(workflow, 'Missing WorkflowTemplate: ' + transformationValue.workflowRef.workflowId)
      const step = workflow.steps.find((item) => item.id === transformationValue.workflowRef.stepId)
      assert(step, 'Missing Workflow step: ' + transformationValue.workflowRef.stepId)
      assert(
        parseTime(workflow.createdAt, workflow.id + '.createdAt') <= transformationCreatedAt
          && parseTime(workflow.updatedAt, workflow.id + '.updatedAt') <= transformationCreatedAt,
        'WorkflowTemplate must exist before its applied Transformation: ' + transformationValue.id,
      )
      assert(
        step.label === transformationValue.label
          && step.instruction === transformationValue.instruction
          && step.acceptance === transformationValue.acceptance,
        'Applied Workflow step fields differ from its template: ' + transformationValue.id,
      )
    }
  }

  const boardRuns = runs.filter((item) => item.boardId === boardValue.id)
  for (const run of boardRuns) {
    const transformationValue = transformationById.get(run.transformationId)
    assert(
      transformationValue && transformationValue.targetCardId === run.targetCardId,
      'Run points to an invalid Transformation: ' + run.id,
    )
    assert(
      ['succeeded', 'failed', 'interrupted'].includes(run.status),
      'Showcase cannot seed an active Run: ' + run.id,
    )
    const createdAt = parseTime(run.createdAt, run.id + '.createdAt')
    const startedAt = parseTime(run.startedAt, run.id + '.startedAt')
    const finishedAt = parseTime(run.finishedAt, run.id + '.finishedAt')
    memberTimes.push(createdAt, startedAt, finishedAt)
    assert(createdAt <= startedAt && startedAt <= finishedAt, 'Run chronology is invalid: ' + run.id)
    assert(
      parseTime(transformationValue.createdAt, transformationValue.id + '.createdAt') <= createdAt,
      'Transformation must exist before its Run: ' + run.id,
    )
    assert(
      run.sourceSnapshot.map((source) => source.cardId).join('\0')
        === transformationValue.sourceCardIds.join('\0'),
      'Run source order differs from Transformation: ' + run.id,
    )

    for (const source of run.sourceSnapshot) {
      const card = cardById.get(source.cardId)
      assert(card, 'Run source Card is missing: ' + run.id + '/' + source.cardId)
      const expected = snapshot(card, source.versionId)
      assert(
        expected.contentKind === source.contentKind
          && expected.resolvedContent === source.resolvedContent
          && expected.digest === source.digest,
        'Run source snapshot mismatch: ' + run.id + '/' + source.cardId,
      )
      const sourceVersion = head(card, source.versionId)
      assert(
        parseTime(sourceVersion.createdAt, sourceVersion.id + '.createdAt') <= createdAt,
        'Run source Version did not exist at Run creation: ' + run.id + '/' + source.versionId,
      )
    }

    if (run.targetBaseVersionId) {
      const target = cardById.get(run.targetCardId)
      const base = target?.versions.find((version) => version.id === run.targetBaseVersionId)
      assert(base, 'Run target baseline is missing: ' + run.id)
      assert(
        parseTime(base.createdAt, base.id + '.createdAt') <= createdAt,
        'Run target baseline did not exist at Run creation: ' + run.id,
      )
    }

    if (run.status === 'succeeded') {
      assert(run.result?.output, 'Succeeded Run has no output: ' + run.id)
      assert(run.result.digest === digestText(run.result.output), 'Run result digest mismatch: ' + run.id)
      if (run.result.disposition === 'applied') {
        const target = cardById.get(run.targetCardId)
        const appliedVersion = target?.versions.find((version) => version.id === run.result.appliedVersionId)
        assert(
          appliedVersion
            && appliedVersion.origin === 'ai'
            && appliedVersion.sourceRunId === run.id
            && appliedVersion.content.markdown === run.result.output,
          'Applied Run has no matching AI Version: ' + run.id,
        )
        assert(
          appliedVersion.createdAt === run.finishedAt,
          'Applied AI Version must share the Run completion timestamp: ' + run.id,
        )
      } else {
        assert(run.result.disposition === 'candidate', 'Invalid succeeded disposition: ' + run.id)
        assert(!run.result.appliedVersionId, 'Candidate cannot have an applied Version: ' + run.id)
        const target = cardById.get(run.targetCardId)
        assert(
          target?.headVersionId && target.headVersionId !== run.targetBaseVersionId,
          'Candidate requires a changed target Head: ' + run.id,
        )
        assert(
          !target.versions.some((version) => version.sourceRunId === run.id),
          'Candidate cannot already exist as a CardVersion: ' + run.id,
        )
        assert(
          parseTime(head(target).createdAt, target.id + '.head.createdAt') <= finishedAt,
          'Candidate target edit must exist before Run completion: ' + run.id,
        )
      }
    } else {
      assert(run.error?.code && !run.result, 'Failed or interrupted Run needs an error and no result: ' + run.id)
    }
  }

  assert(
    boardUpdatedAt >= Math.max(...memberTimes),
    'Board updatedAt predates one of its Cards, Versions, Transformations, or Runs: ' + boardValue.id,
  )
}

for (const run of runs) {
  assert(boardById.has(run.boardId), 'Run Board is missing: ' + run.id)
  assert(run.id && run.boardId && run.transformationId && run.targetCardId, 'Invalid Run: ' + JSON.stringify(run))
}

for (const workflow of workflows) {
  const workflowErrors = validateWorkflow(workflow)
  assert(workflowErrors.length === 0, workflow.id + ': ' + workflowErrors.join('; '))
  assert(
    parseTime(workflow.createdAt, workflow.id + '.createdAt')
      <= parseTime(workflow.updatedAt, workflow.id + '.updatedAt'),
    'Workflow chronology is invalid: ' + workflow.id,
  )
  assert(
    workflow.createdAt === workflow.updatedAt,
    'Workflow create must use one timestamp: ' + workflow.id,
  )
}

const softwareBoard = boardById.get(boardId('02-software'))
const softwareDiff = softwareBoard.cards.find((card) => head(card).content.kind === 'markdown' && head(card).content.markdown.includes('# Unified Diff 提案'))
const softwareFailure = runById.get(runId('02-software', 'diff-failed'))
assert(softwareDiff, 'Software Board needs a Markdown Unified Diff proposal')
assert(softwareFailure?.status === 'failed' && softwareFailure.error?.code === 'MODEL_TIMEOUT', 'Software Board needs a technical failed Run')
assert(
  softwareBoard.transformations.find((item) => item.id === transformationId('02-software', 'diff'))?.lastRunId === softwareFailure.id,
  'Software failed Run must remain the latest visible Run',
)

const tokyoBoard = boardById.get(boardId('03-tokyo'))
const tokyoItinerary = tokyoBoard.transformations.find((item) => item.id === transformationId('03-tokyo', 'itinerary'))
assert(staleState(tokyoBoard, tokyoItinerary), 'Tokyo itinerary must be stale after the Markdown hours Card changes')
assert(
  tokyoItinerary.sourceCardIds.some((id) => tokyoBoard.cards.find((card) => card.id === id)?.contentKind === 'markdown'),
  'Tokyo stale state must come from a Markdown source',
)

const productBoard = boardById.get(boardId('04-product'))
const productEvidence = productBoard.transformations.find((item) => item.id === transformationId('04-product', 'evidence'))
assert(staleState(productBoard, productEvidence), 'Product evidence must be stale after the Markdown feedback Card changes')

for (const boardKey of ['01-knowledge', '05-competition', '08-dinner']) {
  const boardValue = boardById.get(boardId(boardKey))
  const sourceUse = new Map()
  for (const transformationValue of boardValue.transformations) {
    for (const sourceCardId of transformationValue.sourceCardIds) {
      sourceUse.set(sourceCardId, (sourceUse.get(sourceCardId) || 0) + 1)
    }
  }
  assert([...sourceUse.values()].some((count) => count > 1), boardValue.id + ' must contain an explicit fan-out')
}

const miraBoard = boardById.get(boardId('06-mira'))
const miraWorkflow = workflowById.get('workflow-mira-iteration')
assert(miraWorkflow?.steps.length === 4, 'Mira Board needs its extracted four-step Workflow')
assert(
  miraWorkflow.steps.every((step, index) => {
    const transformationValue = miraBoard.transformations[index]
    return step.label === transformationValue.label
      && step.instruction === transformationValue.instruction
      && step.acceptance === transformationValue.acceptance
  }),
  'Mira extracted Workflow must copy every Transformation field exactly',
)
assert(
  parseTime(miraWorkflow.createdAt, miraWorkflow.id + '.createdAt')
    >= parseTime(miraBoard.updatedAt, miraBoard.id + '.updatedAt'),
  'Mira extracted Workflow cannot predate its completed source Board',
)
assert(
  ['docs/product/product-definition.md', 'docs/design/experience-design.md', 'src/v2Store.ts', 'bridge/v2-http.js'].every((path) => (
    miraBoard.cards.some((card) => card.versions.some((version) => version.content.kind === 'file-reference' && version.content.path === path))
  )),
  'Mira self-iteration Board must reference the real UTF-8 repository files',
)

const careerBoard = boardById.get(boardId('07-career'))
const pendingCandidates = runs.filter((run) => run.boardId === careerBoard.id && run.result?.disposition === 'candidate')
assert(pendingCandidates.length === 1, 'Career Board needs exactly one pending Candidate')
assert(
  head(careerBoard.cards.find((card) => card.id === pendingCandidates[0].targetCardId)).content.markdown.includes('人工事实优先'),
  'Career Candidate must preserve the manually edited Head',
)

const podcastBoard = boardById.get(boardId('09-podcast'))
const podcastRuns = runs.filter((run) => run.boardId === podcastBoard.id)
const podcastFinalRun = podcastRuns.toSorted((left, right) => Date.parse(left.finishedAt) - Date.parse(right.finishedAt)).at(-1)
assert(podcastFinalRun?.status === 'interrupted', 'Podcast final Run must remain interrupted')
assert(
  podcastBoard.transformations.find((item) => item.id === podcastFinalRun.transformationId)?.lastRunId === podcastFinalRun.id,
  'Podcast interrupted Run must remain reachable as lastRunId',
)

const studyBoard = boardById.get(boardId('10-study'))
const studyPlan = studyBoard.transformations
assert(studyPlan.length === 4 && studyPlan.every((item) => item.workflowRef?.workflowId === 'workflow-study-chapter'), 'Study Board needs a four-step WorkflowPlan')
const studyApplicationTimes = new Set([
  ...studyPlan.map((item) => item.createdAt),
  ...studyPlan.slice(1).map((item) => item.updatedAt),
  ...studyPlan.map((item) => studyBoard.cards.find((card) => card.id === item.targetCardId)?.createdAt),
])
assert(
  studyApplicationTimes.size === 1 && !studyApplicationTimes.has(undefined),
  'Study WorkflowPlan targets and Transformations must share one atomic application timestamp',
)
assert(
  studyPlan[0].lastAppliedRunId
    && !studyPlan[1].lastRunId
    && !studyPlan[2].lastRunId
    && !studyPlan[3].lastRunId,
  'Study WorkflowPlan must stop after the completed first step',
)
assert(
  studyPlan.slice(1).every((item) => studyBoard.cards.find((card) => card.id === item.targetCardId)?.headVersionId === null),
  'Unrun Study Workflow steps must have empty target Cards',
)

const featureStatus = {
  personalJourney: '10/10 Boards',
  fileReference: '10/10 Boards; UTF-8 text only',
  orderedMultiSource: '10/10 Boards',
  cardVersion: '01, 02, 03, 04, 05, 06, 07, 08, 09',
  explicitFanOut: '01 knowledge, 05 competition, 08 dinner',
  failedRetry: '02 software; MODEL_TIMEOUT, previous applied result retained',
  stale: '03 Tokyo hours v1→v2; 04 product feedback v1→v2',
  candidate: '07 career; whole result pending',
  interrupted: '09 podcast; final Run remains interrupted',
  workflowTemplate: '06 Mira iteration; 10 study method',
  workflowPlan: '10 study; step 1/4 completed, later steps unrun',
  workspaceWrite: 'disabled on every Transformation',
}

const boardDir = resolve(outputRoot, 'boards-v2')
const runDir = resolve(outputRoot, 'runs-v2')
const workflowDir = resolve(outputRoot, 'workflows-v2')
const materialDir = resolve(outputRoot, 'showcase-materials')
await Promise.all([
  mkdir(boardDir, { recursive: true }),
  mkdir(runDir, { recursive: true }),
  mkdir(workflowDir, { recursive: true }),
  mkdir(materialDir, { recursive: true }),
])

await Promise.all([
  ...boards.map((value) => writeFile(
    resolve(boardDir, value.id + '.json'),
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  )),
  ...runs.map((value) => writeFile(
    resolve(runDir, value.id + '.json'),
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  )),
  ...workflows.map((value) => writeFile(
    resolve(workflowDir, value.id + '.json'),
    JSON.stringify(value, null, 2) + '\n',
    'utf8',
  )),
  ...Object.entries(materials).map(async ([relativePath, content]) => {
    const target = resolve(outputRoot, relativePath)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content, 'utf8')
  }),
])

console.log(JSON.stringify({
  outputRoot,
  boards: boards.length,
  runs: runs.length,
  workflows: workflows.length,
  generatedMaterials: Object.keys(materials).length,
  repositoryReferences: repositoryPaths.length,
  featureStatus,
}, null, 2))
