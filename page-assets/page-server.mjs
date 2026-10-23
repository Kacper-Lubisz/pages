#!/usr/bin/env node
// page-server — control the always-on plans daemon (Vite). One command the agent runs
// before printing a link, so the link is always live.
//
//   node notes/pages/.page-assets/page-server.mjs <status|ensure|up|down>   (run from repo root)
//
//   status  → prints JSON, exit 0 if up / 1 if down
//   ensure  → up if down (start detached, wait until it answers), else noop   [agent uses this]
//   up      → start detached
//   down    → stop (pidfile)
import { spawn, spawnSync } from 'node:child_process'
import { openSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))   // notes/pages/.page-assets
const repo = resolve(here, '../../..')                 // → repo root
const appDir = resolve(here, '../.app')
// Prefer a self-contained .app install (a non-Vite project can install the daemon's deps into
// .app/node_modules); fall back to the repo's node_modules for Vite-based projects.
const appViteBin = resolve(appDir, 'node_modules/.bin/vite')
const viteBin = existsSync(appViteBin) ? appViteBin : resolve(repo, 'node_modules/.bin/vite')
const config = resolve(appDir, 'vite.config.mjs')

// The skill (~/.claude/skills/pages) is the canonical source of the infra; this project's
// .app/.page-assets/templates are a bootstrapped copy. Refresh them from the skill before
// (re)starting the daemon so improvements to the skill propagate on the next start. No-op if
// the skill isn't installed here — the project copy then stands alone. Override with PAGE_SKILL_DIR.
const bootstrapScript = resolve(process.env.PAGE_SKILL_DIR || resolve(homedir(), '.claude/skills/pages'), 'bootstrap.mjs')
function bootstrap() {
  if (!existsSync(bootstrapScript)) return
  spawnSync(process.execPath, [bootstrapScript, repo], { stdio: 'inherit' })
}
// Per-project config (gitignored), seeded from the skill default by the `configure` step.
// autostart is OFF by default; `port` may override 4317 so two projects can run daemons at once.
const CONFIG = resolve(here, '../.config/pages.config.json')
function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG, 'utf8')) } catch { return {} }
}
const PIDFILE = resolve(here, '.page-server.pid')
const LOG = resolve(here, '.page-server.log')
const PORT = Number(readConfig().port) || 4317
const URL = `http://127.0.0.1:${PORT}/`
function depsReady() {
  return existsSync(viteBin)
}

async function isUp() {
  try { const r = await fetch(URL, { signal: AbortSignal.timeout(800) }); return r.ok } catch { return false }
}
async function waitUp(ms = 20000) {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await isUp()) return true; await new Promise(r => setTimeout(r, 300)) }
  return false
}
function start() {
  const out = openSync(LOG, 'a')
  const child = spawn(viteBin, ['--config', config], { cwd: repo, detached: true, stdio: ['ignore', out, out], env: { ...process.env, PAGE_PORT: String(PORT) } })
  writeFileSync(PIDFILE, String(child.pid))
  child.unref()
  return child.pid
}
function pid() { return existsSync(PIDFILE) ? Number(readFileSync(PIDFILE, 'utf8').trim()) : null }

// QR short links (qr-short-links.mjs) run beside the daemon, on the LAN address, so a phone can
// open short codes. The daemon itself stays on 127.0.0.1. On by default; opt out with
// "shortLinks": false in pages.config.json.
const SHORT_LINKS_SCRIPT = resolve(here, 'qr-short-links.mjs')
const SHORT_LINKS_STATE = resolve(here, '.short-links.json')
const SHORT_LINKS_LOG = resolve(here, '.short-links.log')
function shortLinksState() {
  try {
    const state = JSON.parse(readFileSync(SHORT_LINKS_STATE, 'utf8'))
    process.kill(state.pid, 0) // throws if the process is gone
    return state
  } catch {
    return null
  }
}
async function ensureShortLinks() {
  if (readConfig().shortLinks === false || !existsSync(SHORT_LINKS_SCRIPT)) return null
  const running = shortLinksState()
  if (running) return running
  rmSync(SHORT_LINKS_STATE, { force: true })
  const out = openSync(SHORT_LINKS_LOG, 'a')
  const child = spawn(process.execPath, [SHORT_LINKS_SCRIPT, '--host', 'auto'], { detached: true, stdio: ['ignore', out, out] })
  child.unref()
  for (let i = 0; i < 20; i++) {
    const state = shortLinksState()
    if (state) return state
    await new Promise(r => setTimeout(r, 150))
  }
  return null
}
function stopShortLinks() {
  const state = shortLinksState()
  if (state) { try { process.kill(state.pid) } catch {} }
  rmSync(SHORT_LINKS_STATE, { force: true })
  return Boolean(state)
}

const cmd = process.argv[2]
if (cmd === 'status') {
  const up = await isUp()
  console.log(JSON.stringify({ running: up, port: PORT, url: URL, pid: pid(), shortLinks: shortLinksState()?.base ?? null }))
  process.exit(up ? 0 : 1)
} else if (cmd === 'preflight') {
  // Load-time dependency check. Reports status; does NOT start the daemon unless the
  // per-project config opts in (autostart: true). Always exits 0 — it is informational,
  // not a gate, so it never fails a skill load. See requirements.md.
  const up = await isUp()
  if (up) { console.log(JSON.stringify({ running: true, port: PORT, url: URL, note: 'already up' })); process.exit(0) }
  if (!depsReady()) {
    console.log(JSON.stringify({ running: false, ready: false, note: 'missing deps (no node_modules/.bin/vite) — see pages/requirements.md' }))
    process.exit(0)
  }
  const autostart = readConfig().autostart === true
  if (!autostart) {
    console.log(JSON.stringify({ running: false, ready: true, autostart: false, url: URL, note: 'daemon down — autostart off; run `node notes/pages/.page-assets/page-server.mjs up` (or set autostart:true in notes/pages/.config/pages.config.json)' }))
    process.exit(0)
  }
  bootstrap()
  start()
  const ok = await waitUp()
  const shortLinks = ok ? (await ensureShortLinks())?.base ?? null : null
  console.log(JSON.stringify({ running: ok, port: PORT, url: URL, pid: pid(), shortLinks, autostart: true, note: ok ? 'autostarted' : 'failed to start (see ' + LOG + ')' }))
  process.exit(0)
} else if (cmd === 'up' || cmd === 'ensure') {
  if (await isUp()) {
    const shortLinks = (await ensureShortLinks())?.base ?? null
    console.log(JSON.stringify({ running: true, port: PORT, url: URL, shortLinks, note: 'already up' }))
    process.exit(0)
  }
  bootstrap()
  start()
  const ok = await waitUp()
  const shortLinks = ok ? (await ensureShortLinks())?.base ?? null : null
  console.log(JSON.stringify({ running: ok, port: PORT, url: URL, pid: pid(), shortLinks, note: ok ? 'started' : 'failed to start (see ' + LOG + ')' }))
  process.exit(ok ? 0 : 1)
} else if (cmd === 'down') {
  const p = pid()
  if (p) { try { process.kill(-p) } catch { try { process.kill(p) } catch {} } rmSync(PIDFILE, { force: true }) }
  const shortLinksStopped = stopShortLinks()
  console.log(JSON.stringify({ running: false, stopped: !!p, shortLinksStopped }))
} else {
  console.error('usage: page-server.mjs <preflight|status|ensure|up|down>')
  process.exit(2)
}
