import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { DuckDBInstance } from '@duckdb/node-api'
import { queryWarehouse, loadWarehouseModel, resolveWarehousePath } from '../src/kpi/warehouse.js'
import { resolvePeriod } from '../src/period.js'
import { buildHtmlForWarehouse, generateReport } from '../src/report/generate.js'
import { parseReportArgs } from '../src/cli/args.js'
import { launchPuppeteerBrowser } from '../src/puppeteerLaunch.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse/lib/pdf-parse.js') // direct path: the package index runs a debug block

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

let chromeError = null
let tmp
let dbPath

/**
 * A tiny warehouse in the shape of the marts (only the columns the KPI SQL reads). Hand-computed
 * expectations below refer to this data.
 *
 * April 2026 tickets (agent, FRT minutes, resolved, FRT SLA breached):
 *   Alpha  2   yes no        Alpha  4  yes no        Alpha 10  no  yes      Alpha 100 yes yes
 *   Bravo  6   yes no        (none) -  no  yes   <- unanswered, unassigned
 * plus: Alpha 8 min, resolved, not breached on 2026-05-01 00:00:00 (inclusive start of May),
 * and two tickets just outside Q2 (2026-03-31 23:59:59 and 2026-07-01 00:00:00) that must be ignored.
 * CSAT answers submitted in April: Alpha 5,4,2  Bravo 5; one answer on 2026-05-02.
 * QA scores in April: Alpha pass,pass,fail  Bravo fail; one score on 2026-05-03.
 */
async function buildFixture(file) {
  const instance = await DuckDBInstance.create(file)
  const conn = await instance.connect()
  await conn.run('create schema marts')
  await conn.run('create table marts.dim_agent (agent_key varchar, agent_name varchar)')
  await conn.run("insert into marts.dim_agent values ('ka', 'Agent Alpha'), ('kb', 'Agent Bravo')")
  await conn.run(`create table marts.fct_tickets (
    ticket_key varchar, agent_key varchar, created_at timestamp, first_response_minutes double,
    is_resolved boolean, is_frt_sla_breached boolean)`)
  await conn.run(`insert into marts.fct_tickets values
    ('t1', 'ka', '2026-04-01 10:00:00', 2,    true,  false),
    ('t2', 'ka', '2026-04-02 10:00:00', 4,    true,  false),
    ('t3', 'ka', '2026-04-09 10:00:00', 10,   false, true),
    ('t4', 'ka', '2026-04-20 10:00:00', 100,  true,  true),
    ('t5', 'kb', '2026-04-08 10:00:00', 6,    true,  false),
    ('t6', NULL, '2026-04-30 10:00:00', NULL, false, true),
    ('t7', 'ka', '2026-05-01 00:00:00', 8,    true,  false),
    ('t8', 'ka', '2026-03-31 23:59:59', 1,    true,  false),
    ('t9', 'ka', '2026-07-01 00:00:00', 1,    true,  false)`)
  await conn.run(`create table marts.fct_csat (
    csat_key varchar, agent_key varchar, rating integer, is_satisfied boolean, submitted_at timestamp)`)
  await conn.run(`insert into marts.fct_csat values
    ('c1', 'ka', 5, true,  '2026-04-03 09:00:00'),
    ('c2', 'ka', 4, true,  '2026-04-04 09:00:00'),
    ('c3', 'ka', 2, false, '2026-04-05 09:00:00'),
    ('c4', 'kb', 5, true,  '2026-04-09 09:00:00'),
    ('c5', 'ka', 1, false, '2026-05-02 09:00:00')`)
  await conn.run(`create table marts.fct_qa_scores (
    qa_score_key varchar, agent_key varchar, total_score integer, is_passed boolean, scored_at timestamp)`)
  await conn.run(`insert into marts.fct_qa_scores values
    ('q1', 'ka', 90, true,  '2026-04-10 09:00:00'),
    ('q2', 'ka', 80, true,  '2026-04-11 09:00:00'),
    ('q3', 'ka', 60, false, '2026-04-12 09:00:00'),
    ('q4', 'kb', 50, false, '2026-04-13 09:00:00'),
    ('q5', 'ka', 70, false, '2026-05-03 09:00:00')`)
  conn.closeSync()
  instance.closeSync()
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-kpi-'))
  dbPath = path.join(tmp, 'tiny.duckdb')
  await buildFixture(dbPath)
  try {
    const b = await launchPuppeteerBrowser()
    await b.close()
  } catch (err) {
    chromeError = err.message.split('\n')[0]
  }
})

after(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

const row = (rows, level, key) => rows.find((r) => r.level === level && r.key === key)

describe('SQL KPI layer on a hand-built DuckDB fixture (period 2026-04)', () => {
  let rows
  before(async () => {
    rows = (await queryWarehouse(dbPath, resolvePeriod({ period: '2026-04' }))).kpiRows
  })

  test('team: volume, FRT p50/p90 (quantile_cont), resolution, SLA breach', () => {
    const t = row(rows, 'team', 'all')
    assert.equal(t.tickets, 6) // includes the unassigned, unanswered ticket
    assert.equal(t.answered, 5)
    assert.equal(t.frt_p50_minutes, 6) // [2,4,6,10,100]
    close(t.frt_p90_minutes, 64) // 10 + 0.6 * (100 - 10): interpolated, not nearest-rank
    assert.equal(t.resolved, 4)
    close(t.resolution_rate_pct, (4 / 6) * 100)
    assert.equal(t.sla_breached, 3) // slow answer x2 + the unanswered ticket
    assert.equal(t.sla_breach_pct, 50)
  })

  test('team: CSAT is the share of 4-5, QA pass rate is passed / scored', () => {
    const t = row(rows, 'team', 'all')
    assert.equal(t.csat_responses, 4) // the May answer is outside the period
    assert.equal(t.csat_satisfied, 3)
    assert.equal(t.csat_pct, 75)
    assert.equal(t.avg_rating, 4)
    assert.equal(t.qa_scores, 4)
    assert.equal(t.qa_passed, 2)
    assert.equal(t.qa_pass_rate_pct, 50)
  })

  test('per agent: unassigned tickets are not in any agent denominator', () => {
    const a = row(rows, 'agent', 'Agent Alpha')
    assert.equal(a.tickets, 4)
    assert.equal(a.frt_p50_minutes, 7) // [2,4,10,100]: halfway between 4 and 10
    close(a.frt_p90_minutes, 73) // 10 + 0.7 * 90
    assert.equal(a.resolution_rate_pct, 75)
    assert.equal(a.sla_breach_pct, 50)
    close(a.csat_pct, (2 / 3) * 100)
    close(a.avg_rating, 11 / 3)
    close(a.qa_pass_rate_pct, (2 / 3) * 100)

    const b = row(rows, 'agent', 'Agent Bravo')
    assert.equal(b.tickets, 1)
    assert.equal(b.frt_p50_minutes, 6)
    assert.equal(b.resolution_rate_pct, 100)
    assert.equal(b.sla_breach_pct, 0)
    assert.equal(b.csat_pct, 100)
    assert.equal(b.qa_pass_rate_pct, 0)

    assert.deepEqual(rows.filter((r) => r.level === 'agent').map((r) => r.key), ['Agent Alpha', 'Agent Bravo'])
  })

  test('month rows and the period boundaries are exact', () => {
    const apr = row(rows, 'month', '2026-04')
    assert.equal(apr.tickets, 6) // 2026-05-01 00:00:00 and 2026-03-31 23:59:59 are both excluded
    assert.equal(rows.filter((r) => r.level === 'month').length, 1)
  })
})

describe('report model from the warehouse source (period 2026-Q2)', () => {
  let model
  before(async () => {
    model = await loadWarehouseModel(dbPath, resolvePeriod({ period: '2026-Q2' }))
  })

  test('team KPIs are rounded for display and FRT is converted to seconds', () => {
    assert.equal(model.source, 'warehouse')
    assert.equal(model.empty, false)
    assert.equal(model.team.volume, 7)
    assert.equal(model.team.frtMedianSec, 420) // answered FRT [2,4,6,8,10,100] min -> median 7 min
    assert.equal(model.team.qaPassRate, 40) // 2 passed of 5 scores in the quarter
    assert.equal(model.team.slaBreachPct, Math.round((3 / 7) * 1000) / 10) // 42.9
  })

  test('months cover the whole quarter, including an empty month', () => {
    assert.deepEqual(model.months.map((m) => m.key), ['2026-04', '2026-05', '2026-06'])
    assert.deepEqual(model.months.map((m) => m.volume), [6, 1, 0])
    assert.equal(model.months[2].frtMedianSec, null) // no data is null, not 0 or NaN
    assert.equal(model.months[2].resolutionRate, null)
    assert.equal(model.months[1].csatPct, 0) // single rating of 1 in May (n gate applies to agents only)
  })

  test('per-agent CSAT is hidden below 3 answers, QA and SLA still shown', () => {
    const alpha = model.agents.find((a) => a.name === 'Agent Alpha')
    const bravo = model.agents.find((a) => a.name === 'Agent Bravo')
    assert.equal(alpha.ratingCount, 4) // 5,4,2 in April + 1 in May
    assert.equal(alpha.csatPct, 50)
    assert.equal(bravo.ratingCount, 1)
    assert.equal(bravo.csatPct, null)
    assert.equal(bravo.qaPassRate, 0)
  })

  test('trend buckets are 7-day buckets from the period start', () => {
    assert.equal(model.bucketDays, 7)
    assert.equal(model.trend.length, 13)
    assert.deepEqual(model.trend.slice(0, 5).map((b) => b.volume), [2, 2, 1, 0, 2])
    assert.equal(model.trend.reduce((s, b) => s + b.volume, 0), 7)
  })
})

describe('warehouse source plumbing', () => {
  test('a period with no tickets renders a "no data" report', async () => {
    const { html, model } = await buildHtmlForWarehouse({ warehousePath: dbPath, period: '2025-Q1', generatedOn: '2026-07-01' })
    assert.equal(model.empty, true)
    assert.match(html, /No data for this period/)
    assert.ok(!html.includes('NaN') && !html.includes('undefined'))
  })

  test('HTML shows the warehouse KPIs and the self-contained theme rules still hold', async () => {
    const { html } = await buildHtmlForWarehouse({ warehousePath: dbPath, period: '2026-Q2', generatedOn: '2026-07-01' })
    for (const text of ['Ticket volume trend', 'QA pass rate', 'First-response SLA breach', 'Agent Alpha', 'quantile_cont']) {
      assert.ok(html.includes(text), text)
    }
    assert.ok(!html.includes('NaN') && !html.includes('undefined'))
    assert.ok(!/<img|<script|\ssrc=|\shref=|url\(\s*['"]?https?:/i.test(html)) // inline SVG xmlns is the only URL
  })

  test('missing warehouse file and unknown source fail with a clear message', async () => {
    assert.throws(() => resolveWarehousePath(path.join(tmp, 'nope.duckdb')), /not found/)
    assert.throws(() => resolveWarehousePath(''), /--warehouse/)
    await assert.rejects(generateReport({ source: 'oracle', period: '2026-Q2' }), /Unknown source/)
  })

  test('the default source stays the SQLite seed', () => {
    assert.equal(parseReportArgs(['--period', '2026-Q1']).source, 'sqlite')
    const v = parseReportArgs(['--source', 'warehouse', '--warehouse', 'x.duckdb', '--period', '2026-Q2'])
    assert.equal(v.source, 'warehouse')
    assert.equal(v.warehouse, 'x.duckdb')
  })

  test('the database is opened read-only (file is not modified)', async () => {
    const before = fs.statSync(dbPath)
    await queryWarehouse(dbPath, resolvePeriod({ period: '2026-Q2' }))
    const after = fs.statSync(dbPath)
    assert.equal(after.mtimeMs, before.mtimeMs)
    assert.equal(after.size, before.size)
    assert.ok(!fs.existsSync(`${dbPath}.wal`))
  })

  test('end to end: PDF from the warehouse source has two pages', async (t) => {
    if (chromeError) return t.skip(chromeError)
    const out = await generateReport({ source: 'warehouse', warehousePath: dbPath, period: '2026-Q2', outDir: tmp, generatedOn: '2026-07-01' })
    assert.equal(path.basename(out.outputPath), 'report-2026-Q2.pdf')
    const parsed = await pdfParse(fs.readFileSync(out.outputPath))
    assert.equal(parsed.numpages, 2)
    // Line breaks depend on the fonts installed (e.g. "Agent\nAlpha" in a narrow column on Linux), so compare
    // the extracted text with all whitespace collapsed to single spaces.
    const text = parsed.text.replace(/\s+/g, ' ')
    assert.match(text, /Performance by agent/)
    assert.match(text, /QA pass rate/)
    assert.match(text, /Agent Alpha/)
  })
})
