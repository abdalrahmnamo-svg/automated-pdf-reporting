import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DuckDBInstance } from '@duckdb/node-api'
import { MIN_CSAT_RATINGS, monthKeys, trendLayout } from './index.js'

/**
 * Warehouse source: the KPIs are computed by SQL (warehouse.sql, warehouse_trend.sql) against the
 * marts of support-analytics-warehouse, using that repo's docs/metrics.md definitions.
 * This module opens the file read-only, binds parameters, and reshapes the rows into the same
 * report model the HTML template already renders. It computes no KPI itself.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
export const KPI_SQL_PATH = path.join(here, 'warehouse.sql')
export const TREND_SQL_PATH = path.join(here, 'warehouse_trend.sql')

/** DuckDB timestamps are naive; the report range is UTC, so pass "YYYY-MM-DD HH:MM:SS". */
const toSqlTimestamp = (iso) => iso.replace('T', ' ').slice(0, 19)

/** BigInt counts and doubles from the driver -> plain numbers; NULL stays null. */
const num = (v) => (v == null ? null : Number(v))

export function resolveWarehousePath(p) {
  const file = path.resolve(p || process.env.WAREHOUSE_PATH || '')
  if (!p && !process.env.WAREHOUSE_PATH) {
    throw new Error('--source warehouse needs --warehouse <path to support.duckdb> (or WAREHOUSE_PATH)')
  }
  if (!fs.existsSync(file)) {
    throw new Error(`Warehouse database not found at ${file}. Build it with the support-analytics-warehouse repo (scripts/run_all).`)
  }
  return file
}

/** Run the KPI SQL for a range and return raw rows (numbers only). Opens the file READ_ONLY. */
export async function queryWarehouse(warehousePath, range) {
  const file = resolveWarehousePath(warehousePath)
  const instance = await DuckDBInstance.create(file, { access_mode: 'READ_ONLY' })
  const conn = await instance.connect()
  try {
    const params = { period_start: toSqlTimestamp(range.from), period_end: toSqlTimestamp(range.to) }
    const kpis = await conn.runAndReadAll(fs.readFileSync(KPI_SQL_PATH, 'utf8'), params)
    const { bucketDays } = trendLayout(range)
    const trend = await conn.runAndReadAll(fs.readFileSync(TREND_SQL_PATH, 'utf8'), { ...params, bucket_days: bucketDays })
    const clean = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' ? v : num(v)])))
    return { kpiRows: clean(kpis.getRowObjects()), trendRows: clean(trend.getRowObjects()) }
  } finally {
    conn.closeSync()
    instance.closeSync()
  }
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

/** One SQL row -> the group shape used by the template (FRT in seconds, rates rounded for display). */
function toGroup(r, { minCsatRatings = 1 } = {}) {
  const csatOk = r.csat_responses >= minCsatRatings && r.csat_responses > 0
  return {
    volume: r.tickets,
    answeredCount: r.answered,
    frtMedianSec: r.frt_p50_minutes == null ? null : Math.round(r.frt_p50_minutes * 60),
    frtP90Sec: r.frt_p90_minutes == null ? null : Math.round(r.frt_p90_minutes * 60),
    resolvedCount: r.resolved,
    resolutionRate: round1(r.resolution_rate_pct),
    slaBreachedCount: r.sla_breached,
    slaBreachPct: round1(r.sla_breach_pct),
    ratingCount: r.csat_responses,
    csatPct: csatOk ? round1(r.csat_pct) : null,
    avgRating: csatOk && r.avg_rating != null ? Math.round(r.avg_rating * 100) / 100 : null,
    qaCount: r.qa_scores,
    qaPassRate: round1(r.qa_pass_rate_pct),
  }
}

const EMPTY_ROW = {
  tickets: 0, answered: 0, frt_p50_minutes: null, frt_p90_minutes: null, resolved: 0, resolution_rate_pct: null,
  sla_breached: 0, sla_breach_pct: null, csat_responses: 0, csat_satisfied: 0, csat_pct: null, avg_rating: null,
  qa_scores: 0, qa_passed: 0, qa_pass_rate_pct: null,
}

/**
 * Reshape SQL rows into the report model. Formatting only: rounding, unit conversion (minutes to
 * seconds for the shared formatter), the display gate on per-agent CSAT, and the trend buckets.
 */
export function buildWarehouseModel({ kpiRows, trendRows }, range) {
  const team = kpiRows.find((r) => r.level === 'team') ?? EMPTY_ROW
  const { bucketDays, trend } = trendLayout(range)
  for (const r of trendRows) if (trend[r.bucket]) trend[r.bucket].volume = r.volume
  return {
    source: 'warehouse',
    range,
    empty: team.tickets === 0,
    team: toGroup(team),
    agents: kpiRows
      .filter((r) => r.level === 'agent')
      .map((r) => ({ name: r.key, ...toGroup(r, { minCsatRatings: MIN_CSAT_RATINGS }) })),
    months: monthKeys(range).map((key) => ({
      key,
      ...toGroup(kpiRows.find((r) => r.level === 'month' && r.key === key) ?? EMPTY_ROW),
    })),
    trend,
    bucketDays,
  }
}

/** Query the warehouse and build the model for a resolved period range. */
export async function loadWarehouseModel(warehousePath, range) {
  return buildWarehouseModel(await queryWarehouse(warehousePath, range), range)
}
