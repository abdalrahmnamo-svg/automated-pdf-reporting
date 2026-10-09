import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { trimmedMean, median, percentile, bayesianShrinkage, clamp01 } from '../src/kpi/stats.js'
import {
  computeGroupKpis,
  buildReportModel,
  firstResponseSeconds,
  MIN_CSAT_RATINGS,
} from '../src/kpi/index.js'

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`)

/** Conversation created at 2026-02-0<day> 10:00:00Z with an optional first response `frt` seconds later. */
function conv({ agent, day = 1, frt = null, resolved = false, csat = null, month = '02' }) {
  const created = Date.parse(`2026-${month}-0${day}T10:00:00.000Z`)
  return {
    agent,
    createdAt: new Date(created).toISOString(),
    firstResponseAt: frt == null ? null : new Date(created + frt * 1000).toISOString(),
    resolved,
    csat,
  }
}

describe('stats', () => {
  test('median: odd, even, empty', () => {
    assert.equal(median([5, 1, 3]), 3)
    assert.equal(median([1, 2, 3, 4]), 2.5)
    assert.equal(median([]), null)
  })
  test('percentile uses nearest rank', () => {
    assert.equal(percentile([30, 60, 120, 600], 90), 600)
    assert.equal(percentile([10, 20, 30], 90), 30)
    assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9)
    assert.equal(percentile([7], 90), 7)
    assert.equal(percentile([], 90), null)
  })
  test('trimmedMean: empty, untrimmed, 10% trim, NaN ignored', () => {
    assert.equal(trimmedMean([]), null)
    assert.equal(trimmedMean([1, 2, 3, 4, 5], 0), 3)
    assert.equal(trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1), 5.5)
    assert.equal(trimmedMean([1, 2, NaN, 3]), 2)
  })
  test('bayesianShrinkage formula and fallbacks', () => {
    assert.equal(bayesianShrinkage(1.0, 0, 0.5, 8), 0.5)
    assert.equal(bayesianShrinkage(0.8, 5, 0.5, 0), 0.8)
    close(bayesianShrinkage(1.0, 4, 0.5, 8), (4 / 12) * 1 + (8 / 12) * 0.5)
    assert.equal(bayesianShrinkage(null, 5, 0.7, 8), 0.7)
  })
  test('clamp01', () => {
    assert.equal(clamp01(-1), 0)
    assert.equal(clamp01(2), 1)
    assert.equal(clamp01(0.5), 0.5)
    assert.equal(clamp01(NaN), 0)
  })
})

// Hand-made fixture. Agent "A": 5 chats, FRT [30,60,120,600,none], resolved [y,y,y,n,n], csat [5,4,2,-,-].
// Agent "B": 3 chats, FRT [10,20,30], all resolved, csat [5,5,-].
const A = [
  conv({ agent: 'A', frt: 30, resolved: true, csat: 5 }),
  conv({ agent: 'A', frt: 60, resolved: true, csat: 4 }),
  conv({ agent: 'A', frt: 120, resolved: true, csat: 2 }),
  conv({ agent: 'A', frt: 600 }),
  conv({ agent: 'A' }),
]
const B = [
  conv({ agent: 'B', frt: 10, resolved: true, csat: 5 }),
  conv({ agent: 'B', frt: 20, resolved: true, csat: 5 }),
  conv({ agent: 'B', frt: 30, resolved: true }),
]

describe('computeGroupKpis (hand-computed fixture)', () => {
  test('agent A', () => {
    const k = computeGroupKpis(A)
    assert.equal(k.volume, 5)
    assert.equal(k.answeredCount, 4)
    assert.equal(k.frtMedianSec, 90) // median of [30,60,120,600]
    assert.equal(k.frtP90Sec, 600) // ceil(0.9*4) = 4th value
    assert.equal(k.resolutionRate, 60) // 3 of 5
    assert.equal(k.ratingCount, 3)
    close(k.csatPct, (2 / 3) * 100) // ratings 5,4 satisfied; 2 not
    close(k.avgRating, 11 / 3)
  })
  test('team (A + B)', () => {
    const k = computeGroupKpis([...A, ...B])
    assert.equal(k.volume, 8)
    assert.equal(k.frtMedianSec, 30) // [10,20,30,30,60,120,600] -> 4th
    assert.equal(k.frtP90Sec, 600) // ceil(0.9*7) = 7th
    assert.equal(k.resolutionRate, 75) // 6 of 8
    assert.equal(k.csatPct, 80) // ratings 5,4,2,5,5 -> 4 satisfied of 5
    assert.equal(k.avgRating, 4.2)
  })
  test('empty group yields nulls, not NaN or 0', () => {
    const k = computeGroupKpis([])
    assert.equal(k.volume, 0)
    for (const key of ['frtMedianSec', 'frtP90Sec', 'resolutionRate', 'csatPct', 'avgRating']) {
      assert.equal(k[key], null, key)
    }
  })
  test('unanswered chats are excluded from FRT but counted in volume and resolution', () => {
    const k = computeGroupKpis([conv({ agent: 'X' }), conv({ agent: 'X', frt: 50, resolved: true })])
    assert.equal(k.volume, 2)
    assert.equal(k.frtMedianSec, 50)
    assert.equal(k.resolutionRate, 50)
  })
  test('negative (clock-skewed) FRT is ignored', () => {
    assert.equal(firstResponseSeconds({ createdAt: '2026-02-01T10:00:10.000Z', firstResponseAt: '2026-02-01T10:00:00.000Z' }), null)
  })
})

describe('buildReportModel', () => {
  const range = { from: '2026-02-01T00:00:00.000Z', to: '2026-02-08T00:00:00.000Z' }
  const model = buildReportModel([...A, ...B.map((c) => ({ ...c, createdAt: c.createdAt.replace('02-01', '02-03'), firstResponseAt: c.firstResponseAt.replace('02-01', '02-03') }))], range)

  test('per-agent KPIs and CSAT gate', () => {
    const a = model.agents.find((x) => x.name === 'A')
    const b = model.agents.find((x) => x.name === 'B')
    assert.equal(a.frtMedianSec, 90)
    assert.equal(a.csatPct, 66.7)
    assert.equal(MIN_CSAT_RATINGS, 3)
    assert.equal(b.ratingCount, 2)
    assert.equal(b.csatPct, null) // below the 3-rating gate
    assert.deepEqual(model.agents.map((x) => x.name), ['A', 'B'])
  })
  test('short ranges use daily buckets', () => {
    assert.equal(model.bucketDays, 1)
    assert.equal(model.trend.length, 7)
    assert.equal(model.trend[0].volume, 5) // Feb 1: agent A
    assert.equal(model.trend[2].volume, 3) // Feb 3: agent B
    assert.equal(model.trend.reduce((s, b) => s + b.volume, 0), 8)
  })
  test('months cover the full range even when empty', () => {
    const q = buildReportModel(A, { from: '2026-01-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' })
    assert.deepEqual(q.months.map((m) => m.key), ['2026-01', '2026-02', '2026-03'])
    assert.equal(q.months[0].volume, 0)
    assert.equal(q.months[1].volume, 5)
    assert.equal(q.bucketDays, 7)
    assert.equal(q.trend.length, 13)
  })
  test('empty input marks the model empty', () => {
    const m = buildReportModel([], range)
    assert.equal(m.empty, true)
    assert.equal(m.team.volume, 0)
    assert.deepEqual(m.agents, [])
  })
})
