# pages skill — requirements

The load-time `preflight` (`node notes/pages/.page-assets/page-server.mjs preflight`) reports what's
present. It never starts the daemon unless you opt in (below).

## What's needed

1. **Node.js** (for the daemon CLI and the Vite build).
2. **A project with the daemon's runtime deps installed** — the bootstrapped `.app/` runs from the
   host project's `node_modules`, which must provide: `vite`, `@vitejs/plugin-react`, `tailwindcss`,
   `postcss`, `autoprefixer`, `react`, `react-dom`. In a repo that already uses Vite + Tailwind these
   are present. In a repo that doesn't, install them (or install into the bootstrapped `.app/`).
   `preflight` reports `ready: false` when `node_modules/.bin/vite` is missing.

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
