import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THEME_PATH = path.join(__dirname, 'performanceTheme.css')

let cachedCss = null

/** Canonical report stylesheet (single source of truth for layout and palette). */
export function loadExportThemeCss() {
  if (cachedCss == null) {
    cachedCss = fs.readFileSync(THEME_PATH, 'utf8')
  }
  return cachedCss
}

/** @internal test helper */
export function clearExportThemeCache() {
  cachedCss = null
}
