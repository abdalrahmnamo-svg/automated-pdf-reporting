import { median, percentile } from './stats.js'

/** CSAT is only reported for an agent once this many ratings exist. */
export const MIN_CSAT_RATINGS = 3
/** A rating counts as "satisfied" at or above this value (scale 1-5). */
export const CSAT_SATISFIED_MIN = 4

/**
 * @typedef {Object} Conversation
 * @property {string} agent
 * @property {string} createdAt            ISO-8601 UTC
 * @property {string|null} firstResponseAt ISO-8601 UTC or null (never answered)
 * @property {boolean} resolved
 * @property {number|null} csat            1-5 or null
 */

/** Seconds from creation to first response; null if unanswered or clock-skewed. */
export function firstResponseSeconds(c) {
  if (!c.firstResponseAt) return null
  const s = (Date.parse(c.firstResponseAt) - Date.parse(c.createdAt)) / 1000
  return Number.isFinite(s) && s >= 0 ? s : null
}

/**
 * KPIs for a set of conversations (one group: whole team, one agent, one month...).
 *  - volume:          number of conversations created
 *  - frtMedianSec/frtP90Sec: median / nearest-rank p90 of first-response time (answered chats only)
 *  - resolutionRate:  resolved / volume, in percent
 *  - csatPct:         ratings >= 4 / ratings, in percent; avgRating = mean rating
 *  Values with no underlying data are null (never NaN, never 0 as a stand-in).
 * @param {Conversation[]} conversations
 * @param {{minCsatRatings?: number}} [opts]
 */
export function computeGroupKpis(conversations, { minCsatRatings = 1 } = {}) {
  const list = Array.isArray(conversations) ? conversations : []
  const volume = list.length
  const frt = list.map(firstResponseSeconds).filter((v) => v != null)
  const ratings = list.map((c) => c.csat).filter((v) => typeof v === 'number')
  const satisfied = ratings.filter((r) => r >= CSAT_SATISFIED_MIN).length
  const enoughRatings = ratings.length >= minCsatRatings && ratings.length > 0
  return {
    volume,
    answeredCount: frt.length,
    frtMedianSec: median(frt),
    frtP90Sec: percentile(frt, 90),
    resolvedCount: list.filter((c) => c.resolved).length,
    resolutionRate: volume ? (list.filter((c) => c.resolved).length / volume) * 100 : null,
    ratingCount: ratings.length,
    csatPct: enoughRatings ? (satisfied / ratings.length) * 100 : null,
    avgRating: enoughRatings ? ratings.reduce((s, r) => s + r, 0) / ratings.length : null,
  }
}

const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

/** Round for display; keeps the raw numbers available on the unrounded object. */
export function roundKpis(k) {
  return {
    ...k,
    frtMedianSec: k.frtMedianSec == null ? null : Math.round(k.frtMedianSec),
    frtP90Sec: k.frtP90Sec == null ? null : Math.round(k.frtP90Sec),
    resolutionRate: round1(k.resolutionRate),
    csatPct: round1(k.csatPct),
    avgRating: k.avgRating == null ? null : Math.round(k.avgRating * 100) / 100,
  }
}

/** UTC calendar-month key, e.g. "2026-02". */
export const monthKey = (iso) => iso.slice(0, 7)

const DAY = 86_400_000

/**
 * Build the full report model for a period.
 * @param {Conversation[]} conversations conversations created in [from, to)
 * @param {{from: string, to: string}} range ISO timestamps (to exclusive)
 */
export function buildReportModel(conversations, range) {
  const list = Array.isArray(conversations) ? conversations : []
  const team = roundKpis(computeGroupKpis(list))

  const agentNames = [...new Set(list.map((c) => c.agent))].sort()
  const agents = agentNames.map((name) => ({
    name,
    ...roundKpis(computeGroupKpis(list.filter((c) => c.agent === name), { minCsatRatings: MIN_CSAT_RATINGS })),
  }))

  // Calendar months touched by the range (even if a month has no data).
  const months = []
  const end = Date.parse(range.to)
  for (let d = new Date(Date.parse(range.from)); d.getTime() < end; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push(d.toISOString().slice(0, 7))
  }
  const byMonth = months.map((key) => ({
    key,
    ...roundKpis(computeGroupKpis(list.filter((c) => monthKey(c.createdAt) === key))),
  }))

  // Volume trend: daily buckets for short ranges, 7-day buckets from the period start otherwise.
  const spanDays = Math.ceil((end - Date.parse(range.from)) / DAY)
  const bucketDays = spanDays <= 21 ? 1 : 7
  const bucketCount = Math.max(1, Math.ceil(spanDays / bucketDays))
  const trend = Array.from({ length: bucketCount }, (_, i) => ({
    start: new Date(Date.parse(range.from) + i * bucketDays * DAY).toISOString().slice(0, 10),
    volume: 0,
  }))
  for (const c of list) {
    const i = Math.floor((Date.parse(c.createdAt) - Date.parse(range.from)) / (bucketDays * DAY))
    if (trend[i]) trend[i].volume += 1
  }

  return { range, empty: list.length === 0, team, agents, months: byMonth, trend, bucketDays }
}
