import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contentDigest } from '../src/domain/sourceScopes.js'
import { parseExtractionList } from '../src/domain/extraction.js'

export function validateQualityCases(cases) {
  if (!Array.isArray(cases) || cases.length !== 6 || new Set(cases.map(item => item.id)).size !== 6) throw new Error('Quality matrix requires six distinct, explicitly selected cases')
  for (const item of cases) if (!item.id || !item.material?.trim() || !item.instruction?.trim() || !item.acceptance?.trim() || !['mira-close-reading', 'mira-evidence-review', 'mira-revision'].includes(item.guidanceId) || !item.sourceDescription) throw new Error('Each quality case requires material, provenance, user goal, criteria and guidance')
  for (const id of ['mira-close-reading', 'mira-evidence-review', 'mira-revision']) if (cases.filter(item => item.guidanceId === id).length < 2) throw new Error('Each guidance requires at least two materials')
}
export async function runQualityMatrix({ cases, api, boardId, persist, onProgress = () => {} }) {
  validateQualityCases(cases)
  const report = { format: 'mira-quality-matrix-v1', startedAt: new Date().toISOString(), boardId, attempts: [], cases: [] }
  await persist(report)
  for (const [index, sample] of cases.entries()) {
    const source = sample.existingSource || (await api(`/boards/${boardId}/cards`, { name: sample.title, markdown: sample.material + '\n\n不应进入所选输入：MIRA_EXCLUDED_SCOPE_CANARY', x: 0, y: index * 300, width: 312, height: 208 })).card
    const record = { ...sample, sourceCardId: source.id, variants: [] }
    report.cases.push(record)
    for (const guided of [false, true]) {
      const sourceRef = sample.sourceRef || { cardId: source.id, versionId: source.headVersionId }
      if (!sample.existingSource) sourceRef.scope = { mode: 'ranges', versionId: source.headVersionId, contentDigest: await contentDigest(source.versions.at(-1).content.markdown), spans: [{ start: 0, end: sample.material.length }] }
      const step = !guided && sample.existingControl ? sample.existingControl : await api(`/boards/${boardId}/transformations`, {
        sourceRefs: [sourceRef], label: `${sample.title} · ${guided ? '有指导' : '无指导'}`, instruction: sample.instruction, acceptance: sample.acceptance,
        ...(guided ? { guidance: { id: sample.guidanceId, version: sample.guidanceVersion || '1.0.0' } } : {}), targetPosition: { x: guided ? 800 : 400, y: index * 300 },
      })
      let run = !guided && sample.existingControl ? (await api(`/runs/${sample.existingControl.runId}`)).run : (await api(`/boards/${boardId}/transformations/${step.transformation.id}/runs`, {})).run
      report.attempts.push({ caseId: sample.id, guided, runId: run.id, existing: Boolean(!guided && sample.existingControl) })
      await persist(report); onProgress(`${sample.id} ${guided ? 'guided' : 'control'} ${run.id}: ${run.status}`)
      const deadline = Date.now() + 300000
      while (['queued', 'running'].includes(run.status) && Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 2000))
        run = (await api(`/runs/${run.id}`)).run
      }
      const board = (await api(`/boards/${boardId}`)).board
      const card = board.cards.find(card => card.id === run.targetCardId)
      const output = run.result?.disposition === 'applied' ? card?.versions.find(version => version.id === run.result.appliedVersionId)?.content.markdown || '' : run.result?.output || ''
      let items = null, parseError
      try { items = parseExtractionList(output) } catch (error) { parseError = error.message }
      if (run.sourceSnapshot.some(source => source.resolvedContent.includes('MIRA_EXCLUDED_SCOPE_CANARY'))) throw new Error('Selected source scope leaked excluded text')
      record.variants.push({ guided, run, output, outputCharacters: output.length, extractionCount: items?.length ?? null, ...(parseError ? { parseError } : {}), review: 'pending', manualEditCharacters: null, humanReviewSeconds: null })
      await persist(report); onProgress(`${sample.id} ${guided ? 'guided' : 'control'}: ${run.status}, ${output.length} characters`)
      if (['queued', 'running'].includes(run.status) || run.error?.code === 'MODEL_AUTH_FAILED') throw new Error('Quality run needs attention; no automatic model retry was issued')
    }
  }
  report.finishedAt = new Date().toISOString(); await persist(report)
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inputPath, outputPath, origin, boardId] = process.argv.slice(2)
  const endpoint = new URL(origin)
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !boardId || !outputPath) throw new Error('Use the explicit loopback QA host and board; configure its model in memory first')
  const api = async (path, body) => {
    const response = await fetch(`${endpoint.origin}/graphmind/api/v2${path}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) })
    const data = await response.json(); if (!response.ok) throw new Error(`QA API failed: ${data.code}`); return data
  }
  await runQualityMatrix({ cases: JSON.parse(await readFile(inputPath, 'utf8')), api, boardId,
    persist: report => writeFile(outputPath, JSON.stringify(report, null, 2) + '\n'), onProgress: message => console.log(message),
  })
}
