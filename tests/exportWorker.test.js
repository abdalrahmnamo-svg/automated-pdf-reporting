import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { ExportWorker } from '../src/worker/exportWorker.js'
import { canTransition, isTerminal, jobToApiResponse } from '../src/worker/exportStatus.js'

describe('exportStatus', () => {
  test('allowed and forbidden transitions', () => {
    assert.ok(canTransition('queued', 'rendering'))
    assert.ok(canTransition('rendering', 'done'))
    assert.ok(canTransition('rendering', 'failed'))
    assert.ok(canTransition('rendering', 'queued')) // retry edge
    assert.ok(!canTransition('queued', 'done'))
    assert.ok(!canTransition('done', 'rendering'))
    assert.ok(!canTransition('failed', 'queued'))
    assert.ok(!canTransition('bogus', 'queued'))
  })
  test('terminal states', () => {
    assert.ok(isTerminal('done') && isTerminal('failed'))
    assert.ok(!isTerminal('queued') && !isTerminal('rendering'))
  })
  test('jobToApiResponse serialises timestamps', () => {
    const r = jobToApiResponse({ id: 'j', status: 'done', attempts: 1, error: null, outputPath: 'x.pdf', createdAt: 0, startedAt: null, finishedAt: 1000 })
    assert.equal(r.createdAt, '1970-01-01T00:00:00.000Z')
    assert.equal(r.startedAt, null)
  })
})

describe('ExportWorker', () => {
  test('queued -> rendering -> done', async () => {
    const seen = []
    const w = new ExportWorker({ render: async () => ({ outputPath: 'out.pdf' }), timeoutMs: 1000 })
    w.on('status', (j) => seen.push(j.status))
    const job = w.enqueue({ period: '2026-Q1' })
    assert.equal(job.status, 'queued')
    const done = await w.waitFor(job.id)
    assert.equal(done.status, 'done')
    assert.equal(done.outputPath, 'out.pdf')
    assert.equal(done.attempts, 1)
    assert.deepEqual(seen, ['queued', 'rendering', 'done'])
  })

  test('retries once and succeeds on the second attempt', async () => {
    let calls = 0
    const seen = []
    const w = new ExportWorker({
      render: async () => {
        calls += 1
        if (calls === 1) throw new Error('transient')
        return { outputPath: 'ok.pdf' }
      },
      timeoutMs: 1000,
      maxRetries: 1,
    })
    w.on('status', (j) => seen.push(j.status))
    const done = await w.waitFor(w.enqueue({}).id)
    assert.equal(done.status, 'done')
    assert.equal(done.attempts, 2)
    assert.equal(done.error, null)
    assert.deepEqual(seen, ['queued', 'rendering', 'queued', 'rendering', 'done'])
  })

  test('marks the job failed after a timeout plus one retry', async () => {
    let calls = 0
    let aborted = 0
    const w = new ExportWorker({
      render: (_params, { signal }) =>
        new Promise(() => {
          calls += 1
          signal.addEventListener('abort', () => (aborted += 1))
        }), // never settles
      timeoutMs: 40,
      maxRetries: 1,
    })
    const done = await w.waitFor(w.enqueue({}).id)
    assert.equal(done.status, 'failed')
    assert.equal(done.attempts, 2)
    assert.equal(calls, 2)
    assert.equal(aborted, 2)
    assert.match(done.error, /timed out after 40ms/)
    assert.ok(done.finishedAt >= done.createdAt)
  })

  test('marks the job failed when every attempt throws', async () => {
    const w = new ExportWorker({ render: async () => { throw new Error('boom') }, timeoutMs: 1000, maxRetries: 1 })
    const done = await w.waitFor(w.enqueue({}).id)
    assert.equal(done.status, 'failed')
    assert.equal(done.attempts, 2)
    assert.equal(done.error, 'boom')
  })

  test('maxRetries: 0 fails immediately', async () => {
    let calls = 0
    const w = new ExportWorker({ render: async () => { calls += 1; throw new Error('x') }, maxRetries: 0 })
    const done = await w.waitFor(w.enqueue({}).id)
    assert.equal(done.status, 'failed')
    assert.equal(calls, 1)
  })

  test('processes jobs one at a time, in order', async () => {
    const order = []
    const w = new ExportWorker({
      render: async (p) => {
        order.push(`start-${p.n}`)
        await new Promise((r) => setTimeout(r, 15))
        order.push(`end-${p.n}`)
      },
    })
    const a = w.enqueue({ n: 1 })
    const b = w.enqueue({ n: 2 })
    await Promise.all([w.waitFor(a.id), w.waitFor(b.id)])
    assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2'])
  })

  test('requires a render function', () => {
    assert.throws(() => new ExportWorker({}), TypeError)
  })
})
