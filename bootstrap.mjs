#!/usr/bin/env node
// bootstrap — sync the canonical plan-skill infrastructure (this skill dir) into the
// CENTRAL pages store. The skill is the SOURCE OF TRUTH; the store gets a copy it runs the
// single Vite daemon from. User pages (notes/pages/**/*.page.tsx) and any interactive
// state/assets are NEVER touched — only the infra dirs are written.
//
//   node ~/.claude/skills/pages/bootstrap.mjs [storeParent]
//
// The one argument (or $PAGE_STORE_ROOT, else the default ~/projects) is the dir that
// CONTAINS `notes/` — so the store lands at <storeParent>/notes/pages/. Central default:
// ~/projects → ~/projects/notes/pages/. Pass a repo root to bootstrap a project-local store
// (legacy per-project mode) instead.
//
// Maps:  <skill>/app         → <store>/notes/pages/.app          (Vite app + @page library)
//        <skill>/page-assets → <store>/notes/pages/.page-assets  (daemon scripts, *.mjs only)
//        <skill>/gallery     → <store>/notes/pages/templates     (component gallery, *.page.tsx)
//
// page-server runs this automatically before starting the daemon (when it's down), so a
// daemon (re)start always refreshes the store's infra from the skill. Run it by hand to
// seed a fresh store, or after editing the skill, without waiting for a restart.
import { cpSync, mkdirSync, existsSync, readdirSync, symlinkSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const skill = dirname(fileURLToPath(import.meta.url))
// The parent of `notes/`. Central store lives under ~/projects by default so it is a stable,
// single location that is NOT a git repo (pages can never be committed by accident).
const CENTRAL = resolve(homedir(), 'projects')
const repo = resolve(process.argv[2] || process.env.PAGE_STORE_ROOT || CENTRAL)
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

// The gallery templates, project-bound pages, and sibling component folders live OUTSIDE the Vite
// root (.app), so their bare npm imports (react, react-dom, …) must resolve from the store root.
// Symlink <store>/notes/pages/node_modules → .app/node_modules (the self-contained install) so node
// resolution walking up from those files finds them. Dangling until deps are installed; harmless.
try {
  symlinkSync(join(plans, '.app/node_modules'), join(plans, 'node_modules'), 'dir')
} catch {
  /* EEXIST — already linked */
}

console.log(JSON.stringify({ bootstrapped: true, repo, from: skill, gallery }))
