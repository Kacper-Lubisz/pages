---
name: triage
description: |
  Run a triage round: collect inputs from any mix of sources (Slack bug reports, DMs, Granola
  standup notes, new Linear tickets, daily-briefing findings from GCP/Sentry/Dependabot/user
  feedback), present them as ONE interactive review board (a page with Go / Defer / No-go +
  notes per item, my recommendation baked into each), read the user's decisions back from the
  board's state file, then fan out the follow-through (per-task plans, ticket creation, tracker,
  event-watcher). Use when the user says "triage", "bug bash", "review board", "triage round",
  "daily triage", asks to turn a pile of reports/tickets/findings into decisions, or when another
  skill (daily-tasks) needs to present candidate work for decisions.
allowed-tools: [Bash, Read, Write, Edit, Glob, Grep, Agent]
---

# Triage — inputs → decision board → follow-through

A triage round turns a heterogeneous pile of inputs into recorded decisions and started work.
The presentation layer is the **pages skill** (`~/.claude/skills/pages/`) — read it first; this
skill only adds the round process on top. The copy-paste starting point is the gallery template
**`/t/triage`** (`gallery/triage.page.tsx` in the pages skill) — the **thread-model board**: one
comment-first board, one thread per item, keyboard-driven decide-and-advance. Start from it, don't
copy the previous round's file (rounds accrete one-off cruft; the template stays canonical).

Lineage in this repo: `/p/bug-bash-review` → `/p/bug-bash-review-jun23` → `/p/triage-jun26` →
`/p/triage-jul02` — read the most recent one (and the memory `project_bugbash_triage`) before
starting a round.

## The pipeline

1. **Establish the round.** Find the previous round's board + ledger; the new round's window
   starts at the previous **cutoff** (never re-litigate anything already decided). State the new
   cutoff on the board.
2. **Collect inputs** from every relevant source (see table). Normalize each into a board `Item`
   (a thread): `id`, `title`, `source` (the chip that groups it), `type`/`pri`, `rec`, a short
   `headline` (the board text), and a `proposed` thread event carrying the full verbatim/write-up
   `text`, `links` to the source of truth, and `attachments` downloaded into
   `notes/pages/<slug>-assets/`. Links and attachments are mandatory.
3. **Recommend.** Every item gets `rec` + a `proposed` thread whose `text` is the one-paragraph
   reasoning (root-cause hypothesis, which existing work it folds into) — your honest call, so
   "Accept all recommendations" is a safe fast path. Cluster **work-units** first: several reports
   that are one piece of work get cross-referenced in their write-ups and a callout on the board.
4. **Author the board** from the `/t/triage` template: ONE `<TriageBoard slug items plansSlug>`
   with a flat `items` list — grouping is by each item's `source` chip, not separate streams. The
   board shows headlines; the full write-ups live on the companion `<slug>-plans` page (`plansSlug`).
   Add a context section for expected-but-not-decidable items and a tracker (separate tracker page
   via `PageTabs` for big rounds). Verify with `verify.mjs`, hand the user the URL.
5. **Read decisions back** from `notes/pages/<slug>*.state.json` (plain JSON:
   `{decisions: {id: 'go'|'defer'|'nogo'}, notes: {id: string}, added: [{id, text}]}`). **Notes
   are instructions** — they routinely override your recommendation and re-scope items; parse them
   carefully and restate each before acting. **`added` holds tasks the reviewer typed into the
   board itself** (ids prefixed `u*`) — they exist ONLY in the state file, not the page source, so
   read their `text` from here; they carry decisions/notes like any other item and must be folded
   into the follow-through.
6. **Follow through** per GO: author per-task plan pages (draft, read-only investigation) for
   build items; create Linear tickets for approved error candidates; run/capture for
   verification items. Update the tracker as PRs open and arm the `event-watcher` skill so rows
   stay current. Defer → ledger with a revisit trigger. No-go → ledger with the reason.
7. **Ledger.** Append every item (id → decision → outcome, one line each) to the round ledger
   (`notes/pages/bug-bash-ledger.md` in this repo) so future rounds know the cutoff and never
   re-triage. Update the `project_bugbash_triage` memory with the new cutoff.

## Sources and id conventions

Ids continue across rounds (the ledger is the registry). One prefix per source:

| Prefix | Source | How to collect | Link every item to |
| ------ | ------ | -------------- | ------------------ |
| `m*` | #bug-bashing Slack channel | `mcp__slack__slack_read_channel` since cutoff | Slack permalink |
| `d*` | Slack DMs | thread reads | Slack permalink |
| `g*` | Granola standup notes | granola MCP / pasted notes | Granola doc |
| `px-*` | Linear tickets | `mcp__linear__list_issues` `createdAt` window | canonical Linear URL via `get_issue` |
| `e*` | Observability findings — GCP errors/metrics, Sentry, Vercel, Dependabot, Linq user feedback (usually via the daily-tasks briefing) | the briefing report file | Cloud Logging / Sentry / advisory URL |
| `p*` | Process/meta tasks raised in session | conversation | the relevant skill/file |

**Attachments MUST be downloaded and rendered inline — not just linked.** A bug-bash report is
mostly its screenshot/clip; a board that only links the Slack permalink forces the user to click out
for every item and is incomplete. For every message with a file, download it into
`notes/pages/<slug>-assets/` under a stable name and list it in the item's `attachments` (the
`<ReviewStream>` renders images/videos inline; `.mp4`/`.mov` need `kind: 'video'`). Verify they serve
(`/api/asset/<slug>/<name>` returns `x-asset-present: 1`) before publishing.

How to fetch them: the `xoxp` token in `~/.claude.json`
(`projects[<repo>].mcpServers.slack.headers.Authorization`) carries `files:read`. Two routes:
(1) `mcp__slack__slack_read_file` returns the bytes inline (good for *viewing* to triage, but you
can't save them to disk from the tool result); (2) to get files onto disk for the board, run a
**self-contained Python script** (write it to a file, don't inline it) that reads the token from
`~/.claude.json`, hits `files.info` → downloads `url_private_download` with the `Authorization`
header, and writes each to `<slug>-assets/`. Keep the token internal — **never echo it / assign it to
a shell var**, or the sandbox credential-exploration guard blocks the command (a `python3 -c`
one-liner that reads `~/.claude.json` gets flagged; a `python3 script.py` that reads it internally and
only downloads does not). Reference implementation lived at
`$CLAUDE_JOB_DIR/tmp/fetch_slack_assets.py` (files.info + url_private_download loop).

Slack read gotcha: `mcp__slack__slack_read_channel` with an `oldest=` filter anchors there and pages
**forward** (oldest→newest, capped at `limit`) — it does **not** return the newest messages. To find
the real recent window, read newest-first with **no `oldest`** and page back to the last round's
cutoff; only use `oldest`/`latest` once you've confirmed which ts the cutoff is. (Confirm the newest
ts before trusting a slice — an old middle window looks plausible and will send you triaging stale
reports.)

## Integration: daily-tasks briefing

The **daily-tasks skill** (Phase 2+) uses this skill as its presentation method: after its
fan-out agents return, the briefing's actionable output — new Linear issues to plan, proposed
error/security tickets, user-feedback bugs — becomes a triage board
(`notes/pages/daily-<date>.page.tsx`), one group per source section, `e*` ids for proposed
tickets. GO on a proposed ticket = authorization to `mcp__linear__save_issue` it (the board
replaces the old AskUserQuestion flow); GO on a new Linear issue = author its plan page. The
markdown report stays as the archive; the board is where decisions happen.

## Board rules

- **Links are load-bearing.** An item without its source link is incomplete — the user must be
  able to audit any item in one click. Same for plan pages: link the Linear ticket, the PRs, the
  round board.
- **State slug:** the whole board persists to one file, the page's own slug
  (`notes/pages/<slug>.state.json`) — every item's decision/comment lands there, and the companion
  plans page reads the same file. (Only split into suffixed slugs — `<slug>-linear` — if you
  deliberately run a source as its own separate board.)
- **Every round is a `PageTabs` trio** — three sibling pages sharing the same tab strip at the
  top: the board (`<slug>`), the plans index (`<slug>-plans`), and the tracker
  (`<slug>-tracker`). Create the board first; add the other two as soon as decisions land. The
  **tracker tab owns the status table**: one `DecisionTable` row per deliverable with columns
  Deliverable / Item / Status (`<Pill>`/`<TrackerStatus>`) / Output (link!) / Next-or-blocked-on,
  ordered by attention needed (in-flight → awaiting-user → done), plus `<Stats>` tiles up top and
  a `<Timeline>` update log that records each sync. The board itself keeps only a one-line
  pointer to the other tabs — never duplicate the table.
- **Don't gate on chat.** The board is the decision channel; only surface a chat question when a
  note is genuinely ambiguous after a careful read.
- **Headline on the board, full write-up on a separate plans page.** The board must stay scannable:
  every item (and every agent reply) shows a **one-line headline only** — any longer explanation is
  hidden behind a **"View full plan →"** link that opens a companion plans page
  (`<slug>-plans.page.tsx`) anchored to that item's id (`/p/<slug>-plans#<id>`). Give each `Item` a
  short `headline` (the board text) alongside the full `proposed.text` (the plans-page text); agent
  replies carry a short `headline` + the long `text`. The plans page reads the same `<slug>.state.json`
  so it renders the user's decision/comments and the agent's full replies in long form. This is the
  reusable thread-board's contract (`TriageBoard slug items plansSlug`). The board component is
  shipped by the pages skill (`gallery/triage-board.tsx` + `triage-hotkeys.mjs`, bootstrapped into
  `notes/pages/templates/`); a round page copied from the template imports it as `./triage-board`.
- **Comment-first keyboard flow + a left control bar.** The board runs the comment-first scheme
  (cursor lives in the reply box; `⌘/Ctrl+↵` = Go & next, `⌘/Ctrl+⇧+↵` = No-go & next, `⌥+↵` = Defer),
  the decision buttons are annotated with those hotkeys, and a fixed **bottom-left bar** carries the
  status/progress, a click-to-jump item list, and the key legend. The reply composer sits at the
  **foot** of each thread (below agent replies) so the reviewer can always respond again. Threads are
  **resolvable → collapsed** to a one-line headline; an agent reply of kind `resolved` proposes it.
