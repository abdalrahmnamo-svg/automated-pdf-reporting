// In-process scheduler: renders a report every N minutes with a simple setInterval.
//   npm run report:schedule                       (every 1440 min, latest quarter that has data)
//   npm run report:schedule -- --every 60 --period 2026-Q1
//   npm run report:schedule -- --once             (render one report now, then exit)
// The process must stay running; use your OS scheduler / a process manager for production.
import { loadEnv, parseReportArgs } from './args.js'
import { ExportWorker } from '../worker/exportWorker.js'
import { generateReport } from '../report/generate.js'
import { openDb, latestConversationAt } from '../db.js'
import { quarterOf, resolvePeriod } from '../period.js'

loadEnv()

let args
try {
  args = parseReportArgs(process.argv.slice(2), {
    every: { type: 'string', default: '1440' },
    once: { type: 'boolean', default: false },
  })
} catch (err) {
  console.error(err.message)
  process.exit(2)
}

const everyMin = Number(args.every)
if (!Number.isFinite(everyMin) || everyMin <= 0) {
  console.error('--every must be a positive number of minutes')
  process.exit(2)
}

/** Explicit --period/--from/--to wins; otherwise the quarter containing the newest conversation. */
function currentPeriodArgs() {
  if (args.period || (args.from && args.to)) return { period: args.period, from: args.from, to: args.to }
  const db = openDb(args.db, { readOnly: true })
  try {
    const latest = latestConversationAt(db)
    return { period: latest ? quarterOf(latest) : quarterOf(new Date().toISOString()) }
  } finally {
    db.close()
  }
}

const worker = new ExportWorker({
  timeoutMs: Number(process.env.REPORT_TIMEOUT_MS) || 60_000,
  render: (params, ctx) => generateReport({ ...params, signal: ctx.signal }),
})
worker.on('status', (job) => console.log(`[${new Date().toISOString()}] ${job.id} ${job.status}`))

async function runOnce() {
  const p = currentPeriodArgs()
  resolvePeriod(p)
  const job = worker.enqueue({ dbPath: args.db, ...p, title: args.title, outDir: args.out, htmlOnly: args['html-only'] })
  const done = await worker.waitFor(job.id)
  if (done.status === 'done') console.log(`Wrote ${done.outputPath}`)
  else console.error(`Scheduled report failed: ${done.error}`)
  return done
}

if (args.once) {
  const done = await runOnce()
  process.exitCode = done.status === 'done' ? 0 : 1
} else {
  console.log(`Scheduling a report every ${everyMin} minute(s). Ctrl+C to stop.`)
  await runOnce()
  setInterval(() => {
    runOnce().catch((err) => console.error('Scheduled run error:', err.message))
  }, everyMin * 60_000)
}
