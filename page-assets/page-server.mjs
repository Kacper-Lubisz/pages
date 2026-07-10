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
const viteBin = resolve(repo, 'node_modules/.bin/vite')
const config = resolve(here, '../.app/vite.config.mjs')

// The skill (~/.claude/skills/pages) is the canonical source of the infra; this project's
// .app/.page-assets/templates are a bootstrapped copy. Refresh them from the skill before
// (re)starting the daemon so improvements to the skill propagate on the next start. No-op if
// the skill isn't installed here — the project copy then stands alone. Override with PAGE_SKILL_DIR.
const bootstrapScript = resolve(process.env.PAGE_SKILL_DIR || resolve(homedir(), '.claude/skills/pages'), 'bootstrap.mjs')
function bootstrap() {
  if (!existsSync(bootstrapScript)) return
  spawnSync(process.execPath, [bootstrapScript, repo], { stdio: 'inherit' })
}
const PIDFILE = resolve(here, '.page-server.pid')
const LOG = resolve(here, '.page-server.log')
const PORT = 4317
const URL = `http://127.0.0.1:${PORT}/`

// Per-project config (gitignored), seeded from the skill default by the `configure` step.
// autostart is OFF by default: preflight will not bind a port until the user opts in.
const CONFIG = resolve(here, '../.config/pages.config.json')
function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG, 'utf8')) } catch { return {} }
}
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
  const child = spawn(viteBin, ['--config', config], { cwd: repo, detached: true, stdio: ['ignore', out, out] })
  writeFileSync(PIDFILE, String(child.pid))
  child.unref()
  return child.pid
}
function pid() { return existsSync(PIDFILE) ? Number(readFileSync(PIDFILE, 'utf8').trim()) : null }

const cmd = process.argv[2]
if (cmd === 'status') {
  const up = await isUp()
  console.log(JSON.stringify({ running: up, port: PORT, url: URL, pid: pid() }))
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
  console.log(JSON.stringify({ running: ok, port: PORT, url: URL, pid: pid(), autostart: true, note: ok ? 'autostarted' : 'failed to start (see ' + LOG + ')' }))
  process.exit(0)
} else if (cmd === 'up' || cmd === 'ensure') {
  if (await isUp()) { console.log(JSON.stringify({ running: true, port: PORT, url: URL, note: 'already up' })); process.exit(0) }
  bootstrap()
  start()
  const ok = await waitUp()
  console.log(JSON.stringify({ running: ok, port: PORT, url: URL, pid: pid(), note: ok ? 'started' : 'failed to start (see ' + LOG + ')' }))
  process.exit(ok ? 0 : 1)
} else if (cmd === 'down') {
  const p = pid()
  if (p) { try { process.kill(-p) } catch { try { process.kill(p) } catch {} } rmSync(PIDFILE, { force: true }) }
  console.log(JSON.stringify({ running: false, stopped: !!p }))
} else {
  console.error('usage: page-server.mjs <preflight|status|ensure|up|down>')
  process.exit(2)
}
