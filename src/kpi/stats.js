/** Small, pure statistics helpers shared by the KPI engine. */

/** @param {number} v */
export function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

const cleanNumbers = (values) =>
  Array.isArray(values) ? values.filter((v) => typeof v === 'number' && !Number.isNaN(v)) : []

/** Statistical median; null for empty input. */
export function median(values) {
  const cleaned = cleanNumbers(values)
  if (cleaned.length === 0) return null
  const sorted = [...cleaned].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Nearest-rank percentile (p in 0..100): the smallest value such that at least
 * p% of the data is <= it. Deterministic and never interpolates.
 */
export function percentile(values, p) {
  const cleaned = cleanNumbers(values)
  if (cleaned.length === 0) return null
  const sorted = [...cleaned].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]
}

/** Symmetric trimmed mean (default 10% each side). */
export function trimmedMean(values, trimPercent = 0.1) {
  const cleaned = cleanNumbers(values)
  if (cleaned.length === 0) return null
  const sorted = [...cleaned].sort((a, b) => a - b)
  const trimCount = Math.floor(sorted.length * trimPercent)
  const trimmed = trimCount < sorted.length - trimCount ? sorted.slice(trimCount, sorted.length - trimCount) : sorted
  return trimmed.reduce((s, v) => s + v, 0) / trimmed.length
}

/**
 * Bayesian shrinkage between an observed value and a prior:
 *   adj = n/(n+k) * value + k/(n+k) * prior
 * Useful for ranking small samples without letting 1-of-1 results dominate.
 */
export function bayesianShrinkage(value, n, prior, k) {
  const safeN = typeof n === 'number' && n > 0 ? n : 0
  const safeK = typeof k === 'number' && k >= 0 ? k : 0
  const denom = safeN + safeK
  if (denom === 0) return typeof prior === 'number' ? prior : 0.5
  if (value == null || Number.isNaN(value)) return typeof prior === 'number' ? prior : 0.5
  return (safeN / denom) * value + (safeK / denom) * prior
}
