/* ============================================================================
 * performanceComponents.js - reusable render components for the KPI report.
 * Pure, data-agnostic HTML builders that pair with performanceTheme.css.
 * Aggregation is left to the caller; these functions only turn already
 * computed values into markup. All interpolated text is HTML-escaped.
 * ========================================================================== */
import { loadExportThemeCss } from './loadExportTheme.js'

/** Escape text for safe interpolation into HTML. */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Read the paired theme CSS (inline it into <style>). */
export function loadTheme() {
  return loadExportThemeCss()
}

/** Wrap body markup in a full self-contained A4 HTML document. */
export function page({ css, body, title = 'Report' }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`
}

/** One A4 sheet (a printed page). */
export const sheet = (inner, footerLeft = '', footerRight = '') =>
  `<section class="sheet">${inner}<div class="foot"><span>${esc(footerLeft)}</span><span>${esc(footerRight)}</span></div></section>`

/* ---------------- formatting helpers ---------------- */
const DASH = '—'
export const fmt = {
  sec(s) {
    if (s == null) return DASH
    return s < 90 ? `${Math.round(s)}s` : s < 5400 ? `${Math.round(s / 6) / 10} min` : `${Math.round(s / 360) / 10} h`
  },
  pct(v) {
    return v == null ? DASH : `${v.toFixed(1)}%`
  },
  num(v, digits = 2) {
    return v == null ? DASH : v.toFixed(digits)
  },
  int(v) {
    return v == null ? DASH : String(v)
  },
}

/**
 * Colour-coded trend cell: first vs last non-null value.
 * kind: 'int' | 'pct' | 'sec' | 'num'. db = deadband. goodWhen: 'up' | 'down' (which direction is good).
 */
export function rowTrend(kind, vals, db = 0, goodWhen = 'up') {
  const pts = vals.filter((x) => x != null)
  if (pts.length < 2) return '<span class="flat">·</span>'
  const d = pts[pts.length - 1] - pts[0]
  const r1 = Math.round(d * 10) / 10
  const flat = Math.abs(d) <= db
  const good = goodWhen === 'up' ? d > 0 : d < 0
  const cls = flat ? 'flat' : good ? 'up' : 'down'
  const arrow = flat ? '→' : d > 0 ? '↑' : '↓'
  let ds
  if (kind === 'sec') ds = `${d > 0 ? '+' : ''}${Math.round(d)}s`
  else if (kind === 'pct') ds = `${r1 > 0 ? '+' : ''}${r1} pp`
  else if (kind === 'num') ds = `${d > 0 ? '+' : ''}${Math.round(d * 100) / 100}`
  else ds = `${d > 0 ? '+' : ''}${Math.round(d)}`
  return `<span class="${cls}">${arrow} ${ds}</span>`
}

/* ---------------- structural components ---------------- */
export const cover = ({ eyebrow, title, period, range }) =>
  `<div class="cover"><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1>`
  + `<div class="period">${esc(period)}</div><div class="range">${esc(range)}</div></div>`
export const section = (title) => `<h2>${esc(title)}</h2>`
export const sub = (title) => `<h3>${esc(title)}</h3>`
/** note body is trusted markup built by callers from escaped parts. */
export const note = (html, variant = '') => `<div class="note ${esc(variant)}">${html}</div>`

/** Rating pill. */
const BAND = { Excellent: 'b-exc', Good: 'b-good', Fair: 'b-fair', Low: 'b-low', 'No data': 'b-nd', 'Low n': 'b-nd' }
export const badge = (label) => `<span class="badge ${BAND[label] || 'b-nd'}">${esc(label)}</span>`

/** Horizontal bar. cls: '' | 'good' | 'warn' | 'bad'. */
export const bar = (pct, cls = '') => {
  const w = Math.max(0, Math.min(100, pct || 0))
  return `<span class="bar ${cls}"><i style="width:${w}%"></i></span>`
}

/** KPI card grid. cards: [{v, l, s?}] (values are escaped). */
export const metricCards = (cards) =>
  `<div class="kpis">${cards
    .map((c) => `<div class="kpi"><div class="v">${esc(c.v)}</div><div class="l">${esc(c.l)}</div>${c.s ? `<div class="s">${esc(c.s)}</div>` : ''}</div>`)
    .join('')}</div>`

/**
 * Standard table. head: [{t, align}], rows: [[string | {v, align, html}]].
 * Cell values are escaped unless the cell object sets html:true.
 */
export function dataTable({ head, rows }) {
  const cls = (a) => (a === 'r' ? 'r' : a === 'c' ? 'c' : '')
  const th = `<thead><tr>${head.map((h) => `<th class="${cls(h.align)}">${esc(h.t)}</th>`).join('')}</tr></thead>`
  const tr = rows
    .map(
      (r) =>
        `<tr>${r
          .map((c) => {
            const obj = typeof c === 'object' && c !== null
            const v = obj ? c.v : c
            return `<td class="${obj ? cls(c.align) : ''}">${obj && c.html ? v : esc(v)}</td>`
          })
          .join('')}</tr>`,
    )
    .join('')
  return `<table>${th}<tbody>${tr}</tbody></table>`
}

/**
 * Generic period-by-period matrix.
 * cols: [labels]; rows: [{label, cells:[str], total:str, trend:html}]
 */
export function matrixTable({ title, cols, rows, trendHeader, totalHeader = 'Period', caption }) {
  const header = `<thead><tr><th>Metric</th>${cols.map((c) => `<th class="r">${esc(c)}</th>`).join('')}`
    + `<th class="r">${esc(totalHeader)}</th><th class="r">${esc(trendHeader || 'Trend')}</th></tr></thead>`
  const body = rows
    .map(
      (rw) =>
        `<tr><td class="m">${esc(rw.label)}</td>${rw.cells.map((c) => `<td class="r">${esc(c)}</td>`).join('')}`
        + `<td class="r tot">${esc(rw.total)}</td><td class="r">${rw.trend}</td></tr>`,
    )
    .join('')
  return (title ? `<h2>${esc(title)}</h2>` : '')
    + `<table class="mtx">${header}<tbody>${body}</tbody></table>`
    + (caption ? `<div class="small">${esc(caption)}</div>` : '')
}

/**
 * Inline-SVG line + area chart. points: [{label, value}]. No external assets.
 */
export function lineChart({ points, width = 680, height = 210, yLabel = '' }) {
  const m = { top: 14, right: 14, bottom: 30, left: 36 }
  const iw = width - m.left - m.right
  const ih = height - m.top - m.bottom
  const maxV = Math.max(1, ...points.map((p) => p.value))
  const niceMax = (() => {
    const mag = 10 ** Math.floor(Math.log10(maxV))
    const n = maxV / mag
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag
  })()
  const x = (i) => m.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw)
  const y = (v) => m.top + ih - (v / niceMax) * ih
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const v = niceMax * f
      return `<line class="grid" x1="${m.left}" x2="${width - m.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`
        + `<text class="tick" x="${m.left - 6}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`
    })
    .join('')
  const coords = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
  const area = points.length
    ? `<polygon class="area" points="${m.left + (points.length === 1 ? iw / 2 : 0)},${y(0)} ${coords.join(' ')} ${x(points.length - 1).toFixed(1)},${y(0)}"/>`
    : ''
  const line = points.length ? `<polyline class="line" points="${coords.join(' ')}"/>` : ''
  const dots = points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="2.6"/>`).join('')
  const step = Math.max(1, Math.ceil(points.length / 9))
  const ticks = points
    .map((p, i) => (i % step === 0 ? `<text class="tick" x="${x(i).toFixed(1)}" y="${height - 12}" text-anchor="middle">${esc(p.label)}</text>` : ''))
    .join('')
  const yTitle = yLabel
    ? `<text class="tick" x="${m.left}" y="9" text-anchor="start">${esc(yLabel)}</text>`
    : ''
  return `<div class="chart"><svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(yLabel || 'Trend chart')}">`
    + `${grid}<line class="axis" x1="${m.left}" x2="${width - m.right}" y1="${y(0)}" y2="${y(0)}"/>${area}${line}${dots}${ticks}${yTitle}</svg></div>`
}
