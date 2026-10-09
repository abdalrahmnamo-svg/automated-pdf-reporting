import fs from 'node:fs'
import path from 'node:path'
import { openDb, loadConversations } from '../db.js'
import { resolvePeriod } from '../period.js'
import { buildReportModel } from '../kpi/index.js'
import { buildReportHtml } from './template.js'
import { renderPdf } from './render.js'

export const DEFAULT_TITLE = 'Support Performance Report'

/** DB -> KPI model -> HTML. Pure apart from reading the database. */
export function buildHtmlForPeriod({ dbPath, period, from, to, title, generatedOn }) {
  const range = resolvePeriod({ period, from, to })
  const db = openDb(dbPath, { readOnly: dbPath !== ':memory:' })
  try {
    const conversations = loadConversations(db, range.from, range.to)
    const model = buildReportModel(conversations, range)
    const html = buildReportHtml({
      title: title || process.env.REPORT_TITLE || DEFAULT_TITLE,
      periodLabel: range.label,
      model,
      generatedOn,
    })
    return { html, model, label: range.label }
  } finally {
    db.close()
  }
}

/**
 * Generate the report for a period and write it to outDir.
 * @returns {Promise<{outputPath:string, label:string, model:object}>}
 */
export async function generateReport({ htmlOnly = false, outDir = 'output', signal, ...opts }) {
  const { html, model, label } = buildHtmlForPeriod(opts)
  fs.mkdirSync(outDir, { recursive: true })
  const base = path.join(outDir, `report-${label}`)
  if (htmlOnly) {
    fs.writeFileSync(`${base}.html`, html, 'utf8')
    return { outputPath: `${base}.html`, label, model }
  }
  const pdf = await renderPdf(html, { signal })
  fs.writeFileSync(`${base}.pdf`, pdf)
  return { outputPath: `${base}.pdf`, label, model }
}
