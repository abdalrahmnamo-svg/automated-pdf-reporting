import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePeriod, quarterOf, describeRange } from '../src/period.js'

describe('period', () => {
  test('quarter', () => {
    const p = resolvePeriod({ period: '2026-Q1' })
    assert.equal(p.label, '2026-Q1')
    assert.equal(p.from, '2026-01-01T00:00:00.000Z')
    assert.equal(p.to, '2026-04-01T00:00:00.000Z')
    assert.equal(resolvePeriod({ period: '2026-Q4' }).to, '2027-01-01T00:00:00.000Z')
  })
  test('month', () => {
    const p = resolvePeriod({ period: '2026-02' })
    assert.equal(p.from, '2026-02-01T00:00:00.000Z')
    assert.equal(p.to, '2026-03-01T00:00:00.000Z')
  })
  test('from/to is inclusive of the end date', () => {
    const p = resolvePeriod({ from: '2026-01-15', to: '2026-02-10' })
    assert.equal(p.to, '2026-02-11T00:00:00.000Z')
    assert.equal(p.label, '2026-01-15_to_2026-02-10')
  })
  test('rejects bad input', () => {
    assert.throws(() => resolvePeriod({ period: '2026-Q5' }))
    assert.throws(() => resolvePeriod({ period: 'last-week' }))
    assert.throws(() => resolvePeriod({ from: '2026-02-30', to: '2026-03-01' }))
    assert.throws(() => resolvePeriod({ from: '2026-03-02', to: '2026-03-01' }))
    assert.throws(() => resolvePeriod({}))
  })
  test('helpers', () => {
    assert.equal(quarterOf('2026-03-31T23:59:59.000Z'), '2026-Q1')
    assert.equal(quarterOf('2026-04-01T00:00:00.000Z'), '2026-Q2')
    const { from, to } = resolvePeriod({ period: '2026-Q1' })
    assert.match(describeRange({ from, to }), /^1 Jan 2026 .+ 31 Mar 2026$/)
  })
})
