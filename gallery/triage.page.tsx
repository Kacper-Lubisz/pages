/* TRIAGE ROUND TEMPLATE (thread model) — copy this file to notes/pages/<round-slug>.page.tsx and
   replace the sample data. It encodes the round shape the triage skill (~/.claude/skills/triage/
   SKILL.md) documents, rendered on the shared <TriageBoard> (./triage-board): ONE comment-first
   board, one thread per item, keyboard-driven decide-and-advance.

   How it flows:
     • Your cursor lives in a thread's reply box. Type a note, then a modifier+Enter decides AND
       jumps to the next undecided item — Ctrl+Enter = Go, Ctrl+Shift+Enter = No-go, Alt+Enter =
       Defer. The decision buttons are annotated with their hotkeys.
     • The board shows each item's HEADLINE; the full write-up opens from "View full plan →" (and is
       mirrored on the companion <plansSlug> page).
     • A thread can be Resolved → collapsed to a one-line headline (click to peek).
     • Decisions + comments persist to notes/pages/<slug>.state.json — read them back, don't ask in
       chat. Comment text is INSTRUCTIONS: it routinely overrides the recommendation. Items the
       reviewer types into the board itself land in state under `added` (ids prefixed u*).

   Conventions that matter:
     • ids continue the cross-round ledger (m* Slack, d* DM, g* Granola, px-* Linear, e* errors).
     • EVERY item links its source of truth (Slack permalink, Linear URL, Sentry/GCP link, PR).
     • every item carries `rec` + a proposed thread so "Accept all recommendations" is the fast path.
     • cluster work-units: several inputs that are one piece of work share a headline note + links. */
import { Page, Section, P, Callout } from '@page'
import { TriageBoard } from './triage-board'
import type { Item } from './triage-board'

// One flat list — grouping is by each item's `source` chip, not separate streams. Order by
// attention (Go first, then Defer, then No-go) or by priority; the control rail lets you jump.
const ITEMS: Item[] = [
  {
    // id continues the ledger — check the previous round's board/ledger for where numbering left off
    id: 'm42', title: 'One-line task title (what shipping this does)', source: 'Slack', type: 'Bug', pri: 'P2', rec: 'go',
    headline: <>Board headline — the terse version, with the signal (e.g. <strong>37×</strong>, 1 user).</>,
    proposed: {
      t: 'proposed', time: 'Jan 1, 09:00', rec: 'go',
      text: (
        <>
          <strong>The full write-up.</strong> Root-cause hypothesis, which existing work it folds into,
          the concrete fix, and why <strong>Go</strong>. This is what "View full plan →" reveals.
        </>
      ),
      links: [{ label: 'Slack permalink', href: 'https://retainit.slack.com/archives/C.../p...' }],
    },
  },
  {
    id: 'px-0000', title: 'Accept the attached plan for PX-0000', source: 'Linear', type: 'Feature', pri: 'P1', rec: 'go',
    headline: <>PX-0000 — ticket title. What triage is really deciding (accept the plan? scope first?).</>,
    proposed: {
      t: 'proposed', time: 'Jan 1, 10:00', rec: 'go',
      text: (
        <>
          <strong>Summarise the ticket AND the decision.</strong> A GO here = author its plan page and
          start the work. Cross-reference any Slack report that is the same work-unit.
        </>
      ),
      links: [{ label: 'PX-0000 in Linear', href: 'https://linear.app/retainit/issue/PX-0000' }],
    },
  },
  {
    // e* ids: observability findings (from the daily-tasks briefing: GCP errors, Sentry, Dependabot,
    // Linq feedback). A GO is the user's authorization to create the Linear ticket as drafted.
    id: 'e1', title: 'Proposed error ticket — one candidate = one thread', source: 'GCP', type: 'Error', pri: 'P2', rec: 'defer',
    headline: <>37× TypeError in <code>quiz/handlers.ts</code> — new class, first seen 03:12.</>,
    proposed: {
      t: 'proposed', time: 'Jan 1 · 37×', rec: 'defer',
      text: (
        <>
          <strong>Proposed ticket:</strong> "[error] &lt;fingerprint&gt;" — counts, first/last seen,
          suspected cause. GO = create it in Linear. Recommend Defer until it recurs / a user is hit.
        </>
      ),
      links: [{ label: 'Cloud Logging query', href: 'https://console.cloud.google.com/logs/query;query=...' }],
    },
  },
]

export const meta = {
  title: 'Triage round — TEMPLATE',
  owner: 'Kacper',
  created: '2026-01-01',
  status: 'draft',
  icon: '🗂️',
}

export default function TriageTemplate() {
  return (
    <Page
      title="Triage round — TEMPLATE"
      subtitle="Everything that needs a decision this round, one comment-first board. Each item is a thread carrying a recommendation — Accept all recommendations, then override the ones you see differently. Type a reply, then Ctrl+Enter = Go & next, Ctrl+Shift+Enter = No-go & next, Alt+Enter = Defer. Every click persists; comments are read back verbatim as instructions."
      meta={{
        Author: 'Kacper',
        Date: '2026-01-01',
        Sources: 'Slack + Linear + daily briefing', // name every source that fed the round
        Window: 'prev cutoff → this cutoff', // the window; next round starts after this cutoff
      }}
    >
      <Section title="How to use this board">
        <P>
          You're in the <strong>comment-first flow</strong>: your cursor lives in a thread's reply box.
          Type, then{' '}
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl+Enter</kbd>{' '}
          marks Go and jumps to the next undecided item;{' '}
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Ctrl+Shift+Enter</kbd>{' '}
          = No-go,{' '}
          <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px]">Alt+Enter</kbd>{' '}
          = Defer. The decision buttons show these hotkeys. The <strong>bottom-left bar</strong> carries
          the status, progress, a click-to-jump item list, and the key legend. Reply again anytime — the
          box is always at the foot of the thread. <strong>Resolve</strong> collapses a thread to one line.
        </P>
        <Callout tone="info">
          <p>
            State the round's <strong>cutoff</strong> and any <strong>work-unit clusters</strong> (items
            that are one piece of work despite arriving as separate reports) here. The board shows
            headlines; hit <strong>View full plan →</strong> on any item for the full write-up.
          </p>
        </Callout>
      </Section>

      <Section title="Everything to decide">
        {/* plansSlug points at the companion page holding the flat full write-ups (create it as
            <slug>-plans). Drop it if the round is small enough to live entirely in the modals. */}
        <TriageBoard slug="triage-template" items={ITEMS} plansSlug="triage-template-plans" />
      </Section>
    </Page>
  )
}
