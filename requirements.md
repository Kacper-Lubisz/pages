# pages skill — requirements

The load-time `preflight` (`node notes/pages/.page-assets/page-server.mjs preflight`) reports what's
present. It never starts the daemon unless you opt in (below).

## What's needed

1. **Node.js** (for the daemon CLI and the Vite build).
2. **The daemon's runtime deps must be resolvable** — `vite`, `@vitejs/plugin-react`,
   `tailwindcss` (v3 — the shipped postcss config is v3), `postcss`, `autoprefixer`, `react`,
   `react-dom`. `depsReady()` looks in **two** places, in order:
   - `notes/pages/.app/node_modules/.bin/vite` — a **self-contained** install. In a repo that
     isn't Vite-based (e.g. Next.js/pnpm), install there so you don't touch the project's
     `package.json`/lockfile:
     ```
     cd notes/pages/.app && npm install --no-save \
       vite @vitejs/plugin-react tailwindcss@3 postcss autoprefixer react react-dom
     ```
   - else the repo's own `node_modules/.bin/vite` — present already in a Vite + Tailwind repo.
   `preflight` reports `ready: false` (with a pointer here) when neither resolves; `ready: true`
   once one does.

## Opt-in autostart

Autostart is **off** by default so a skill load never silently binds port 4317. To let `preflight`
start the daemon on load, set in the gitignored per-project config
`notes/pages/.config/pages.config.json`:

```json
{ "autostart": true }
```

Otherwise start it on demand with `node notes/pages/.page-assets/page-server.mjs up`.

## Optional — publishing (per project, user sets up)

Publishing is optional and off until configured; the local `http://localhost:4317/p/<slug>` link
covers most use.

- **Vercel** — `vercel` CLI installed + authed (`vercel login`), and a Vercel project to publish to.
  The project name is per-project: set `PAGE_SHARE_PROJECT` or the `pages.config.json` publish target.
- **ngrok** — fallback tunnel when Vercel is unavailable.
- **`gh` CLI** — only for the live `<PrStatus>` component (reads PR state).

## Optional — importing real project components into a page

Pages can import real source components (`@/…`, framework aliases). The alias + Tailwind content
globs are the **coupling config**, seeded from a default and set per project in
`notes/pages/.config/pages.config.json`. Missing/incorrect coupling just means those imports don't
resolve or their classes aren't generated — it isn't fatal to authoring plain pages.
