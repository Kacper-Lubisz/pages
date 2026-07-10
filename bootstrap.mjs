#!/usr/bin/env node
// bootstrap — sync the canonical plan-skill infrastructure (this skill dir) into a
// project's notes/pages/. The skill is the SOURCE OF TRUTH; each project gets a copy
// it runs the Vite daemon from, so module resolution uses the project's own node_modules
// and aliases (@page, @ → apps/web/src, …). User plans (notes/pages/*.page.tsx) and any
// interactive state/assets are NEVER touched — only the infra dirs are written.
//
//   node ~/.claude/skills/pages/bootstrap.mjs [repoRoot]      (default: cwd)
//
// Maps:  <skill>/app         → <repo>/notes/pages/.app          (Vite app + @page library)
//        <skill>/page-assets → <repo>/notes/pages/.page-assets  (daemon scripts, *.mjs only)
//        <skill>/gallery     → <repo>/notes/pages/templates     (component gallery, *.page.tsx)
//
// page-server runs this automatically before starting the daemon (when it's down), so a
// daemon (re)start always refreshes a project's infra from the skill. Run it by hand to
// seed a fresh project, or after editing the skill, without waiting for a restart.
import { cpSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const skill = dirname(fileURLToPath(import.meta.url))
const repo = resolve(process.argv[2] || process.cwd())
const plans = join(repo, 'notes/pages')

// Copy every entry of srcDir into destDir (recursive, overwrite). `filter` restricts which
// top-level entries are copied. We never prune, so a project may keep extra files the skill
// doesn't ship (e.g. user-added gallery demos) — the skill only owns what it writes.
function sync(srcDir, destDir, filter) {
  if (!existsSync(srcDir)) return []
  mkdirSync(destDir, { recursive: true })
  const written = []
  for (const f of readdirSync(srcDir)) {
    if (filter && !filter(f)) continue
    cpSync(join(srcDir, f), join(destDir, f), { recursive: true })
    written.push(f)
  }
  return written
}

sync(join(skill, 'app'), join(plans, '.app'))
sync(join(skill, 'page-assets'), join(plans, '.page-assets'), f => f.endsWith('.mjs'))
// Gallery ships template pages (*.page.tsx) plus the support modules some templates import as
// siblings (e.g. the triage board `triage-board.tsx` + its `triage-hotkeys.mjs` keyboard logic).
// Carry those .tsx/.mjs too so a fresh project can resolve `./triage-board`; skip *.test.mjs.
const gallery = sync(join(skill, 'gallery'), join(plans, 'templates'), f =>
  f.endsWith('.tsx') || (f.endsWith('.mjs') && !f.endsWith('.test.mjs')),
)

console.log(JSON.stringify({ bootstrapped: true, repo, from: skill, gallery }))
