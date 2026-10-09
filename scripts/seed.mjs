// Deterministic synthetic dataset: 6 fictional agents, 3 months (2026-01 .. 2026-03).
// Same seed => byte-identical database contents.
import fs from 'node:fs'
import { openDb, resolveDbPath } from '../src/db.js'

const SEED = 20260101

/** mulberry32: small, fast, deterministic PRNG. */
function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(SEED)
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))
function gauss() {
  const u = Math.max(rand(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}
function pick(weighted) {
  const total = weighted.reduce((s, [, w]) => s + w, 0)
  let r = rand() * total
  for (const [v, w] of weighted) {
    r -= w
    if (r <= 0) return v
  }
  return weighted[weighted.length - 1][0]
}

// Agent profile: baseline median first-response (s), resolve probability, CSAT bias, relative volume.
const AGENTS = [
  { name: 'Agent Alpha', frt: 90, resolve: 0.94, csat: 0.5, volume: 1.15 },
  { name: 'Agent Bravo', frt: 140, resolve: 0.9, csat: 0.25, volume: 1.0 },
  { name: 'Agent Charlie', frt: 210, resolve: 0.86, csat: 0.0, volume: 0.95 },
  { name: 'Agent Delta', frt: 120, resolve: 0.92, csat: 0.35, volume: 1.05 },
  { name: 'Agent Echo', frt: 320, resolve: 0.78, csat: -0.35, volume: 0.85 },
  { name: 'Agent Foxtrot', frt: 180, resolve: 0.88, csat: 0.1, volume: 0.9 },
]
const MONTHS = [
  { start: Date.UTC(2026, 0, 1), days: 31, frtFactor: 1.12, volumeFactor: 0.9 },
  { start: Date.UTC(2026, 1, 1), days: 28, frtFactor: 1.0, volumeFactor: 1.0 },
  { start: Date.UTC(2026, 2, 1), days: 31, frtFactor: 0.88, volumeFactor: 1.15 },
]
const CHANNELS = [
  ['chat', 5],
  ['email', 3],
  ['web-form', 2],
]
const BASE_VOLUME = 32 // conversations per agent per month at volume factor 1.0

const iso = (ms) => new Date(ms).toISOString()

/** Business-hours-biased timestamp within a month (weekday daytime is most likely). */
function randomCreatedAt(month) {
  for (;;) {
    const day = randInt(0, month.days - 1)
    const hour = Math.max(0, Math.min(23, Math.round(13 + gauss() * 3.5)))
    const t = month.start + day * 86_400_000 + hour * 3_600_000 + randInt(0, 3599) * 1000
    const dow = new Date(t).getUTCDay()
    if ((dow === 0 || dow === 6) && rand() < 0.65) continue
    return t
  }
}

const dbPath = resolveDbPath(process.argv[2])
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  try {
    fs.rmSync(dbPath + suffix)
  } catch {
    /* not present */
  }
}
const db = openDb(dbPath)

const insAgent = db.prepare('INSERT INTO agents (id, name) VALUES (?, ?)')
const insConv = db.prepare(
  `INSERT INTO conversations (id, agent_id, channel, created_at, first_response_at, resolved_at, resolved)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)
const insCsat = db.prepare('INSERT INTO csat_responses (id, conversation_id, rating, created_at) VALUES (?, ?, ?, ?)')

db.exec('BEGIN')
AGENTS.forEach((a, i) => insAgent.run(i + 1, a.name))

const convs = []
AGENTS.forEach((agent, ai) => {
  for (const month of MONTHS) {
    const n = Math.max(8, Math.round(BASE_VOLUME * agent.volume * month.volumeFactor + gauss() * 3))
    for (let k = 0; k < n; k++) {
      const created = randomCreatedAt(month)
      const channel = pick(CHANNELS)
      const channelFactor = channel === 'email' ? 3.5 : channel === 'web-form' ? 2 : 1
      const answered = rand() > 0.03
      let frtSec = null
      let firstResponse = null
      if (answered) {
        frtSec = Math.max(5, Math.round(agent.frt * month.frtFactor * channelFactor * Math.exp(gauss() * 0.7)))
        firstResponse = created + frtSec * 1000
      }
      const resolved = answered && rand() < agent.resolve
      const resolvedAt = resolved ? firstResponse + randInt(5 * 60, 36 * 3600) * 1000 : null
      convs.push({ agentId: ai + 1, channel, created, firstResponse, resolvedAt, resolved, frtSec, agent })
    }
  }
})
convs.sort((a, b) => a.created - b.created || a.agentId - b.agentId)

let csatId = 1
convs.forEach((c, idx) => {
  const id = idx + 1
  insConv.run(id, c.agentId, c.channel, iso(c.created), c.firstResponse ? iso(c.firstResponse) : null, c.resolvedAt ? iso(c.resolvedAt) : null, c.resolved ? 1 : 0)
  if (!c.firstResponse) return // unanswered chats never receive a survey
  if (rand() < 0.55) {
    // Latent satisfaction: agent bias, resolution, and speed all nudge the rating.
    let score = 3.9 + c.agent.csat + (c.resolved ? 0.4 : -0.9) - Math.min(1, (c.frtSec ?? 600) / 900) * 0.6 + gauss() * 0.8
    const rating = Math.max(1, Math.min(5, Math.round(score)))
    const at = (c.resolvedAt ?? c.firstResponse) + randInt(60, 7200) * 1000
    insCsat.run(csatId++, id, rating, iso(at))
  }
})
db.exec('COMMIT')

const counts = {
  agents: db.prepare('SELECT COUNT(*) n FROM agents').get().n,
  conversations: db.prepare('SELECT COUNT(*) n FROM conversations').get().n,
  csat: db.prepare('SELECT COUNT(*) n FROM csat_responses').get().n,
}
db.close()
console.log(`Seeded ${dbPath}`)
console.log(`  agents=${counts.agents} conversations=${counts.conversations} csat_responses=${counts.csat}`)
