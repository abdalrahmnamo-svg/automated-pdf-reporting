/**
 * Period parsing. All ranges are UTC and half-open: [from, to).
 *   "2026-Q1"            -> 2026-01-01 .. 2026-04-01
 *   "2026-03"            -> 2026-03-01 .. 2026-04-01
 *   from "2026-01-15" to "2026-02-10" (inclusive dates) -> 2026-01-15 .. 2026-02-11
 */
const DAY = 86_400_000
const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/

function utc(y, m, d = 1) {
  return Date.UTC(y, m, d)
}

function parseDate(s, label) {
  const m = dateOnly.exec(String(s ?? ''))
  if (!m) throw new Error(`${label} must be YYYY-MM-DD (got "${s}")`)
  const ms = utc(+m[1], +m[2] - 1, +m[3])
  if (new Date(ms).toISOString().slice(0, 10) !== s) throw new Error(`${label} is not a real date: "${s}"`)
  return ms
}

/** @returns {{label: string, from: string, to: string, fromMs: number, toMs: number}} */
export function resolvePeriod({ period, from, to } = {}) {
  let fromMs
  let toMs
  let label
  if (period) {
    const q = /^(\d{4})-Q([1-4])$/i.exec(period)
    const mo = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period)
    if (q) {
      const y = +q[1]
      const startMonth = (+q[2] - 1) * 3
      fromMs = utc(y, startMonth)
      toMs = utc(y, startMonth + 3)
      label = `${y}-Q${q[2]}`
    } else if (mo) {
      fromMs = utc(+mo[1], +mo[2] - 1)
      toMs = utc(+mo[1], +mo[2])
      label = period
    } else {
      throw new Error(`Unrecognised period "${period}" (use YYYY-Qn or YYYY-MM)`)
    }
  } else if (from && to) {
    fromMs = parseDate(from, '--from')
    toMs = parseDate(to, '--to') + DAY
    if (toMs <= fromMs) throw new Error('--to must not be before --from')
    label = `${from}_to_${to}`
  } else {
    throw new Error('Provide --period YYYY-Qn (or YYYY-MM), or both --from and --to')
  }
  return {
    label,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    fromMs,
    toMs,
  }
}

/** Quarter label (YYYY-Qn) containing an ISO timestamp. */
export function quarterOf(iso) {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
}

/** Human-readable inclusive range, e.g. "1 Jan 2026 - 31 Mar 2026". */
export function describeRange({ from, to }) {
  const fmt = (ms) =>
    new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
  return `${fmt(Date.parse(from))} – ${fmt(Date.parse(to) - DAY)}`
}
