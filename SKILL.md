---
name: pages
description: Write a structured page — a plan, design doc, report, investigation/RCA, options doc, or a work summary with an embedded demo — as a React + Tailwind component, served live by a local Vite daemon at http://localhost:4317/p/<name> and publishable to a durable URL via the built-in Share pipeline (Vercel primary, ngrok fallback). Composable primitive library (@page) — sections, ranked cards, side-by-side choices, before/after, diagrams, decision/kv tables, metric stats, RCA timeline, full-width galleries, an interactive review board, and an animated e2e FlowTimeline — plus progress tracking and a live component gallery. There are NO archetype templates: compose each page from the primitives that fit its content, so no two pages are shaped alike. Use whenever the user asks for "a plan", "a page", a design doc, an implementation strategy, a recovery/options doc, a report, an investigation/RCA, a work summary for a PR, or anything similar. Supersedes any in-CLAUDE.md plan-format guidance.
allowed-tools: Bash, Read, Write, Edit
---

# Pages skill

Pages are **React + Tailwind components**, not Markdown or hand-written HTML. A page is a
`*.page.tsx` file in `notes/pages/`; a local **Vite daemon** serves every page at
`http://localhost:4317/p/<name>` with hot-reload. You author by composing the `@page` primitive
library; the user opens a real URL (rich layout, color, live diagrams, animated demos, progress).

A **plan is just one kind of page.** The same system carries design docs, reports, RCAs, triage
boards — and **work-summary pages**: at the end of a task, a page that summarises what shipped
(with a demo — screenshots, a flow video, a before/after — where appropriate). For internal work
the live `http://localhost:4317/p/<slug>` link is all you need. **Only when the page is going
somewhere public — a PR description, a shared link for people outside this session — do you
publish** it via the Share pipeline (see the `pr-workflow` skill). Don't publish otherwise.

## Page server — preflight & status (injected on skill load)

Page server: !`node "$HOME/projects/notes/pages/.page-assets/page-server.mjs" preflight`

The line above is **dynamic-context injection** — the `` !`…` `` command runs automatically when this
skill loads. It runs `preflight`, which **checks** the daemon and prints status JSON but does **not**
start anything by default — autostart is opt-in (see below), so a skill load never silently binds a
port. Read the JSON:

- `{ running: true, … }` — the daemon is already up at **http://localhost:4317** (pages at
  `/p/<slug>`, the gallery at `/t/<slug>`). Nothing to do.
- `{ running: false, ready: true, autostart: false, … }` — deps present but the daemon is down.
  Start it with `node ~/projects/notes/pages/.page-assets/page-server.mjs up` when you're about to
  serve a page.
- `{ running: false, ready: false, … }` — deps missing; see `requirements.md`.

**Opt into autostart** by setting `{ "autostart": true }` in
`~/projects/notes/pages/.config/pages.config.json` — then `preflight` starts the daemon on load like
the old `ensure`. `ensure`/`up` still start it explicitly on demand; `down` stops it.

> ## No templates — compose, don't fill in a skeleton
> There are deliberately **no archetype templates** ("feature", "bugfix", "report", …). They made
> every page come out the same shape — Problem-prose → one diagram → stacks of cards → phased Tasks.
> Instead: read the request, decide what its content actually *is* (a comparison? a timeline? a
> measured win? a flow through screens? a triage?), and reach for the primitive that fits each
> piece. The **content-shape table** below is your guide, not a section order. A good page looks
> unlike the last one because its content is different.

## When to invoke

- The user asks for "a plan", "a page", "design doc", "implementation plan", "recovery plan",
  "options doc", "report", "investigation/RCA", "post-mortem", "audit", or similar.
- You're about to do non-trivial multi-step work and want to align with the user first.
- **You're finishing a task** — write the work-summary page (what shipped, demo, verification).
  Share the localhost link; publish it (and link it on the PR) **only if the work is going public
  via a PR** — not for internal-only summaries.
- A prior page exists and needs updating (edit its `*.page.tsx`; the daemon hot-reloads).

## Where the system lives — ONE central store

There is a **single store and daemon for every project**, at `~/projects/notes/pages/`. You do
**not** create a `notes/` dir inside a repo — all pages, regardless of which project you're standing
in, live centrally. `~/projects` is deliberately **not a git repo**, so pages can never be committed
by accident.

The **source of truth is this skill** (`~/.claude/skills/pages/`, symlinked to the
`claude-skills` repo), version-controlled:

- `app/` — the Vite app. `src/lib/page-ui.tsx` is the **`@page`** primitive library; `src/main.tsx`
  globs the pages (flat + one level of project subdirs) and routes `/` (index) + `/p/<slug>`;
  `vite.config.mjs` (port 4317, the **per-page project alias resolver**, `fs.allow`, the
  `/api/state`, `/api/asset`, `/api/gh`, `/api/share` endpoints); `vite.config.share.mjs`.
- `page-assets/` — `page-server.mjs` (daemon CLI), `verify.mjs` (render gate), `share.mjs`.
- `gallery/` — the live **component gallery**.
- `bootstrap.mjs` — syncs the dirs above into the **central store** (default target `~/projects`, so
  the store lands at `~/projects/notes/pages/`). `page-server` runs it before (re)starting the daemon.

The central store (bootstrapped copy; `.app/`, `.page-assets/`, `templates/`) runs the daemon from
its own self-contained `.app/node_modules` (`~/projects` has no `node_modules` — see
`requirements.md`). Never overwritten by bootstrap:

- `~/projects/notes/pages/*.page.tsx` — **project-agnostic** pages (prose + `@page` primitives + SVG).
  This is the default and the vast majority. (`*.plan.tsx` is the legacy extension — still globbed.)
- `~/projects/notes/pages/<project>/*.page.tsx` — a page **bound to a project**. Its subdir is the
  binding: it routes at `/p/<project>/<slug>` and can `import` that project's real components. See
  **project binding** below.
- `~/projects/notes/pages/<slug>.state.json` — saved state for **interactive** pages
  (`GET/POST /api/state/<slug>`). Plain JSON; safe to read to see the user's decisions.
- `~/projects/notes/pages/<slug>-assets/` — local image/video attachments (`GET /api/asset/…`).
- `~/projects/notes/pages/.config/projects.json` — the **project registry** (below).
- `~/projects/notes/pages/.share/` — Share pipeline output. Scratch.

### Project binding — importing a project's real components

Most pages are project-agnostic and need none of this. When a page must import a project's **real
source components** (`~/…` / `@/…`) or show a live `<PrStatus>`, bind it to that project:

1. Put the file in the project's subdir: `~/projects/notes/pages/<project>/<slug>.page.tsx`.
2. Ensure `<project>` has an entry in `~/projects/notes/pages/.config/projects.json`:
   ```json
   { "monorepo": { "root": "/abs/path/to/repo",
                   "aliases": { "~": "apps/frontend/src" },
                   "tailwindContent": ["apps/frontend/src/**/*.{ts,tsx}"] } }
   ```
   `aliases` maps the project's import prefixes to sub-paths of `root`; `tailwindContent` are that
   project's Tailwind globs (unioned into the daemon's JIT scan so imported classes generate).
3. A Vite plugin resolves those aliases **per importing page** (keyed off the subdir), so one daemon
   serves pages bound to many different projects. Adding a new project = one registry entry + restart.

**To improve the skill, edit the files under `~/.claude/skills/pages/` (the `claude-skills` repo) —
NOT the store's `~/projects/notes/pages/.app` copy, which is overwritten on the next daemon
(re)start.** After editing, run `node ~/.claude/skills/pages/bootstrap.mjs` to refresh the store (the
daemon hot-reloads), or restart the daemon. Read `app/src/lib/page-ui.tsx` for exact prop signatures.

## Creating a page

1. Pick a kebab-case slug (e.g. `webhook-dedup`, `dark-mode`). The file is
   `~/projects/notes/pages/<slug>.page.tsx` (the **central store** — never a `notes/` dir inside a
   repo), served at `http://localhost:4317/p/<slug>`. Only if the page must import a specific
   project's real components, put it in that project's subdir
   (`~/projects/notes/pages/<project>/<slug>.page.tsx`, served at `/p/<project>/<slug>`) and see
   **project binding** above.
2. Open the **component gallery** for copy-paste-ready usage of every primitive:
   `http://localhost:4317/t/components`. Skim it before composing so you reach for the right
   primitive, not just `<Cards>` again.
3. Create the file. Set `export const meta = { title, owner, created, status, icon? }` (the index +
   browser tab use it) and render a `<Page title subtitle meta>…</Page>` tree from `@page`
   primitives. Convert relative dates to absolute (today's date for `created`). `icon` is an optional
   emoji for the favicon/tab (else a colored letter-badge is derived from the slug).
   - **Link the Linear ticket if there is one** (the user mentioned `PX-NNNN`, the branch matches
     `*/px-NNNN-*`, etc.): put it in `meta` and under a References `<Section>`. Fetch the canonical
     URL via `mcp__linear__get_issue` — never hand-roll it. If genuinely ticket-less, omit it.
4. **Compose by content shape, not a fixed outline.** Use the content-shape table below. Vary the
   texture — if you've used three `<Cards>` in a row, the fourth list wants a different primitive.
5. **Print the URL.** The daemon is already running. Optionally confirm with `… page-server.mjs
   status`, then end your message with the clickable `http://localhost:4317/p/<slug>`. The watch
   plugin usually picks a brand-new file up on its own, but that can be unreliable — if the URL 404s
   as `Not found`, restart the daemon (`page-server.mjs down` then `up`) to force a re-glob.
6. For a **plan awaiting approval**: do not set `approved` on `<Page>` yet — plans start in draft
   (tasks render as bullets, progress hidden). Flip it on user approval — see below. Reports and
   work summaries have nothing to approve; `approved` is irrelevant there unless you want the
   progress bar.

## Approval and progress (plans)

Approval is a chat event. When the user approves ("looks good" / "approved" / "start"), set the
prop:

```tsx
<Page approved title=…>      {/* was: <Page title=… > */}
```

That reveals the progress bar and turns every `<Tasks>` list into checkboxes. Mark items
`{ text: '…', done: true }` as you finish them; `<Page>` aggregates `done/total` across all
`<Tasks>` automatically. The daemon hot-reloads — the user just sees it update.

## The `@page` primitive library

Import what you use: `import { Page, Section, P, ... } from '@page'`. (Legacy aliases `@plan`,
`Plan`, `usePlanState`, `PlanMeta` still resolve for pre-rename files.)

- **`<Page title subtitle meta approved>`** — the document shell: header, meta chips, progress bar,
  and (dev daemon only) the **ShareBar** — Vercel/ngrok status chips + the Share menu. Lays out as a
  fixed left sidebar (the "On this page" nav) + a main column that **fills the remaining width** —
  every block spans that same width; nothing breaks out wider. `meta.icon` sets the tab favicon.
- **`<Section title>`** / **`<H3>`** / **`<P>`** / **`<UL>`** / **`<Pre>`** — structure + prose
  (`<P>`/`<UL>` style nested `<code>`, `<strong>`, `<a>`). Pages with 2+ headings below the title
  automatically get the **left "On this page" sidebar column** (persistent on `lg`+ viewports,
  collapsed on narrow ones): a leveled index of every rendered heading — the page `h1`, `<Section>`
  `h2`s, and `h3`/`h4` subheads (`<H3>`, `<Tasks>` titles, `<Markdown>` headings) indented by
  level — with scroll-spy + jump links. Nothing to author, just use real `<Section>`s/`<H3>`s for
  structure. (Headings inside modals and board cards are excluded; boards get their own nav block.)
- **`<PageTabs tabs current>`** / **`<PageLink slug>`** / **`<TrackerStatus s>`** — multi-page
  sets: the tab strip linking sibling pages (a triage round's board / plans / tracker), in-daemon
  links to other pages, and the tracker-status chip vocabulary (`merged` / `in-review` / `branch`
  / `plan` / `awaiting` / `blocked`). See the triage template at `/t/triage` and the **triage
  skill** (`~/.claude/skills/triage/SKILL.md`), which owns the round process.
- **`<Gallery cols={2|3|4}>` + `<GalleryItem label>`** — responsive grid for side-by-side artifacts
  (device mockups, option frames, before/after screens). Each child gets its own cell + real gap.
  Fills the content column like every other block.
- **`<Cards>` + `<Card rank title pills variant>`** — a list where each entry is a paragraph + tags
  (Risks, Open questions, Findings, Considered alternatives). `variant="primary|bad"`; `<Cards flat>`
  drops the rank gutter. Tags via `<Pill tone="primary|good|warn|bad|neutral">`. **Powerful but
  overused** — don't make every list a card-stack.
- **`<Choices cols={2|3}>` + `<Choice title tag recommended pros cons>`** — symmetric N-way option
  comparison. Mark the pick `recommended`. `cols={3}` has room now that content fills the width.
- **`<BeforeAfter before after>`** — temporal compare (today vs proposed / before vs shipped).
- **`<Diagram caption>{<svg>…</svg>}</Diagram>`** — the workhorse. Write raw `<svg>` inside for
  sequence diagrams, banded swimlanes, fan-out, state machines. Caption the **insight**.
- **`<DecisionTable head rows>`** — N×M matrix, **short cells only**. **`<KvTable rows>`** —
  from→to mapping (renames, schema moves, env audits); keep `from`/`to` to short identifiers
  (they're mono) — long prose goes in the wrapping `note` column. Both scroll horizontally within
  the content column when they overflow.
- **`<Mockup bar>`** — chrome-framed UI demo; the body is plain JSX/Tailwind. (You can also
  `import` real app components — `@/…`, `@turbocharge/…` — Vite resolves them.) Note: `<Mockup>`
  clips overflow — keep demo popovers/dropdowns **in flow**, not absolutely positioned.
- **`<Callout tone="info|good|warn">`** — short aside. Budget ≤3 per page.
- **`<Tasks phase title items>`** — checklist; `items: { text, done? }[]`. Group with `phase` chips.
- **`<Stats>` + `<Stat value label tone delta>`** — metric tiles (great for a measured win).
  **`<Timeline items>`** — timestamped events (RCA / post-mortem / chronological report).
- **`<FlowTimeline events duration renderScreen mode>`** — an **animated e2e flow**: a device frame
  with a cursor that animates to each tap, a scrubbable rail of colour-coded events, and a synced
  log. `renderScreen(state)` returns live React screens (`mode="concept"`) or `<img>` screenshots
  (`mode="replay"`). See `/t/e2e-flow`. This is the go-to **demo** block for a work-summary page.
- **`<ReviewStream slug messages>`** + **`usePageState(slug, initial)`** — an **interactive,
  file-backed decision board**; state persists via `/api/state/<slug>`. **Set `slug` to the page's
  own slug.** See `/t/review`. (Read-only in shared static snapshots.)

## Pick the primitive for the shape of the content

| Content shape                                  | Right primitive                                         |
| ---------------------------------------------- | ------------------------------------------------------ |
| Temporal race / interleaved actors             | sequence `<svg>` in `<Diagram>` (vertical time, lifelines) |
| Two phases / async-vs-sync / before-vs-after   | banded-swimlane `<svg>` in `<Diagram>`, or `<BeforeAfter>` |
| Fan-out / fan-in (cardinality is the point)    | `<svg>` with explicit diverging/converging paths       |
| State machine / status flow                    | `<svg>` nodes + labelled edges                          |
| N×M matrix, short cells                        | `<DecisionTable>`                                       |
| from→to mapping (renames, moves)               | `<KvTable>`                                             |
| List of items each with a paragraph + tags     | `<Cards>` (but vary — don't stack 3+ in a row)          |
| 2–3 symmetric options with pros/cons           | `<Choices>` (`cols={3}` for 3-up)                       |
| Several UI mockups / screens side by side      | `<Gallery>`; real components in `<Mockup>`              |
| metrics / a measured win                       | `<Stats>` + `<Stat>`                                    |
| chronological events / RCA                     | `<Timeline>`                                            |
| a stepped flow through screens over time       | `<FlowTimeline>`                                        |
| triaging a list of findings into go/no-go      | `<ReviewStream>`                                        |
| finished work + demo (PR summary)              | `<Stats>` for the win, `<BeforeAfter>`/`<FlowTimeline>` for the demo, `<Tasks done>` for scope |

## Designing diagrams that teach

A bad diagram restates the prose with boxes around the nouns. A good one answers a question prose
can't — *spatial relationships, cardinality, what runs in parallel, what's NEW vs existing, the
seam between phases.* Use accent (blue) for what's **NEW**, muted/dashed for
pre-existing-and-unchanged. Caption the **insight**, not the subject.

**Anti-patterns:** a third `<Cards>` stack in a row; a paragraph crammed into a table cell; a
`<Choices cols={3}>` squashed in the prose column; device mockups that abut/overlap; a `<UL>` where
every `<li>` is 2+ sentences with a `<strong>` label (use `<Cards flat>`); >3 `<Callout>`s; a
"diagram" that's just stacked boxes restating the prose. If you need a new shape repeatedly, add a
primitive to `page-ui.tsx` (in the skill) rather than hand-rolling it in a page.

## Tooling

- **`page-server.mjs <status|ensure|up|down>`** — the daemon (Vite on port 4317). `ensure` is
  idempotent (bootstraps from the skill + starts if down, waits until it answers) and is what runs
  on skill load. `status` prints JSON + exit code (0 up / 1 down). `down` stops it.
- **`bootstrap.mjs [repo]`** — push the skill's infra into a project's `notes/pages/`. Run after
  editing the skill to refresh a live project without a daemon restart.
- **`verify.mjs <slug>`** — render gate: ensures the daemon, loads `/p/<slug>` headless, fails on
  any page/console error or an empty render. Run it before reporting a page done.
- **`share.mjs <cmd>`** — the Share pipeline CLI (below).

## Sharing (publish a page beyond localhost)

**Default to NOT publishing.** The live URL (`http://localhost:4317/p/<slug>`) is the working view
and is enough for almost everything — plans, internal reports, work you're iterating on with the
user, anything that stays inside this session. Publishing pushes the page to a public,
unauthenticated URL on the internet; that is a deliberate escalation, not a routine finishing step.

**Publish only when the page genuinely needs to leave localhost** — the one clear case is attaching
it to a **PR description** so reviewers can open it, or when the user explicitly asks for a shareable
link for someone outside this session. If you're unsure whether a page will be shared publicly,
**don't publish — hand over the localhost link and ask.** When you do need to give others access,
use the **Share pipeline** — from the **ShareBar** at the top of every page (Vercel/ngrok status
chips + a Share menu; dev daemon only, compiled out of exports), or the CLI:

```
node ~/projects/notes/pages/.page-assets/share.mjs publish <slug> [--ttl days]   # → durable public URL
node ~/projects/notes/pages/.page-assets/share.mjs export <slug>                 # bundle only, no upload
node ~/projects/notes/pages/.page-assets/share.mjs ngrok-up | ngrok-down         # fallback tunnel
node ~/projects/notes/pages/.page-assets/share.mjs unpublish <slug> | sweep | status
```

How it works: `export` builds a **self-contained static bundle per page** (a generated single-page
entry — other pages never ship; review state, PR statuses and expiry **baked in**; images/videos
included). `publish` assembles ONE Vercel production deployment carrying **all active shares**
under `/<slug>/` plus an **overview index** at `/`, and deploys with `--prebuilt` (~8s; upload is
content-hash deduped, so videos upload once ever). The stable public URL is
`https://turbocharge-pages.vercel.app` — raw per-deployment URLs sit behind Vercel auth; only the
production alias is public. Default **TTL 14 days** (`--ttl 0` = permanent): pages show their
expiry, and a sweep drops expired shares on the next publish.

**ngrok is the fallback** when Vercel is missing/unauthed/failing: it tunnels a read-only static
server (`:4319`) over the same exported site — **never the Vite daemon** (its `fs.allow` spans the
whole repo). Every failure is structured (`{ ok:false, reason, hint }`) and surfaces as a hint in
the ShareBar.

Shared links are **unlisted, not authenticated** — anyone with the URL can open them, and the
bundle includes compiled JS of any real app components the page imports. Don't publish pages whose
content shouldn't leave the team; `unpublish` when done.

## Work-summary pages (task end)

When a task ships, write a short page that **summarises the finished work**: what changed and why,
the verification story (checks, tests, e2e), and a **demo where appropriate** — `<BeforeAfter>`
screenshots, a `<FlowTimeline>` video of the new flow, or `<Stats>` for a measured win. Share the
localhost link by default. **Publish it and add the URL to the PR description only when the work is
actually going out as a PR** — the `pr-workflow` skill has the exact PR placement — so reviewers get
the story without reconstructing it from the diff. For internal-only summaries, skip the publish;
the localhost link is enough.

## Page files are scratch artifacts

Per CLAUDE.md, page files are **not committed**. Delete `<slug>.page.tsx` (and any sibling assets)
once the page has served its purpose, or ask the user to; `unpublish` its share too. Don't
`git add` them. The skill infra (`app/`, `page-assets/`, `gallery/`, `bootstrap.mjs`) IS
version-controlled in `~/.claude/skills/pages/` — improve it there.

## Finishing a page

After writing the draft: (1) the daemon is already up — optionally `page-server status` to confirm;
(2) optionally `verify.mjs <slug>`; (3) end your message with a one-line summary + the clickable
`http://localhost:4317/p/<slug>` link (plus the published URL if you shared it). After approval and
whenever you flip task `done` flags, the daemon hot-reloads — just re-share the link.
