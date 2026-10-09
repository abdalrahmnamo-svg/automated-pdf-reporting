// Regenerates docs/sample-report.pdf and docs/page-1.png, docs/page-2.png from the seeded database.
//   npm run seed && npm run docs:sample
import fs from 'node:fs'
import path from 'node:path'
import { buildHtmlForPeriod } from '../src/report/generate.js'
import { renderPdf, renderPageScreenshots } from '../src/report/render.js'

const docsDir = path.resolve('docs')
fs.mkdirSync(docsDir, { recursive: true })

// Fixed "generated" date keeps the sample reproducible.
const { html } = buildHtmlForPeriod({ period: '2026-Q1', generatedOn: '2026-04-01' })
fs.writeFileSync(path.join(docsDir, 'sample-report.pdf'), await renderPdf(html))
const shots = await renderPageScreenshots(html, docsDir)
console.log('Wrote docs/sample-report.pdf and', shots.map((s) => path.relative('.', s)).join(', '))
