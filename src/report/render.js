import fs from 'node:fs'
import path from 'node:path'
import { launchPuppeteerBrowser } from '../puppeteerLaunch.js'

/** Close the browser if the abort signal fires (used by the worker timeout). */
function closeOnAbort(browser, signal) {
  if (!signal) return () => {}
  const onAbort = () => {
    browser.close().catch(() => {})
  }
  if (signal.aborted) onAbort()
  else signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}

/**
 * Render a self-contained HTML string to a PDF buffer.
 * @param {string} html
 * @param {{signal?: AbortSignal}} [opts]
 * @returns {Promise<Buffer>}
 */
export async function renderPdf(html, { signal } = {}) {
  const browser = await launchPuppeteerBrowser()
  const detach = closeOnAbort(browser, signal)
  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMediaType('print')
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true })
    return Buffer.from(pdf)
  } finally {
    detach()
    await browser.close().catch(() => {})
  }
}

/**
 * Screenshot each `.sheet` (printed page) of the HTML as PNG files: <dir>/page-1.png, page-2.png ...
 * @returns {Promise<string[]>} written file paths
 */
export async function renderPageScreenshots(html, dir, { scale = 1.5 } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const browser = await launchPuppeteerBrowser()
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: scale })
    await page.setContent(html, { waitUntil: 'load' })
    await page.emulateMediaType('print')
    const sheets = await page.$$('.sheet')
    const written = []
    for (let i = 0; i < sheets.length; i++) {
      const file = path.join(dir, `page-${i + 1}.png`)
      await sheets[i].screenshot({ path: file, type: 'png' })
      written.push(file)
    }
    return written
  } finally {
    await browser.close().catch(() => {})
  }
}
