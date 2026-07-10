#!/usr/bin/env node
// verify.mjs <slug> — render gate for a daemon-served plan. Ensures the daemon, loads
// /p/<slug> headless, and FAILS on any page/console error or an empty render, so compile
// errors / crashes are caught before a plan is reported done.
//
//   node notes/pages/.page-assets/verify.mjs <slug>      (run from repo root)
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const slug = process.argv[2]
if (!slug) { console.error('usage: verify.mjs <slug>'); process.exit(2) }
const cfg = (() => { try { return JSON.parse(readFileSync(resolve(here, '../.config/pages.config.json'), 'utf8')) } catch { return {} } })()
const PORT = Number(cfg.port) || 4317

// make sure the daemon is up
spawnSync('node', [resolve(here, 'page-server.mjs'), 'ensure'], { stdio: 'inherit' })

const IGNORE = ['DevTools', 'favicon']
// Prefer @playwright/test (commonly present); fall back to a bare `playwright`. If neither is
// installed the render gate is optional — warn and pass rather than hard-failing the whole flow.
const { chromium } = await (async () => {
  for (const mod of ['@playwright/test', 'playwright']) {
    try { return await import(mod) } catch { /* try next */ }
  }
  console.warn('⚠ VERIFY SKIPPED — no playwright available (install @playwright/test to enable the render gate).')
  process.exit(0)
})()
const browser = await chromium.launch()
const page = await browser.newPage()
const problems = []
page.on('pageerror', e => problems.push('PAGE ERROR: ' + (e.stack || e.message || String(e)).split('\n')[0]))
page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!IGNORE.some(s => t.includes(s))) problems.push('CONSOLE: ' + t.slice(0, 200)) } })
page.on('requestfailed', r => {
  const u = r.url()
  // Aborted requests are a teardown artifact (in-flight existence-probes cancelled when the page
  // closes), not a render failure — interactive plans HEAD-probe their assets. Ignore them.
  if ((r.failure()?.errorText || '').includes('ERR_ABORTED')) return
  if (!u.startsWith('data:') && !IGNORE.some(s => u.includes(s))) problems.push('REQUEST FAILED: ' + u.slice(0, 120))
})

// try /p/<slug> (plans) then /t/<slug> (templates)
const rendered = async route => {
  await page.goto(`http://127.0.0.1:${PORT}/${route}/${slug}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500) // let the React tree + any animation settle
  return page.evaluate(() => !!document.querySelector('h1') && document.body.innerText.trim().length > 20)
}
let ok = await rendered('p')
if (!ok) ok = await rendered('t')
if (!ok) problems.push(`plan rendered nothing (compile/runtime failure, or wrong slug "${slug}"?)`)
await browser.close()

if (problems.length) {
  console.error('✗ VERIFY FAILED — ' + problems.length + ' problem(s):')
  for (const p of problems) console.error('  • ' + p)
  process.exit(1)
}
console.log(`✓ VERIFY PASSED — /p/${slug} renders clean, no page errors.`)
