// Usage:
//   npm run report -- --period 2026-Q1
//   npm run report -- --from 2026-01-15 --to 2026-02-10
//   npm run report:html -- --period 2026-Q1      (emit HTML only; fast template iteration)
import { loadEnv, parseReportArgs } from './args.js'
import { ExportWorker } from '../worker/exportWorker.js'
import { generateReport } from '../report/generate.js'
import { resolvePeriod } from '../period.js'

loadEnv()

let args
try {
  args = parseReportArgs(process.argv.slice(2))
} catch (err) {
  console.error(err.message)
  process.exit(2)
}

try {
  resolvePeriod({ period: args.period, from: args.from, to: args.to }) // fail fast on bad input, no retry
} catch (err) {
  console.error(err.message)
  process.exit(2)
}

const worker = new ExportWorker({
  timeoutMs: Number(process.env.REPORT_TIMEOUT_MS) || 60_000,
  render: (params, ctx) =>
    generateReport({ ...params, signal: ctx.signal }),
})
worker.on('status', (job) => console.log(`[${job.id}] ${job.status}${job.attempts ? ` (attempt ${job.attempts})` : ''}`))

const job = worker.enqueue({
  dbPath: args.db,
  period: args.period,
  from: args.from,
  to: args.to,
  title: args.title,
  outDir: args.out,
  htmlOnly: args['html-only'],
})
const done = await worker.waitFor(job.id)
if (done.status === 'done') {
  console.log(`Wrote ${done.outputPath}`)
} else {
  console.error(`Report failed: ${done.error}`)
  process.exitCode = 1
}
