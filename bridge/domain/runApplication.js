import { digestText } from './content.js'
import { appendVersion } from './versioning.js'
import { typed } from './errors.js'

function candidateResult(run) {
  if (run.status !== 'succeeded' || run.result?.disposition !== 'candidate') {
    throw typed('RUN_CANDIDATE_REQUIRED', `Run ${run.id} has no active candidate`)
  }
  return run.result
}

export function applyRunOutput(card, run, output, options) {
  if (run.status !== 'running') {
    throw typed('RUN_NOT_RUNNING', `Run ${run.id} is not running`)
  }
  if (card.id !== run.targetCardId) {
    throw typed('RUN_TARGET_MISMATCH', `Run ${run.id} targets another card`)
  }
  if (typeof output !== 'string' || output.length === 0) {
    throw typed('EMPTY_OUTPUT', `Run ${run.id} returned no content`)
  }

  const outputResult = {
    output,
    digest: digestText(output),
    disposition:
      card.headVersionId === run.targetBaseVersionId ? 'applied' : 'candidate',
  }

  if (outputResult.disposition === 'candidate') {
    return {
      card,
      run: {
        ...run,
        status: 'succeeded',
        result: outputResult,
        finishedAt: options.finishedAt,
      },
    }
  }

  const updatedCard = appendVersion(card, {
    baseVersionId: run.targetBaseVersionId,
    versionId: options.versionId,
    content: { kind: 'markdown', markdown: output },
    origin: 'ai',
    sourceRunId: run.id,
    createdAt: options.finishedAt,
  })

  return {
    card: updatedCard,
    run: {
      ...run,
      status: 'succeeded',
      result: { ...outputResult, appliedVersionId: options.versionId },
      finishedAt: options.finishedAt,
    },
  }
}

export function adoptCandidate(card, run, options) {
  const result = candidateResult(run)
  const updatedCard = appendVersion(card, {
    baseVersionId: options.baseVersionId,
    versionId: options.versionId,
    content: { kind: 'markdown', markdown: result.output },
    origin: 'ai',
    sourceRunId: run.id,
    createdAt: options.createdAt,
  })

  return {
    card: updatedCard,
    run: {
      ...run,
      result: {
        ...result,
        disposition: 'applied',
        appliedVersionId: options.versionId,
      },
    },
  }
}

export function discardCandidate(run) {
  const result = candidateResult(run)
  return {
    ...run,
    result: { ...result, disposition: 'discarded' },
  }
}
