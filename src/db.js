import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const DEFAULT_DB_PATH = path.resolve('data', 'support.db')

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS conversations (
  id                INTEGER PRIMARY KEY,
  agent_id          INTEGER NOT NULL REFERENCES agents(id),
  channel           TEXT NOT NULL,
  created_at        TEXT NOT NULL,          -- ISO-8601 UTC
  first_response_at TEXT,                   -- NULL = never answered
  resolved_at       TEXT,
  resolved          INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS csat_responses (
  id              INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);
`

export function resolveDbPath(p) {
  return path.resolve(p || process.env.DB_PATH || DEFAULT_DB_PATH)
}

/** Open (and create if needed) a database. Use ':memory:' for tests. */
export function openDb(dbPath, { readOnly = false } = {}) {
  if (dbPath === ':memory:') {
    const db = new DatabaseSync(':memory:')
    db.exec(SCHEMA)
    return db
  }
  const file = resolveDbPath(dbPath)
  if (readOnly && !fs.existsSync(file)) {
    throw new Error(`Database not found at ${file}. Run "npm run seed" first.`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  if (!readOnly) db.exec(SCHEMA)
  return db
}

/**
 * Load conversations created in [fromIso, toIso) with their CSAT rating (if any).
 * @returns {{id:number, agent:string, channel:string, createdAt:string, firstResponseAt:string|null,
 *            resolvedAt:string|null, resolved:boolean, csat:number|null}[]}
 */
export function loadConversations(db, fromIso, toIso) {
  const rows = db
    .prepare(
      `SELECT c.id, a.name AS agent, c.channel, c.created_at, c.first_response_at,
              c.resolved_at, c.resolved, s.rating AS csat
         FROM conversations c
         JOIN agents a ON a.id = c.agent_id
         LEFT JOIN csat_responses s ON s.conversation_id = c.id
        WHERE c.created_at >= ? AND c.created_at < ?
        ORDER BY c.created_at, c.id`,
    )
    .all(fromIso, toIso)
  return rows.map((r) => ({
    id: r.id,
    agent: r.agent,
    channel: r.channel,
    createdAt: r.created_at,
    firstResponseAt: r.first_response_at,
    resolvedAt: r.resolved_at,
    resolved: r.resolved === 1,
    csat: r.csat ?? null,
  }))
}

/** Latest conversation timestamp in the DB, or null when empty. */
export function latestConversationAt(db) {
  const row = db.prepare('SELECT MAX(created_at) AS m FROM conversations').get()
  return row?.m ?? null
}
