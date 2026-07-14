# pages skill — requirements

There is ONE central store + daemon at `~/projects/notes/pages/` (see SKILL.md). The load-time
`preflight` (`node ~/projects/notes/pages/.page-assets/page-server.mjs preflight`) reports what's
present. It never starts the daemon unless you opt in (below).

## First-run scaffold

If `~/projects/notes/pages/` doesn't exist yet, create it once from the skill:

```
node ~/.claude/skills/pages/bootstrap.mjs        # → ~/projects/notes/pages/{.app,.page-assets,templates}
```

## What's needed

1. **Node.js** (for the daemon CLI and the Vite build).
2. **The daemon's runtime deps must be resolvable** — `vite`, `@vitejs/plugin-react`,
   `tailwindcss` (v3 — the shipped postcss config is v3), `postcss`, `autoprefixer`, `react`,
   `react-dom`. Because `~/projects` is not a JS project (no `node_modules`), the store uses a
   **self-contained** install under `.app/node_modules`. Install it once:
   ```
   npm install --prefix ~/projects/notes/pages/.app --no-save \
     vite @vitejs/plugin-react tailwindcss@3 postcss autoprefixer react react-dom
   ```
   `depsReady()` also falls back to a repo's own `node_modules/.bin/vite` for a legacy project-local
   store. `preflight` reports `ready: false` (with a pointer here) when neither resolves; `ready:
   true` once one does.

## Opt-in autostart

Autostart is **off** by default so a skill load never silently binds port 4317. To let `preflight`
start the daemon on load, set in `~/projects/notes/pages/.config/pages.config.json`:

```json
{ "autostart": true }
```

Otherwise start it on demand with `node ~/projects/notes/pages/.page-assets/page-server.mjs up`.

## Optional — publishing (per project, user sets up)

Publishing is optional and off until configured; the local `http://localhost:4317/p/<slug>` link
covers most use.

- **Vercel** — `vercel` CLI installed + authed (`vercel login`), and a Vercel project to publish to.
  The project name is per-project: set `PAGE_SHARE_PROJECT` or the `pages.config.json` publish target.
- **ngrok** — fallback tunnel when Vercel is unavailable.
- **`gh` CLI** — only for the live `<PrStatus>` component (reads PR state).

## Optional — importing real project components into a page

A page bound to a project (living in `~/projects/notes/pages/<project>/`) can import that project's
real source components. The coupling lives in the **project registry**
`~/projects/notes/pages/.config/projects.json` — one entry per project mapping its name to
`{ root, aliases, tailwindContent }` (see SKILL.md → *Project binding*). A Vite plugin resolves the
aliases per importing page, so one daemon serves pages bound to many projects. A missing/incorrect
entry just means those imports don't resolve or their classes aren't generated — it isn't fatal to
authoring plain (project-agnostic) pages, which need no registry entry at all.
