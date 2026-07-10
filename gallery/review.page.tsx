/* ReviewStream — the interactive, file-backed decision board, shown live. A chat-style stream of
   items, each with a Go / Defer / No-go control + note, plus a round go/no-go gate. Every click
   persists to notes/pages/<slug>.state.json via the dev-server /api/state endpoint, so the agent
   reads the decisions straight back. A component reference, not a flow.

   Using it in a plan:
   1. <ReviewStream slug="my-plan" messages={ITEMS} /> — slug keys the state file + asset folder.
   2. Each item's `attachments` resolve to notes/pages/<slug>-assets/<name> (served via
      /api/asset/<slug>/<file>); a missing file renders a labelled placeholder, not an error. */
import { Page, Section, P, UL, Callout, KvTable, ReviewStream } from '@page'
import type { ReviewMsg } from '@page'

export const meta = { title: 'ReviewStream — decision board', owner: 'kacper', created: '2026-06-22', status: 'reference' }

const ITEMS: ReviewMsg[] = [
  {
    id: 'i1', author: 'Reporter', time: 'day 1, 09:00', type: 'Bug', pri: 'P0',
    rec: 'go', recNote: 'root-caused — ready to build',
    text: 'A short report. Text renders with line breaks preserved.\n\nA second paragraph for good measure.',
    attachments: [{ name: 'screenshot.png' }], // drop into <slug>-assets/screenshot.png
  },
  {
    id: 'i2', author: 'Reporter', time: 'day 1, 11:30', type: 'Feature', pri: 'P2',
    rec: 'defer', recNote: 'backlog', flag: 'needs-image',
    text: 'An item awaiting a screenshot — the flag pill signals what is missing.',
    attachments: [{ name: 'clip.mp4', kind: 'video' }],
  },
  {
    id: 'i3', author: 'Reporter', time: 'day 2, 08:15', type: 'Note', pri: '—',
    rec: 'nogo', recNote: "reporter's own note — discard",
    text: 'A No-go dims the card. Items can also carry links and a threaded reply:',
    links: [{ label: 'example.com', href: 'https://example.com' }],
    replies: [{ author: 'You', time: 'day 2, 08:20', text: 'Agreed — closing this out.' }],
  },
]

export default function ReviewGallery() {
  return (
    <Page
      title="ReviewStream — interactive decision board"
      subtitle="A live <ReviewStream>. Click Go / Defer / No-go on each item, jot notes, then flip the round gate — every click saves to this page's state.json. The same component, populated with real items, is how you run a triage."
      meta={{ Owner: 'kacper', Component: '<ReviewStream> · usePageState' }}
    >
      <Section title="How it works">
        <P>
          Each item carries a recommendation (<strong>rec:</strong>) — <strong>Accept all recommendations</strong>{' '}
          seeds them, then override individually. Decisions and notes persist as you go, so they can be read back to
          drive the work. When happy, hit <strong>GO — start round</strong> at the top.
        </P>
        <Callout tone="info">
          <p>
            <strong>Attachments:</strong> drop files into <code>notes/pages/&lt;slug&gt;-assets/</code> (names match
            each item's <code>attachments</code>). Until present, each shows a labelled placeholder.
          </p>
        </Callout>
      </Section>

      <Section title="Keyboard-first flow">
        <P>
          A 20-item round should be ~40 keystrokes, not 40 clicks. Click a board to make it the{' '}
          <strong>active</strong> board (the <code>⌨ ?</code> chip in its bar turns indigo), then drive it entirely
          from the keyboard. Deciding <strong>auto-advances</strong> to the next undecided item, so you settle into a{' '}
          <em>read → g/d/n → read → g/d/n</em> rhythm. Press <code>?</code> for the cheatsheet.
        </P>
        <KvTable rows={[
          { from: 'j / k · ↓ / ↑', note: 'Move the focus ring down / up through the visible (filtered) items.' },
          { from: 'g / d / n', note: 'Go / Defer / No-go the focused item, then jump focus to the next undecided one.' },
          { from: '⌘/Ctrl+G/D/N', note: 'Decide from INSIDE a note — the key flow: mark the current item, advance, and focus the next note, all without leaving the field.' },
          { from: 'e', note: 'Edit the focused item’s note. Plain shortcuts suspend while you type; Esc (or ⌘/Ctrl+Enter) returns.' },
          { from: 'u', note: 'Jump to the next undecided item — same target as the “next undecided ↓” button in the bar.' },
          { from: 'a', note: 'Accept all recommendations (fills only the still-undecided items — never overwrites a choice).' },
          { from: '⌘/Ctrl+K', note: 'Command palette — fuzzy-jump to any item by its text/id, or run a board action.' },
          { from: '⌘/Ctrl+Z', note: 'Undo the last keyboard decision (also offered as a toast after each one).' },
          { from: '?', note: 'Toggle the shortcut cheatsheet overlay. Esc closes it.' },
        ]} />
        <Callout tone="info">
          <p>
            <strong>Multiple boards on one page</strong> (a triage round has one stream per source group) share the
            keyboard: the first claims it, and clicking into another hands it over — so <code>j/k</code> only ever
            moves one board at a time. Buttons annotate their hotkey (the focused card’s Go/Defer/No-go show{' '}
            <code>g/d/x</code>); a mis-key raises an <strong>Undo</strong> toast (<code>⌘/Ctrl+Z</code>).
          </p>
        </Callout>
      </Section>

      <Section title="On-this-page: live decision progress">
        <P>
          On wide viewports the fixed-left <strong>“On this page”</strong> rail grows a <strong>Decisions</strong>{' '}
          block for every board: a progress bar, the decided count, and a jump list of every item dotted by its
          decision (green/amber/red) with the focused item highlighted. Click any row to scroll it into view — a
          one-click focus jump that removes the need for a separate “focus mode”, and shows cross-group progress at a
          glance on multi-board rounds.
        </P>
      </Section>

      <Section title="Notes, filters & save feedback">
        <UL>
          <li>
            <strong>Auto-growing note.</strong> The note field is a textarea that starts at one line, grows with
            content, and keeps a ~2-row minimum once focused — long instruction-notes (the norm) get room without a
            scrollbar. <code>⌘/Ctrl+Enter</code> commits and blurs.
          </li>
          <li>
            <strong>Decision filters.</strong> The chip row filters the stream to{' '}
            <strong>All / Undecided / Go / Defer / No-go</strong> (client-side only — the state file is unchanged).
            On a big round, <em>Undecided</em> collapses it to just what still needs a call, and keyboard nav walks
            that subset.
          </li>
          <li>
            <strong>Per-item save dot.</strong> A tiny dot on the note you’re editing goes amber while saving and
            green once persisted — local confirmation right where you’re typing, since the global “saving…” lives far
            up in the bar.
          </li>
        </UL>
      </Section>

      <Section title="Live component">
        <P>Try it — click a card, then press <code>?</code>, or just start pressing <code>j</code> / <code>g</code>.</P>
        <ReviewStream slug="review" messages={ITEMS} />
      </Section>
    </Page>
  )
}
