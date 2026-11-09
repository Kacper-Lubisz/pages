import { Callout, P, Page, Pre, Section, UL } from '@page'
import { ScreenFlow, notAsked, type FlowBox, type FlowCase, type FlowSpec, type Version } from './screen-flow'
import severalVideo from './screen-flow-assets/several.mp4'
import notFoundVideo from './screen-flow-assets/not-found.mp4'

export const meta = { title: 'ScreenFlow (before/after flow chart)', owner: 'kacper', created: '2026-10-27', status: 'demo', icon: '🗺️' }

/* ── the screens, each with a before and/or after side ─────────────────────────────────────
   `at` is [column, row] on that version's chart; `exits` are every way out, and the chart draws them. */
const BOXES: FlowBox[] = [
  {
    id: 'C1',
    change: 'unchanged',
    changeReason: 'Same screen.',
    before: { at: [0, 0], title: 'Your basket', shownWhen: 'Checkout starts.', shows: ['Items, total, “Continue to delivery”.'], exits: [{ label: 'Continue to delivery', to: ['A1'] }] },
    after: { at: [0, 0], title: 'Your basket', shownWhen: 'Checkout starts.', shows: ['Items, total, “Continue to delivery”.'], exits: [{ label: 'Continue to delivery', to: ['L1'] }] },
  },
  {
    id: 'L1',
    change: 'new',
    changeReason: 'New: the address starts with a postcode lookup.',
    after: {
      at: [1, 0],
      title: 'Find your address',
      shownWhen: 'Every checkout, before the address fields.',
      shows: ['“What’s your postcode?” with “Find address”.', '“Enter it manually” underneath.'],
      exits: [
        { label: 'Several addresses found', to: ['L2'] },
        { label: 'One address found', to: ['L3'] },
        { label: 'Postcode not found', to: ['L4'] },
        { label: 'Enter it manually', to: ['A1'] },
      ],
    },
  },
  {
    id: 'L4',
    change: 'new',
    changeReason: 'New: the lookup’s dead end needs a way out.',
    after: {
      at: [1, -1],
      title: 'Postcode not found',
      shownWhen: 'The lookup returns nothing.',
      shows: ['“We couldn’t find that postcode.”', '“Try again” and “Enter it manually”.'],
      exits: [
        { label: 'Try again', to: ['L1'] },
        { label: 'Enter it manually', to: ['A1'] },
      ],
    },
  },
  {
    id: 'L2',
    change: 'new',
    changeReason: 'New.',
    after: {
      at: [2, 0],
      title: 'Pick your address',
      shownWhen: 'The postcode has more than one address.',
      shows: ['A list of addresses.', '“My address isn’t listed”.'],
      exits: [
        { label: 'Pick one', to: ['P1'] },
        { label: 'My address isn’t listed', to: ['A1'] },
      ],
    },
  },
  {
    id: 'L3',
    change: 'new',
    changeReason: 'New: one result is confirmed rather than picked.',
    after: {
      at: [2, 1],
      title: 'Is this your address?',
      shownWhen: 'The postcode has exactly one address.',
      shows: ['The address, “Yes, deliver here” and “No, enter it manually”.'],
      exits: [
        { label: 'Yes, deliver here', to: ['P1'] },
        { label: 'No', to: ['A1'] },
      ],
    },
  },
  {
    id: 'A1',
    change: 'reworded',
    changeReason: 'Reworded: now the fallback, prefilled with the postcode.',
    before: { at: [1, 0], title: 'Address line 1', shownWhen: 'After the basket.', shows: ['“First line of your address”.'], exits: [{ label: 'Next', to: ['A2'] }] },
    after: { at: [3, 1], title: 'Address line 1', shownWhen: 'Only when the lookup didn’t give an address.', shows: ['“First line of your address”, the postcode kept from the lookup.'], exits: [{ label: 'Next', to: ['A2'] }] },
  },
  {
    id: 'A2',
    change: 'unchanged',
    changeReason: 'Same question.',
    before: { at: [2, 0], title: 'Town', shownWhen: 'After line 1.', shows: ['“Town or city”.'], exits: [{ label: 'Next', to: ['A3'] }] },
    after: {
      at: [4, 1],
      title: 'Town',
      shownWhen: 'After line 1.',
      shows: ['“Town or city”.'],
      exits: [
        { label: 'Next, no postcode yet', to: ['A3'] },
        { label: 'Next, postcode kept from the lookup', to: ['P1'] },
      ],
    },
  },
  {
    id: 'A3',
    change: 'unchanged',
    changeReason: 'Same question.',
    before: { at: [3, 0], title: 'Postcode', shownWhen: 'After the town.', shows: ['“Postcode”.'], exits: [{ label: 'Next', to: ['P1'] }] },
    after: { at: [5, 1], title: 'Postcode', shownWhen: 'Typed path only, when the lookup had no postcode.', shows: ['“Postcode”.'], exits: [{ label: 'Next', to: ['P1'] }] },
  },
  {
    id: 'P1',
    change: 'unchanged',
    changeReason: 'Same screen.',
    before: { at: [4, 0], title: 'Payment', shownWhen: 'Once there’s an address.', shows: ['Card details, “Pay”.'], exits: [{ label: 'Pay', to: [] }] },
    after: { at: [6, 0], title: 'Payment', shownWhen: 'Once there’s an address.', shows: ['Card details, “Pay”.'], exits: [{ label: 'Pay', to: [] }] },
  },
]

/* ── the cases: one path per version; a `notAsked` step is on the path but skipped, with the reason ── */
const BEFORE = ['C1', 'A1', 'A2', 'A3', 'P1']
const FROM_LOOKUP = [notAsked('A1', 'From the lookup.'), notAsked('A2', 'From the lookup.'), notAsked('A3', 'From the lookup.')]

const CASES: FlowCase[] = [
  {
    id: 'several',
    group: 'Lookup works',
    label: 'Several addresses',
    notes: [
      { title: 'Before', body: 'Three typed fields.' },
      { title: 'After', body: 'Postcode → pick from the list → payment. Nothing typed but the postcode.' },
    ],
    paths: { before: BEFORE, after: ['C1', 'L1', 'L2', ...FROM_LOOKUP, 'P1'] },
  },
  {
    id: 'one',
    group: 'Lookup works',
    label: 'One address',
    notes: [
      { title: 'Before', body: 'Three typed fields.' },
      { title: 'After', body: 'Postcode → “Is this your address?” → payment.' },
    ],
    paths: { before: BEFORE, after: ['C1', 'L1', 'L3', ...FROM_LOOKUP, 'P1'] },
  },
  {
    id: 'not-found',
    group: 'Lookup fails',
    label: 'Typo, then found',
    notes: [
      { title: 'Before', body: 'Three typed fields.' },
      { title: 'After', body: 'A mistyped postcode → not found → try again → pick from the list. L1 is met twice.' },
    ],
    paths: { before: BEFORE, after: ['C1', 'L1', 'L4', 'L1', 'L2', ...FROM_LOOKUP, 'P1'] },
  },
  {
    id: 'not-listed',
    group: 'Lookup fails',
    label: 'Not listed',
    notes: [
      { title: 'Before', body: 'Three typed fields.' },
      { title: 'After', body: 'Lookup → not in the list → line 1 and town typed; the postcode is kept.' },
    ],
    paths: { before: BEFORE, after: ['C1', 'L1', 'L2', 'A1', 'A2', notAsked('A3', 'Kept from the lookup.'), 'P1'] },
  },
]

/* ── screens: live JSX here; a real page usually returns an <img> of a captured screenshot ── */
function MiniScreen({ title, lines, tone }: { title: string; lines: string[]; tone: 'new' | 'old' }) {
  return (
    <div className={`flex aspect-[390/844] w-full flex-col gap-1.5 rounded-xl border p-2.5 text-[9.5px] leading-snug ${tone === 'new' ? 'border-blue-200 bg-blue-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="text-[11px] font-bold text-slate-900">{title}</div>
      {lines.map(line => (
        <div key={line} className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-slate-600">{line}</div>
      ))}
      <div className="mt-auto rounded-md bg-slate-900 py-1 text-center font-semibold text-white">Continue</div>
    </div>
  )
}

const screen = (box: FlowBox, version: Version) => {
  const side = box[version]
  if (!side) return null
  return <MiniScreen title={side.title} lines={side.shows} tone={version === 'after' && box.change === 'new' ? 'new' : 'old'} />
}

const SPEC: FlowSpec = {
  boxes: BOXES,
  bands: {
    before: [{ label: 'Typed address', from: 1, to: 3, tone: 'neutral' }],
    after: [
      { label: 'Postcode lookup', from: 1, to: 2, tone: 'new' },
      { label: 'Typed fallback', from: 3, to: 5, tone: 'changed' },
    ],
  },
  cases: CASES,
  headings: {
    before: { title: 'Before', note: 'Every shopper types three fields.' },
    after: { title: 'After', note: 'A postcode lookup first; typing is the fallback.' },
  },
  initialBox: 'L1',
  screen,
  // Each mark says which box the video is on from tMs onwards; capture writes these as it walks the app.
  recordings: {
    several: {
      video: severalVideo,
      marks: [
        { box: 'C1', note: 'The basket.', tMs: 0 },
        { box: 'L1', note: 'Postcode typed, “Find address”.', tMs: 2000 },
        { box: 'L2', note: 'Picks the second address.', tMs: 4500 },
        { box: 'P1', note: 'Straight to payment.', tMs: 7000 },
      ],
    },
    'not-found': {
      video: notFoundVideo,
      marks: [
        { box: 'C1', note: 'The basket.', tMs: 0 },
        { box: 'L1', note: 'A mistyped postcode.', tMs: 2000 },
        { box: 'L4', note: '“We couldn’t find that postcode.”', tMs: 4000 },
        { box: 'L1', note: 'Second try.', tMs: 6000 },
        { box: 'L2', note: 'Picks an address.', tMs: 8000 },
        { box: 'P1', note: 'Payment.', tMs: 10000 },
      ],
    },
  },
}

export default function ScreenFlowGallery() {
  return (
    <Page title="ScreenFlow: before/after flow chart" subtitle="Every screen of a changed flow, before and after, with the path each case takes and a recording synced to the chart." meta={meta}>
      <Section title="Live demo">
        <P>
          An invented checkout that swaps three typed address fields for a postcode lookup. Pick a case: its path lights up
          on both charts, numbered in the order it’s met. Click a box for its screens and every way out. The two recorded
          cases play a video that moves the chart as it goes; <strong>Next</strong> and <strong>←/→</strong> step through
          the marks.
        </P>
        <ScreenFlow spec={SPEC} />
      </Section>

      <Section title="When to use it">
        <UL>
          <li>A change to a multi-screen flow where reviewers need to see <em>what moved</em>, not just the new screens.</li>
          <li>Many cases through the same screens (who arrives, what fails, what’s skipped) that prose can’t keep straight.</li>
          <li>A test page: the chart is the map, the recordings are the evidence, and a missing transition shows up in red.</li>
        </UL>
      </Section>

      <Section title="How it’s wired">
        <P>
          Copy <code>templates/screen-flow.tsx</code> next to your page (or into <code>&lt;slug&gt;-assets/</code>) and
          import <code>ScreenFlow</code>. You write three lists:
        </P>
        <Pre>{`boxes   FlowBox[]   one per screen or decision: before?/after? sides, each with at:[col,row], title,
                    shownWhen, shows[], exits[{ label, to[] }]; change: unchanged | new | reworded
cases   FlowCase[]  paths: { before: [...ids], after: [...ids] }; notAsked(id, why) marks a skipped step
recordings          { [caseId]: { video, marks: [{ box, note, tMs }] } }   (optional)
screen(box, version, case) → ReactNode                                        (optional: <img> or JSX)`}</Pre>
        <Callout tone="info">
          The paths are checked against the exits: a case that moves between two boxes with no declared way out is
          listed in red under the chart. Writing the cases is how the missing transitions get found.
        </Callout>
      </Section>

      <Section title="Capturing real screenshots and videos">
        <P>
          The demo’s videos are generated slides. For a real app, a Playwright script walks each case on a phone-sized
          headless browser, saving a screenshot per screen and recording the walk. To make the marks line up with the
          video frame-exactly, it flashes a small colour square in a corner of the page at each mark, finds those frames in
          the recording with ffmpeg, then crops the square out. A camera flow can be walked headless by replacing{' '}
          <code>getUserMedia</code> with a canvas stream of a test image. Re-run the capture whenever the build changes,
          and label each screenshot with the build it came from.
        </P>
      </Section>
    </Page>
  )
}
