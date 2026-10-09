import { EventEmitter } from 'node:events'
import { STATUSES, canTransition, isTerminal } from './exportStatus.js'

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_RETRIES = 1

/**
 * In-process export queue (concurrency 1).
 *
 *   enqueue(params) -> job { status: 'queued' }
 *   worker picks it up: queued -> rendering -> done | failed
 *   each render attempt is raced against `timeoutMs`; a failed or timed-out attempt
 *   is retried up to `maxRetries` times (rendering -> queued -> rendering) before `failed`.
 *
 * The render function receives `(params, { signal })`; `signal` aborts on timeout so the
 * renderer can release resources (the default renderer closes its browser).
 */
export class ExportWorker extends EventEmitter {
  /**
   * @param {{render:(params:object, ctx:{signal:AbortSignal})=>Promise<{outputPath?:string}|void>,
   *          timeoutMs?:number, maxRetries?:number, now?:()=>number}} opts
   */
  constructor({ render, timeoutMs = DEFAULT_TIMEOUT_MS, maxRetries = DEFAULT_MAX_RETRIES, now = Date.now } = {}) {
    super()
    if (typeof render !== 'function') throw new TypeError('ExportWorker needs a render function')
    this.render = render
    this.timeoutMs = timeoutMs
    this.maxRetries = maxRetries
    this.now = now
    this.jobs = new Map()
    this.queue = []
    this.running = false
    this.seq = 0
  }

  enqueue(params = {}) {
    const job = {
      id: `job-${++this.seq}`,
      params,
      status: STATUSES.QUEUED,
      attempts: 0,
      error: null,
      outputPath: null,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
    }
    this.jobs.set(job.id, job)
    this.queue.push(job.id)
    this.emit('status', job)
    queueMicrotask(() => this.#drain())
    return job
  }

  getJob(id) {
    return this.jobs.get(id) ?? null
  }

  /** Resolves with the job once it reaches `done` or `failed`. */
  waitFor(id) {
    const job = this.jobs.get(id)
    if (!job) return Promise.reject(new Error(`unknown job ${id}`))
    if (isTerminal(job.status)) return Promise.resolve(job)
    return new Promise((resolve) => {
      const onStatus = (j) => {
        if (j.id === id && isTerminal(j.status)) {
          this.off('status', onStatus)
          resolve(j)
        }
      }
      this.on('status', onStatus)
    })
  }

  #transition(job, to) {
    if (!canTransition(job.status, to)) throw new Error(`illegal transition ${job.status} -> ${to}`)
    job.status = to
    this.emit('status', job)
  }

  async #drain() {
    if (this.running) return
    this.running = true
    try {
      while (this.queue.length > 0) {
        const job = this.jobs.get(this.queue.shift())
        await this.#run(job)
      }
    } finally {
      this.running = false
    }
  }

  async #run(job) {
    for (;;) {
      this.#transition(job, STATUSES.RENDERING)
      job.attempts += 1
      job.startedAt ??= this.now()
      try {
        const result = await this.#attempt(job)
        job.outputPath = result?.outputPath ?? null
        job.error = null
        job.finishedAt = this.now()
        this.#transition(job, STATUSES.DONE)
        return
      } catch (err) {
        job.error = err?.message || String(err)
        if (job.attempts <= this.maxRetries) {
          this.#transition(job, STATUSES.QUEUED) // retry edge
          continue
        }
        job.finishedAt = this.now()
        this.#transition(job, STATUSES.FAILED)
        return
      }
    }
  }

  #attempt(job) {
    const controller = new AbortController()
    let timer
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const err = new Error(`render timed out after ${this.timeoutMs}ms`)
        controller.abort(err)
        reject(err)
      }, this.timeoutMs)
    })
    // A late rejection from an abandoned render must not become an unhandled rejection.
    const work = Promise.resolve().then(() => this.render(job.params, { signal: controller.signal }))
    work.catch(() => {})
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
  }
}
