import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { loadExportThemeCss, clearExportThemeCache } from '../src/report/loadExportTheme.js'
import { buildReportHtml } from '../src/report/template.js'
import { buildReportModel } from '../src/kpi/index.js'

const range = { from: '2026-01-01T00:00:00.000Z', to: '2026-04-01T00:00:00.000Z' }
const sample = [
  { agent: 'Agent Alpha', createdAt: '2026-01-05T10:00:00.000Z', firstResponseAt: '2026-01-05T10:01:00.000Z', resolved: true, csat: 5 },
  { agent: 'Agent Bravo', createdAt: '2026-02-05T10:00:00.000Z', firstResponseAt: '2026-02-05T10:02:00.000Z', resolved: false, csat: null },
]

describe('export theme + template', () => {
  test('loads the canonical CSS with page and component rules', () => {
    clearExportThemeCache()
    const css = loadExportThemeCss()
    assert.match(css, /@page \{ size: A4/)
    assert.match(css, /\.kpi\b/)
    assert.match(css, /\.sheet\b/)
  })

  test('buildReportHtml embeds the theme CSS and escapes text', () => {
    const html = buildReportHtml({
      title: 'Demo <b>Report</b>',
      periodLabel: '2026-Q1',
      model: buildReportModel(sample, range),
      generatedOn: '2026-04-01',
    })
    assert.ok(html.includes('--accent'))
    assert.ok(html.includes('Agent Alpha'))
    assert.ok(!html.includes('<b>Report</b>'))
    assert.ok(html.includes('&lt;b&gt;Report&lt;/b&gt;'))
  })

  test('document is fully self-contained: no images, external URLs, fonts or scripts', () => {
    const html = buildReportHtml({ title: 'T', periodLabel: '2026-Q1', model: buildReportModel(sample, range), generatedOn: '2026-04-01' })
    assert.ok(!/<img\b/i.test(html), 'no <img>')
    assert.ok(!/<script\b/i.test(html), 'no <script>')
    assert.ok(!/@import|@font-face/i.test(loadExportThemeCss()), 'no external font/CSS imports')
    // The only http(s) text allowed is the SVG xmlns declaration.
    const urls = (html.match(/https?:\/\/[^\s"')]+/g) || []).filter((u) => u !== 'http://www.w3.org/2000/svg')
    assert.deepEqual(urls, [])
  })

  test('theme is built on CSS variables (palette lives in :root only)', () => {
    const css = loadExportThemeCss()
    const root = css.match(/:root\s*\{[^}]*\}/)?.[0] ?? ''
    const outside = css.replace(root, '')
    // Hex colours outside :root are limited to plain white.
    const stray = (outside.match(/#[0-9a-fA-F]{3,6}\b/g) || []).filter((h) => !['#fff', '#ffffff'].includes(h.toLowerCase()))
    assert.deepEqual(stray, [])
  })

  // The list of colours to exclude is deliberately NOT stored in this repository.
  // Point THEME_DENY_HEX_FILE at a local file with one hex colour per line to run this check.
  const denyFile = process.env.THEME_DENY_HEX_FILE
  test('theme contains none of the externally supplied deny-listed colours', { skip: !denyFile && 'THEME_DENY_HEX_FILE not set' }, () => {
    const deny = new Set(
      fs.readFileSync(denyFile, 'utf8').split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean),
    )
    assert.ok(deny.size > 0, 'deny list is empty')
    const found = (loadExportThemeCss().match(/#[0-9a-fA-F]{3,6}\b/g) || []).map((h) => h.toLowerCase()).filter((h) => deny.has(h))
    assert.deepEqual(found, [])
  })
})
