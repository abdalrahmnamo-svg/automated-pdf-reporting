import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { systemBrowserCandidates, resolvePuppeteerCacheDir, hasDownloadedChrome } from '../src/puppeteerLaunch.js'

function withEnv(vars, fn) {
  const prev = {}
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    return fn()
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

describe('puppeteerLaunch', () => {
  test('resolvePuppeteerCacheDir returns a non-empty path', () => {
    const dir = resolvePuppeteerCacheDir()
    assert.equal(typeof dir, 'string')
    assert.ok(dir.length > 0)
  })

  test('PUPPETEER_EXECUTABLE_PATH overrides discovery', () => {
    const list = withEnv({ PUPPETEER_EXECUTABLE_PATH: '/custom/chrome' }, () => systemBrowserCandidates())
    assert.deepEqual(list, ['/custom/chrome'])
  })

  test('system candidates are existing browser binaries only', () => {
    const list = withEnv({ PUPPETEER_EXECUTABLE_PATH: undefined }, () => systemBrowserCandidates())
    for (const p of list) {
      assert.ok(fs.existsSync(p))
      assert.match(p, /chrome|chromium|msedge|edge/i)
    }
  })

  test('finds a downloaded Chrome in an env cache dir and prefers it', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptr-cache-'))
    try {
      assert.equal(hasDownloadedChrome(tmp), false)
      const dir = path.join(tmp, 'chrome', 'win64-0.0.0', 'chrome-win64')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'chrome.exe'), '')
      assert.equal(hasDownloadedChrome(tmp), true)
      assert.equal(withEnv({ PUPPETEER_CACHE_DIR: tmp }, () => resolvePuppeteerCacheDir()), tmp)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('falls back to the env value when no cache holds Chrome', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pptr-empty-'))
    try {
      const resolved = withEnv({ PUPPETEER_CACHE_DIR: tmp }, () => resolvePuppeteerCacheDir())
      const userCache = path.join(os.homedir(), '.cache', 'puppeteer')
      // Either the user cache (when Chrome is installed there) or the empty env dir.
      assert.ok(resolved === tmp || resolved === userCache)
      if (!hasDownloadedChrome(userCache)) assert.equal(resolved, tmp)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})
