import * as C from './performanceComponents.js'
import { describeRange } from '../period.js'

const { fmt } = C

function csatBand(a) {
  if (a.csatPct == null) return a.ratingCount > 0 ? 'Low n' : 'No data'
  if (a.csatPct >= 90) return 'Excellent'
  if (a.csatPct >= 80) return 'Good'
  if (a.csatPct >= 70) return 'Fair'
  return 'Low'
}

function resolutionBarClass(rate) {
  return rate == null ? '' : rate >= 90 ? 'good' : rate >= 80 ? '' : rate >= 70 ? 'warn' : 'bad'
}

const monthLabel = (key) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

const dayLabel = (isoDate) =>
  new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const DEFINITIONS = [
  ['Volume', 'Conversations created in the period.'],
  ['First response', 'Seconds from creation to first reply, answered conversations only. Median and nearest-rank 90th percentile.'],
  ['Resolution rate', 'Resolved conversations divided by conversations created.'],
  ['CSAT', 'Share of survey ratings that are 4 or 5 on a 1-5 scale. Shown per agent only with at least 3 ratings.'],
  ['CSAT band', 'Excellent 90%+, Good 80%+, Fair 70%+, otherwise Low (illustrative thresholds).'],
]

/**
 * Build the complete, self-contained report HTML document.
 * @param {{title:string, periodLabel:string, model:ReturnType<import('../kpi/index.js').buildReportModel>, generatedOn?:string}} opts
 */
export function buildReportHtml({ title, periodLabel, model, generatedOn = new Date().toISOString().slice(0, 10) }) {
  const css = C.loadTheme()
  const rangeText = describeRange(model.range)
  const footerLeft = `${title} · ${periodLabel}`
  const footerRight = `Synthetic demo data · generated ${generatedOn}`
  const cover = C.cover({ eyebrow: 'KPI report', title, period: periodLabel, range: rangeText })

  if (model.empty) {
    const body = C.sheet(
      cover
        + C.section('Summary')
        + C.metricCards([
          { v: '—', l: 'Conversations' },
          { v: '—', l: 'Median first response' },
          { v: '—', l: 'Resolution rate' },
          { v: '—', l: 'CSAT' },
        ])
        + C.note(`<strong>No data for this period.</strong><br>No conversations were created between ${C.esc(rangeText)}. Pick a different period or seed more data.`, 'empty'),
      footerLeft,
      footerRight,
    )
    return C.page({ css, body, title: `${title} - ${periodLabel}` })
  }

  const t = model.team
  const page1 = () =>
    cover
    + C.section('Summary')
    + C.metricCards([
      { v: fmt.int(t.volume), l: 'Conversations', s: `${t.answeredCount} answered` },
      { v: fmt.sec(t.frtMedianSec), l: 'Median first response', s: `p90 ${fmt.sec(t.frtP90Sec)}` },
      { v: fmt.pct(t.resolutionRate), l: 'Resolution rate', s: `${t.resolvedCount} resolved` },
      { v: fmt.pct(t.csatPct), l: 'CSAT', s: t.avgRating != null ? `avg ${fmt.num(t.avgRating)} / 5 · ${t.ratingCount} ratings` : 'no ratings' },
    ])
    + C.section('Conversation volume trend')
    + C.lineChart({
      points: model.trend.map((b) => ({ label: dayLabel(b.start), value: b.volume })),
      yLabel: model.bucketDays === 1 ? 'Conversations per day' : `Conversations per ${model.bucketDays}-day bucket`,
    })
    + `<div class="small">${model.bucketDays}-day buckets starting ${C.esc(dayLabel(model.trend[0].start))}; the final bucket may be shorter.</div>`
    + matrix()

  const agentRows = model.agents.map((a) => [
    { v: a.name, html: false },
    { v: fmt.int(a.volume), align: 'r' },
    { v: fmt.sec(a.frtMedianSec), align: 'r' },
    { v: fmt.sec(a.frtP90Sec), align: 'r' },
    { v: `${fmt.pct(a.resolutionRate)}${C.bar(a.resolutionRate, resolutionBarClass(a.resolutionRate))}`, align: 'r', html: true },
    { v: a.csatPct == null ? '—' : `${fmt.pct(a.csatPct)} (${a.ratingCount})`, align: 'r' },
    { v: C.badge(csatBand(a)), align: 'c', html: true },
  ])

  const mCols = model.months.map((m) => monthLabel(m.key))
  const series = (pick) => model.months.map((m) => pick(m))
  const matrixRow = (label, kind, pick, fmtFn, total, goodWhen, db = 0) => ({
    label,
    cells: series(pick).map(fmtFn),
    total: fmtFn(total),
    trend: C.rowTrend(kind, series(pick), db, goodWhen),
  })
  const matrix = () => C.matrixTable({
    title: 'Month by month',
    cols: mCols,
    trendHeader: 'First to last',
    rows: [
      matrixRow('Conversations', 'int', (m) => m.volume, fmt.int, t.volume, 'up', 0),
      matrixRow('Median first response', 'sec', (m) => m.frtMedianSec, fmt.sec, t.frtMedianSec, 'down', 2),
      matrixRow('Resolution rate', 'pct', (m) => m.resolutionRate, fmt.pct, t.resolutionRate, 'up', 0.5),
      matrixRow('CSAT', 'pct', (m) => m.csatPct, fmt.pct, t.csatPct, 'up', 0.5),
    ],
    caption: 'Trend compares the first and last month with data. For first response, lower is better.',
  })

  const page2 =
    C.section('Performance by agent')
    + C.dataTable({
      head: [
        { t: 'Agent' },
        { t: 'Volume', align: 'r' },
        { t: 'Median FRT', align: 'r' },
        { t: 'P90 FRT', align: 'r' },
        { t: 'Resolution', align: 'r' },
        { t: 'CSAT (n)', align: 'r' },
        { t: 'Band', align: 'c' },
      ],
      rows: agentRows,
    })
    + C.section('Definitions')
    + `<dl class="defs">${DEFINITIONS.map(([k, v]) => `<dt>${C.esc(k)}</dt><dd>${C.esc(v)}</dd>`).join('')}</dl>`
    + C.note('All figures in this document come from a seeded synthetic dataset created for demonstration. They describe no real team, customer or organisation.')

  const body = C.sheet(page1(), footerLeft, footerRight) + C.sheet(page2, footerLeft, footerRight)
  return C.page({ css, body, title: `${title} - ${periodLabel}` })
}
