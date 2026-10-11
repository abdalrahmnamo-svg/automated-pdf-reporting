// Regenerates docs/sample-report.pdf and docs/page-1.png, docs/page-2.png.
//   node scripts/generate-docs.mjs --warehouse path/to/support.duckdb    (the committed sample: warehouse source, 2026-Q2)
//   npm run seed && npm run docs:sample                                  (standalone SQLite demo, 2026-Q1)
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { buildHtmlForPeriod, buildHtmlForWarehouse } from '../src/report/generate.js'
import { renderPdf, renderPageScreenshots } from '../src/report/render.js'

const { values } = parseArgs({ options: { warehouse: { type: 'string' }, period: { type: 'string' } } })
const docsDir = path.resolve('docs')
fs.mkdirSync(docsDir, { recursive: true })

// Fixed "generated" date keeps the sample reproducible.
const generatedOn = '2026-07-01'
const { html } = values.warehouse
  ? await buildHtmlForWarehouse({ warehousePath: values.warehouse, period: values.period || '2026-Q2', generatedOn })
  : buildHtmlForPeriod({ period: values.period || '2026-Q1', generatedOn: '2026-04-01' })
fs.writeFileSync(path.join(docsDir, 'sample-report.pdf'), await renderPdf(html))
const shots = await renderPageScreenshots(html, docsDir)
console.log('Wrote docs/sample-report.pdf and', shots.map((s) => path.relative('.', s)).join(', '))
