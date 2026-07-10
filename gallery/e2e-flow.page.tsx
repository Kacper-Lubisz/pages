import { Page, Section, P, Pre, FlowTimeline, FlowCompare, type FlowEvent, type ScreenMap, type FrameMap } from '@page'

export const meta = { title: 'FlowTimeline (e2e flows)', owner: 'kacper', created: '2026-06-19', status: 'demo' }

/* ── one journey, defined once ─────────────────────────────────────────────
   A flow is an events[] array + either `screens` (live React) or `frames` (image urls).
   The same events drive both renderings. Journey: take a 4-question quiz. */
const EV: FlowEvent[] = [
  { t: 0.0, type: 'launch', screen: 'q1', label: 'Start quiz → Question 1' },
  { t: 1.0, type: 'tap', screen: 'q1', label: 'Tap an answer', x: 125, y: 300 },
  { t: 1.9, type: 'navigate', screen: 'q2', label: '→ Question 2' },
  { t: 2.9, type: 'tap', screen: 'q2', label: 'Tap an answer', x: 125, y: 320 },
  { t: 3.8, type: 'navigate', screen: 'q3', label: '→ Question 3' },
  { t: 4.8, type: 'tap', screen: 'q3', label: 'Tap an answer', x: 125, y: 300 },
  { t: 5.6, type: 'navigate', screen: 'q4', label: '→ Question 4' },
  { t: 6.3, type: 'tap', screen: 'q4', label: 'Tap "Submit"', x: 125, y: 432 },
  { t: 6.9, type: 'assert', screen: 'q4', label: 'Score recorded ✓' },
  { t: 7.4, type: 'screenshot', screen: 'q4', label: 'Capture: quiz-complete' },
]
const DUR = 7.6

/* ── inline mock button (illustrative — in a real project import your own component) ── */
function Button({ children }: { children: React.ReactNode }) {
  return <button className="w-full justify-center rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white">{children}</button>
}

/* ── concept screens: live React quiz cards (q4's CTA is a component pulled into the flow) ── */
function Card({ q, n, options, answer, answered, cta }: { q: string; n: number; options: string[]; answer: number; answered: boolean; cta?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col bg-slate-900 p-4 text-white">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Question {n} of 4</div>
      <div className="mt-2 text-[14px] font-bold leading-snug">{q}</div>
      <div className="mt-4 flex flex-col gap-2">
        {options.map((o, i) => (
          <div key={o} className={`rounded-xl border px-3 py-2.5 text-[12px] ${answered && i === answer ? 'border-green-500 bg-green-500/15 font-semibold' : 'border-slate-700 bg-slate-800'}`}>{o}{answered && i === answer ? '  ✓' : ''}</div>
        ))}
      </div>
      {cta && <div className="mt-auto">{cta}</div>}
    </div>
  )
}
const screens: ScreenMap = {
  q1: s => <Card n={1} q="What does Q·Kᵀ compute in attention?" options={['Attention scores', 'Token embeddings', 'Positional encodings']} answer={0} answered={s.index >= 1} />,
  q2: s => <Card n={2} q="Softmax is applied over which axis?" options={['The keys (per query)', 'The batch', 'The hidden dim']} answer={0} answered={s.index >= 3} />,
  q3: s => <Card n={3} q="Multi-head attention mainly adds…" options={['Multiple representation subspaces', 'More parameters only', 'Dropout']} answer={0} answered={s.index >= 5} />,
  q4: s => <Card n={4} q="Residual connections help by…" options={['Easing gradient flow', 'Removing layernorm', 'Shrinking the model']} answer={0} answered={s.index >= 8}
    cta={<Button>Submit</Button>} />,
}

/* ── replay frames: point these at YOUR project's own e2e screenshots ──
   These placeholder paths won't resolve in the gallery — in a real project you point `frames`
   at the screenshots your e2e run produced (Vite serves local files via `/@fs/<abs-path>`, or use
   any URL). The concept track above renders fully live without any screenshots. */
const SHOTS = '/e2e-screenshots/iphone' // ← replace with your project's screenshot dir
const frames: FrameMap = {
  q1: `${SHOTS}/07-quiz.png`,
  q2: `${SHOTS}/07-quiz--question-mcs.png`,
  q3: `${SHOTS}/07-quiz--question-ab.png`,
  q4: `${SHOTS}/07-quiz--question-sc.png`,
}

export default function E2EFlow() {
  return (
    <Page
      title="FlowTimeline — e2e flows"
      subtitle="Define a flow once (events + screens or frames). The viewer animates the cursor, plays, and lets you drag the rail or click any event to jump. Concept = live components; replay = your own e2e screenshots; compare = both on one scrubber."
      meta={{ Owner: 'kacper', Created: '2026-06-19', Primitive: '<FlowTimeline> / <FlowCompare>' }}
    >
      <Section title="Defining a flow">
        <P>A flow is data. Pass <code>events</code> + a <code>screens</code> map (live React, keyed by screen) or a <code>frames</code> map (image URLs). Same engine, two sources:</P>
        <Pre>{`<FlowTimeline duration={7.6} events={EV} screens={{ q1: () => <Card/>, ... }} />
<FlowTimeline duration={7.6} events={EV} frames={{ q1: '/…/07-quiz.png', ... }} />`}</Pre>
        <P>Navigation: <strong>drag the rail</strong> to scrub, <strong>click any event</strong> in the log (or a dot) to jump. Play/pause to watch it run.</P>
      </Section>

      <Section title="Concept flow — live components">
        <P>Each screen is live React — fully portable, renders anywhere with no screenshots. The final question's CTA is a component pulled straight into the flow (components-as-template); here it's an inline mock <code>{'<Button>'}</code>, but in a real project you'd drop in your own shared component.</P>
        <FlowTimeline duration={DUR} events={EV} screens={screens} />
      </Section>

      <Section title="Replay flow — your e2e screenshots">
        <P>The same journey, frames swapped for real screenshots from an e2e run. <strong>The frame paths below are placeholders</strong> — in your project you point <code>frames</code> at the images your own e2e suite produced (Vite serves local files via <code>/@fs</code>, or use any URL). This is how you visualise a flow after it ships.</P>
        <FlowTimeline duration={DUR} events={EV} frames={frames} />
      </Section>

      <Section title="Desktop screenshot flow">
        <P>The same primitive shows <strong>desktop</strong> screenshots too — pass a wide frame (<code>width</code>/<code>height</code>) and it lays out frame-on-top, controls below. Point <code>frames</code> at your wide captures (e.g. 1280×720) and set <code>fit="contain"</code>.</P>
        <FlowTimeline duration={DUR} events={EV} frames={frames} width={640} height={360} fit="contain" label="your desktop e2e screenshots" />
      </Section>

      <Section title="Compare — concept vs shipped">
        <P>One scrubber drives both: the live concept on the left, your real screenshots on the right. Step through to see design vs reality at each moment — exactly the kind of drift a compare surfaces (concept light cards vs a shipped dark quiz, say).</P>
        <FlowCompare duration={DUR} flows={[
          { label: 'concept (live)', events: EV, screens },
          { label: 'shipped (e2e shots)', events: EV, frames },
        ]} />
      </Section>
    </Page>
  )
}
