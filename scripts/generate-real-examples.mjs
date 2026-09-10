// One-shot authoring tool: real provider calls, isolated workspace, normal Mira APIs.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { startNodeRuntime } from '../bridge/node-runtime.js'
import { createModelSettingsService } from '../bridge/model-settings.js'
import { validateBoardArtifact } from '../bridge/domain/board-artifact.js'
import { validateWorkspaceBackup } from '../bridge/domain/workspace-backup.js'
import { exampleSources } from './real-example-sources.mjs'

assert(process.env.MIRA_LLM_API_KEY, 'Set MIRA_LLM_API_KEY in the process environment')
const model = process.env.MIRA_LLM_MODEL || 'k3'
const baseUrl = process.env.MIRA_LLM_BASE_URL || 'https://api.kimi.com/coding/v1'
const workspaceRoot = await mkdtemp(join(tmpdir(), 'mira-real-examples-'))
const receipts = []
let context = null
const settings = createModelSettingsService({
  initial: { baseUrl, model, apiKey: process.env.MIRA_LLM_API_KEY },
  async fetchImpl(url, options) {
    const startedAt = new Date().toISOString()
    const response = await fetch(url, { ...options,
      signal: AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(600000)]),
    })
    const data = await response.clone().json().catch(() => ({}))
    if (response.ok && context) receipts.push({ ...context, startedAt,
      finishedAt: new Date().toISOString(), requestedModel: model,
      responseModel: data.model, responseId: data.id, usage: data.usage,
      outputSha256: createHash('sha256').update(data.choices?.[0]?.message?.content?.trim() || '').digest('hex'),
    })
    return response
  },
})
const runtime = await startNodeRuntime({ workspaceRoot,
  staticRoot: new URL('../dist/', import.meta.url).pathname,
  hostOptions: { modelSettings: settings, logger: { log() {}, error() {} } },
})
const origin = runtime.address.url
console.log(JSON.stringify({ workspaceRoot, origin, model, stage: 'ready' }))
async function request(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(origin + '/graphmind/api/v2' + path, {
    method, headers: { 'Content-Type': 'application/json', Origin: origin },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json()
  assert(response.ok, `${method} ${path}: ${data.code || response.status} ${data.message || ''}`)
  return data
}
const getBoard = async id => (await request('/boards/' + id)).board
const head = card => card.versions.find(v => v.id === card.headVersionId).content.markdown
async function nameCard(boardId, card, name) {
  return (await request(`/boards/${boardId}/cards/${card.id}`, { name, baseName: card.name || null }, 'PATCH')).card
}
async function generate(boardId, transformation, during) {
  context = { boardId, transformationId: transformation.id }
  const { run } = await request(`/boards/${boardId}/transformations/${transformation.id}/runs`, {})
  console.log(JSON.stringify({ stage: 'running', boardId, label: transformation.label, runId: run.id }))
  if (during) await during()
  for (let attempt = 0; attempt < 660; attempt++) {
    const current = (await request('/runs/' + run.id)).run
    if (!['running', 'queued'].includes(current.status)) {
      context = null
      assert.equal(current.status, 'succeeded', `${transformation.label}: ${current.error?.code} ${current.error?.message}`)
      const receipt = receipts.findLast(item => item.transformationId === transformation.id && !item.runId)
      assert(receipt, 'Missing live-provider receipt')
      receipt.runId = run.id
      assert.equal(receipt.outputSha256, createHash('sha256').update(current.result.output).digest('hex'))
      console.log(JSON.stringify({ stage: 'generated', label: transformation.label,
        characters: current.result.output.length, disposition: current.result.disposition, responseModel: receipt.responseModel }))
      return current
    }
    await delay(1000)
  }
  await request(`/runs/${run.id}/interrupt`, {})
  throw new Error('Run exceeded authoring timeout; retained in isolated workspace')
}
const artifacts = []
const overview = []
try {
  await settings.test()
  console.log(JSON.stringify({ stage: 'connection-tested', model }))
  for (const scenario of await exampleSources()) {
    const { boardId } = await request('/boards', { title: scenario.title })
    const cards = []
    for (const [i, material] of scenario.sources.entries()) {
      const { card } = await request(`/boards/${boardId}/cards`, {
        markdown: material.markdown, x: 0, y: i * 290, width: 370, height: 250, color: 'blue',
      })
      cards.push(await nameCard(boardId, card, material.name))
    }
    const { card: brief } = await request(`/boards/${boardId}/cards`, {
      markdown: '# 本次要解决的问题\n\n' + scenario.question + '\n\n材料由案例编辑选取；成果通过 Kimi 实际生成。模型分析不等于作者、维护者或研究机构的结论。',
      x: 1370, y: 0, width: 430, height: 230, color: 'yellow',
    })
    await nameCard(boardId, brief, '问题与边界')
    const steps = []
    for (const [i, spec] of scenario.steps.entries()) {
      const board = await getBoard(boardId)
      const ids = spec.sources.map(ref => typeof ref === 'number' ? cards[ref].id : steps[Number(ref.slice(4))].targetCardId)
      const { transformation, targetCard } = await request(`/boards/${boardId}/transformations`, {
        label: spec.name,
        instruction: spec.instruction + '\n\n输出中文Markdown正文，通常600到900字（任务另有字数要求时以任务为准）。开头直接给核心判断，随后给证据与局限。不要执行交付说明，不要虚构引文、事实或验证结果。只使用提供的来源。',
        acceptance: '明确来源与推断的界限；结论有材料支持；输出能供人继续修改；未回答的问题明确保留。',
        sourceRefs: ids.map(id => ({ cardId: id, versionId: board.cards.find(card => card.id === id).headVersionId })),
        targetPosition: { x: i === 2 ? 1370 : 710, y: i === 2 ? 390 : i * 610 },
      })
      steps.push(transformation)
      await nameCard(boardId, targetCard, spec.name)
      await request(`/boards/${boardId}/cards/${targetCard.id}`, { width: 460, height: i === 2 ? 630 : 490 }, 'PATCH')
      await request(`/boards/${boardId}/transformations/${transformation.id}/position`, {
        x: i === 2 ? 1190 : 435, y: i === 2 ? 630 : i * 610 + 150,
      }, 'PATCH')
      await generate(boardId, transformation)
    }
    if (scenario.key === 'software') {
      const board = await getBoard(boardId)
      await request(`/boards/${boardId}/checkpoints`, { title: '发布证据初审｜模型推导原貌',
        note: '保留三步Kimi原始成果；属于案例分析，不是维护者发布批准。', baseRevision: board.revision })
      const scope = board.cards.find(card => card.id === steps[1].targetCardId)
      await request(`/boards/${boardId}/cards/${scope.id}/versions`, { baseVersionId: scope.headVersionId,
        markdown: head(scope) + '\n\n## 案例编辑复核\n\nWindows 的 native make/packed smoke 与真机客户端验收必须分别记录。这里保留的发布范围是讨论稿，不能据此执行仓库公开或上传安装包。下游验收清单需据此重新核对。' })
    }
    if (scenario.inspiration) {
      const { entry } = await request('/inspiration-pool/entries', { markdown: scenario.inspiration, tags: ['阅读', '评价尺度'] })
      await request(`/boards/${boardId}/cards/batch`, { cards: [{ poolSource: {
        poolId: 'inspiration-pool', entryId: entry.id, versionId: entry.headVersionId,
      }, tags: entry.tags }] })
    }
    if (scenario.key === 'writing') {
      await request('/workflows', { title: '证据文章｜提纲、初稿、核查',
        description: '从本次真实模型输出经编辑检查后提取；复用时需要重新核对全部来源。',
        sourceBoardId: boardId, transformationIds: steps.map(s => s.id),
        inputs: cards.map(card => ({ sourceCardId: card.id, name: card.name, description: '', required: true, cardinality: 'one' })),
      })
      const board = await getBoard(boardId)
      const draft = board.cards.find(card => card.id === steps[1].targetCardId)
      await generate(boardId, steps[1], async () => {
        await request(`/boards/${boardId}/cards/${draft.id}/versions`, { baseVersionId: draft.headVersionId,
          markdown: head(draft) + '\n\n## 案例编辑保留意见\n\n这里讨论的是公开候选源码的证据边界，不能暗示仓库已公开、桌面包已正式发布。也不能把构建成功等同于 Windows 客户端已验收。本文保留为未发布稿，最终措辞由作者核对。' })
      })
    }
    const artifact = await request(`/boards/${boardId}/export`)
    validateBoardArtifact(artifact)
    artifacts.push({ key: scenario.key, artifact })
    overview.push({ key: scenario.key, boardId, title: scenario.title,
      cards: artifact.board.cards.length, runs: artifact.runs.length,
      steps: steps.map(s => ({ id: s.id, cardId: s.targetCardId, name: s.label })) })
    await writeFile(join(workspaceRoot, `${scenario.key}.mira-board.json`), JSON.stringify(artifact, null, 2) + '\n')
  }
  const backup = await request('/backup')
  validateWorkspaceBackup(backup)
  assert.equal(receipts.length, backup.runs.length)
  const output = new URL('../docs/examples/', import.meta.url)
  for (const { key, artifact } of artifacts) {
    await writeFile(new URL(`${key}.mira-board.json`, output), JSON.stringify(artifact, null, 2) + '\n')
  }
  await writeFile(new URL('mira-four-scenarios.mira-backup.json', output), JSON.stringify(backup, null, 2) + '\n')
  await mkdir(new URL('../docs/validation/evidence/', import.meta.url), { recursive: true })
  await writeFile(new URL('../docs/validation/evidence/2026-09-10-kimi-example-receipts.json', import.meta.url), JSON.stringify({
    generatedAt: new Date().toISOString(), sourceCommit: '8e95063', endpoint: baseUrl,
    requestedModel: model, receipts, boards: overview,
  }, null, 2) + '\n')
  console.log(JSON.stringify({ stage: 'exported', workspaceRoot, origin, boards: overview, runs: receipts.length }))
} finally {
  await runtime.close()
}
