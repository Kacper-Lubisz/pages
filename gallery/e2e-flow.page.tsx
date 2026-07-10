import { Page, Section, P, Pre, FlowTimeline, FlowCompare, type FlowEvent, type ScreenMap, type FrameMap } from '@page'
import { Button } from '@turbocharge/catalyst-ui-kit' // a REAL shared component, pulled into a flow

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

/* ── concept screens: live React quiz cards (q4 uses a real catalyst component) ── */
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
    cta={<Button color="blue" className="w-full justify-center">Submit</Button>} />,
}

/* ── replay frames: REAL iphone quiz screenshots, served live by Vite via /@fs ── */
const SHOTS = '/@fs/home/kacper/projects/Retainit/apps/web/e2e/screenshots/iphone'
const frames: FrameMap = {
  q1: `${SHOTS}/07-quiz.png`,
  q2: `${SHOTS}/07-quiz--question-mcs.png`,
  q3: `${SHOTS}/07-quiz--question-ab.png`,
  q4: `${SHOTS}/07-quiz--question-sc.png`,
}
// the same journey from DESKTOP screenshots (chromium, 1280×720) — wide frames
const SHOTS_D = '/@fs/home/kacper/projects/Retainit/apps/web/e2e/screenshots/chromium'
const desktopFrames: FrameMap = {
  q1: `${SHOTS_D}/07-quiz.png`,
  q2: `${SHOTS_D}/07-quiz--question-mcs.png`,
  q3: `${SHOTS_D}/07-quiz--question-ab.png`,
  q4: `${SHOTS_D}/07-quiz--question-sc.png`,
}

export default function E2EFlow() {
  return (
    <Page
      title="FlowTimeline — e2e flows"
      subtitle="Define a flow once (events + screens or frames). The viewer animates the cursor, plays, and lets you drag the rail or click any event to jump. Concept = live components; replay = real e2e screenshots; compare = both on one scrubber."
      meta={{ Owner: 'kacper', Created: '2026-06-19', Primitive: '<FlowTimeline> / <FlowCompare>' }}
    >
      <Section title="Defining a flow">
        <P>A flow is data. Pass <code>events</code> + a <code>screens</code> map (live React, keyed by screen) or a <code>frames</code> map (image URLs). Same engine, two sources:</P>
        <Pre>{`<FlowTimeline duration={7.6} events={EV} screens={{ q1: () => <Card/>, ... }} />
<FlowTimeline duration={7.6} events={EV} frames={{ q1: '/…/07-quiz.png', ... }} />`}</Pre>
        <P>Navigation: <strong>drag the rail</strong> to scrub, <strong>click any event</strong> in the log (or a dot) to jump. Play/pause to watch it run.</P>
      </Section>

      <Section title="Concept flow — live components">
        <P>Each screen is live React. The final question's CTA is a <strong>real</strong> shared component — <code>{'<Button>'}</code> from <code>@turbocharge/catalyst-ui-kit</code> — pulled straight into the flow (components-as-template).</P>
        <FlowTimeline duration={DUR} events={EV} screens={screens} />
      </Section>

      <Section title="Replay flow — real e2e screenshots">
        <P>The same journey, frames swapped for actual quiz screenshots from <code>apps/web/e2e/screenshots/iphone</code> (served live by Vite via <code>/@fs</code> — no copying). This is how you visualise a flow after it ships.</P>
        <FlowTimeline duration={DUR} events={EV} frames={frames} />
      </Section>

      <Section title="Desktop screenshot flow">
        <P>The same primitive shows <strong>desktop</strong> screenshots too — pass a wide frame (<code>width</code>/<code>height</code>) and it lays out frame-on-top, controls below. Here: the chromium 1280×720 captures, fit to the frame. This is the main mode for replaying existing desktop screenshot flows.</P>
        <FlowTimeline duration={DUR} events={EV} frames={desktopFrames} width={640} height={360} fit="contain" label="real desktop e2e screenshots (1280×720)" />
      </Section>

      <Section title="Compare — concept vs shipped">
        <P>One scrubber drives both: the live concept on the left, the real screenshots on the right. Step through to see design vs reality at each moment (here: the concept mocked light cards; the shipped quiz is dark — exactly the kind of drift a compare surfaces).</P>
        <FlowCompare duration={DUR} flows={[
          { label: 'concept (live)', events: EV, screens },
          { label: 'shipped (e2e shots)', events: EV, frames },
        ]} />
      </Section>
    </Page>
  )
}
