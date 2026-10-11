import fs from 'node:fs'
import path from 'node:path'
import { openDb, loadConversations } from '../db.js'
import { resolvePeriod } from '../period.js'
import { buildReportModel } from '../kpi/index.js'
import { loadWarehouseModel } from '../kpi/warehouse.js'
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
 * Warehouse -> SQL KPI layer -> model -> HTML. The KPIs come from src/kpi/warehouse.sql run against
 * the marts of a support-analytics-warehouse DuckDB file (opened read-only).
 */
export async function buildHtmlForWarehouse({ warehousePath, period, from, to, title, generatedOn }) {
  const range = resolvePeriod({ period, from, to })
  const model = await loadWarehouseModel(warehousePath, range)
  const html = buildReportHtml({
    title: title || process.env.REPORT_TITLE || DEFAULT_TITLE,
    periodLabel: range.label,
    model,
    generatedOn,
  })
  return { html, model, label: range.label }
}

/**
 * Generate the report for a period and write it to outDir.
 * `source` is 'sqlite' (default, the seeded demo database) or 'warehouse' (DuckDB marts).
 * @returns {Promise<{outputPath:string, label:string, model:object}>}
 */
export async function generateReport({ htmlOnly = false, outDir = 'output', signal, source = 'sqlite', ...opts }) {
  if (source !== 'sqlite' && source !== 'warehouse') throw new Error(`Unknown source "${source}" (use sqlite or warehouse)`)
  const { html, model, label } = source === 'warehouse' ? await buildHtmlForWarehouse(opts) : buildHtmlForPeriod(opts)
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
