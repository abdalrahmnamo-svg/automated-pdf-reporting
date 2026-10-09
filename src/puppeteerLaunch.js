import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const BASE_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']

const CHROME_BINARY_NAMES = new Set(['chrome.exe', 'chrome', 'Google Chrome for Testing', 'chrome-headless-shell', 'chrome-headless-shell.exe'])

function existing(paths) {
  return paths.filter((p) => {
    try {
      return fs.existsSync(p)
    } catch {
      return false
    }
  })
}

/** @returns {string[]} existing system Chrome/Edge/Chromium paths for the current OS. */
export function systemBrowserCandidates() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return [process.env.PUPPETEER_EXECUTABLE_PATH]
  }
  const candidates = []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA
    const pf = process.env.ProgramFiles
    const pfx86 = process.env['ProgramFiles(x86)']
    if (local) candidates.push(path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    if (pf) candidates.push(path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    if (pfx86) candidates.push(path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    if (pf) candidates.push(path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
    if (pfx86) candidates.push(path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    )
  } else {
    candidates.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge')
  }
  return existing(candidates)
}

/**
 * Puppeteer cache dir. Sandboxed environments sometimes point PUPPETEER_CACHE_DIR at a
 * temp folder with no downloaded browser; fall back to the user cache when Chrome lives there.
 */
export function resolvePuppeteerCacheDir() {
  const userCache = path.join(os.homedir(), '.cache', 'puppeteer')
  const envCache = process.env.PUPPETEER_CACHE_DIR

  if (envCache && hasDownloadedChrome(envCache)) return envCache
  if (hasDownloadedChrome(userCache)) return userCache
  return envCache || userCache
}

export function hasDownloadedChrome(cacheDir) {
  if (!cacheDir) return false
  const chromeRoot = path.join(cacheDir, 'chrome')
  try {
    if (!fs.existsSync(chromeRoot)) return false
    return findChromeExe(chromeRoot) != null
  } catch {
    return false
  }
}

function findChromeExe(dir, depth = 0) {
  if (depth > 6) return null
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isFile() && CHROME_BINARY_NAMES.has(ent.name)) return full
    if (ent.isDirectory()) {
      const nested = findChromeExe(full, depth + 1)
      if (nested) return nested
    }
  }
  return null
}

function isMissingBundledChromeError(err) {
  const msg = String(err?.message || err)
  return msg.includes('Could not find Chrome') || msg.includes('Could not find browser')
}

/** Launch a headless browser for PDF export with sensible fallbacks. */
export async function launchPuppeteerBrowser() {
  const cacheDir = resolvePuppeteerCacheDir()
  if (cacheDir && cacheDir !== process.env.PUPPETEER_CACHE_DIR) {
    process.env.PUPPETEER_CACHE_DIR = cacheDir
  }

  const puppeteer = await import('puppeteer')
  const base = { headless: true, args: BASE_ARGS }

  // An explicit executable path always wins.
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return puppeteer.default.launch({ ...base, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH })
  }

  try {
    return await puppeteer.default.launch(base)
  } catch (err) {
    if (!isMissingBundledChromeError(err)) throw err
  }

  for (const executablePath of systemBrowserCandidates()) {
    try {
      console.warn(`[puppeteer] Bundled Chrome not in cache (${cacheDir}); using ${executablePath}`)
      return await puppeteer.default.launch({ ...base, executablePath })
    } catch (launchErr) {
      console.warn(`[puppeteer] Failed to launch ${executablePath}:`, launchErr.message)
    }
  }

  throw new Error(
    'PDF export needs Chrome, Chromium or Edge. Fix options:\n' +
      '  1. npm run puppeteer:install   (downloads Chrome to ~/.cache/puppeteer)\n' +
      '  2. Set PUPPETEER_EXECUTABLE_PATH in .env to a Chrome/Chromium/Edge binary\n' +
      `Current PUPPETEER_CACHE_DIR: ${process.env.PUPPETEER_CACHE_DIR || '(unset)'}`,
  )
}
