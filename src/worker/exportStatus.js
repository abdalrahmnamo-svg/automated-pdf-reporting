/** Export job lifecycle: queued -> rendering -> done | failed (a failed render may be retried). */

export const STATUSES = Object.freeze({
  QUEUED: 'queued',
  RENDERING: 'rendering',
  DONE: 'done',
  FAILED: 'failed',
})

export const TERMINAL_STATUSES = new Set([STATUSES.DONE, STATUSES.FAILED])

/** Allowed state transitions. `rendering -> queued` is the retry edge. */
export const ALLOWED_TRANSITIONS = {
  queued: new Set(['rendering']),
  rendering: new Set(['done', 'failed', 'queued']),
  done: new Set(),
  failed: new Set(),
}

/** @param {string} from @param {string} to */
export function canTransition(from, to) {
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false
}

/** @param {string} status */
export function isTerminal(status) {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Plain-object view of a job suitable for logging or JSON output.
 * @param {{id:string,status:string,attempts:number,error:string|null,outputPath:string|null,
 *          createdAt:number,startedAt:number|null,finishedAt:number|null,params:object}} job
 */
export function jobToApiResponse(job) {
  const iso = (ms) => (ms == null ? null : new Date(ms).toISOString())
  return {
    id: job.id,
    status: job.status,
    attempts: job.attempts,
    error: job.error ?? null,
    outputPath: job.outputPath ?? null,
    createdAt: iso(job.createdAt),
    startedAt: iso(job.startedAt),
    finishedAt: iso(job.finishedAt),
  }
}
