import { parseArgs } from 'node:util'

/** Load .env if present (Node >= 20.12). Missing file is fine. */
export function loadEnv() {
  try {
    process.loadEnvFile()
  } catch {
    /* no .env */
  }
}

export function parseReportArgs(argv, extra = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      period: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      title: { type: 'string' },
      db: { type: 'string' },
      out: { type: 'string', default: 'output' },
      'html-only': { type: 'boolean', default: false },
      ...extra,
    },
    allowPositionals: false,
  })
  return values
}
