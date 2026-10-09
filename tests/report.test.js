import { describe, test, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { openDb, loadConversations, latestConversationAt } from '../src/db.js'
import { buildHtmlForPeriod, generateReport } from '../src/report/generate.js'
import { launchPuppeteerBrowser } from '../src/puppeteerLaunch.js'
import { renderPdf } from '../src/report/render.js'

const require = createRequire(import.meta.url)
const pdfParse = require('pdf-parse/lib/pdf-parse.js') // direct path: the package index runs a debug block

let chromeError = null
before(async () => {
  try {
    const b = await launchPuppeteerBrowser()
    await b.close()
  } catch (err) {
    chromeError = err.message.split('\n')[0]
  }
})

function seedTiny(db) {
  db.exec(`INSERT INTO agents (id, name) VALUES (1, 'Agent Alpha'), (2, 'Agent Bravo');
    INSERT INTO conversations (id, agent_id, channel, created_at, first_response_at, resolved_at, resolved) VALUES
      (1, 1, 'chat',  '2026-01-10T10:00:00.000Z', '2026-01-10T10:01:00.000Z', '2026-01-10T11:00:00.000Z', 1),
      (2, 2, 'email', '2026-02-10T10:00:00.000Z', '2026-02-10T10:10:00.000Z', NULL, 0),
      (3, 1, 'chat',  '2026-04-01T00:00:00.000Z', NULL, NULL, 0);
    INSERT INTO csat_responses (id, conversation_id, rating, created_at) VALUES (1, 1, 5, '2026-01-10T12:00:00.000Z');`)
}

describe('database loading', () => {
  test('loads conversations in [from, to) with joined agent and csat', () => {
    const db = openDb(':memory:')
    seedTiny(db)
    const rows = loadConversations(db, '2026-01-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z')
    assert.equal(rows.length, 2) // conversation 3 sits exactly on the exclusive upper bound
    assert.equal(rows[0].agent, 'Agent Alpha')
    assert.equal(rows[0].csat, 5)
    assert.equal(rows[0].resolved, true)
    assert.equal(rows[1].csat, null)
    assert.equal(latestConversationAt(db), '2026-04-01T00:00:00.000Z')
    db.close()
  })
})

describe('empty period', () => {
  test('renders a "no data" report instead of crashing', () => {
    const { html, model } = buildHtmlForPeriod({ dbPath: ':memory:', period: '2026-Q1', generatedOn: '2026-04-01' })
    assert.equal(model.empty, true)
    assert.match(html, /No data for this period/)
    assert.match(html, /2026-Q1/)
    assert.ok(!html.includes('NaN') && !html.includes('undefined'))
  })

  test('PDF for an empty period is a valid single-page document', async (t) => {
    if (chromeError) return t.skip(chromeError)
    const { html } = buildHtmlForPeriod({ dbPath: ':memory:', period: '2026-Q1', generatedOn: '2026-04-01' })
    const pdf = await renderPdf(html)
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    const parsed = await pdfParse(pdf)
    assert.equal(parsed.numpages, 1)
    assert.match(parsed.text, /No data for this period/)
  })
})

describe('end-to-end with a seeded file database', () => {
  test('writes HTML and PDF for a period', async (t) => {
    if (chromeError) return t.skip(chromeError)
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'report-e2e-'))
    try {
      const dbPath = path.join(tmp, 'tiny.db')
      const db = openDb(dbPath)
      seedTiny(db)
      db.close()
      const html = await generateReport({ dbPath, period: '2026-Q1', outDir: tmp, htmlOnly: true, generatedOn: '2026-04-01' })
      assert.ok(fs.existsSync(html.outputPath))
      assert.equal(html.model.team.volume, 2)

      const out = await generateReport({ dbPath, period: '2026-Q1', outDir: tmp, generatedOn: '2026-04-01' })
      assert.equal(path.basename(out.outputPath), 'report-2026-Q1.pdf')
      const parsed = await pdfParse(fs.readFileSync(out.outputPath))
      assert.equal(parsed.numpages, 2)
      assert.match(parsed.text, /Performance by agent/)
      assert.match(parsed.text, /Agent Alpha/)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

