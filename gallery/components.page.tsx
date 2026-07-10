/* Component library — a reference page showing how a plan can instantiate live UI components.
   The components below are small INLINE MOCKS (plain JSX + Tailwind) so this gallery page renders
   in any project with zero external deps. In a real project you swap these for your OWN components
   once the per-project coupling config is set (the `@` alias + Tailwind content globs) — that's the
   actual feature this page demonstrates. A clean reference, not a flow. */
import { Page, Section, P, Mockup, PrStatus } from '@page'

export const meta = { title: 'Component library', owner: 'kacper', created: '2026-06-19', status: 'reference' }

/* ── inline mock components (illustrative — replace with your own in a real project) ── */
function Button({ color = 'blue', outline, plain, href, disabled, children }: { color?: string; outline?: boolean; plain?: boolean; href?: string; disabled?: boolean; children: React.ReactNode }) {
  const palette: Record<string, string> = {
    blue: 'bg-blue-600 text-white', green: 'bg-green-600 text-white', red: 'bg-red-600 text-white', zinc: 'bg-zinc-700 text-white',
  }
  const cls = plain
    ? 'text-slate-700 hover:bg-slate-100'
    : outline
      ? 'border border-slate-300 text-slate-700 hover:bg-slate-50'
      : palette[color] ?? palette.blue
  const base = `inline-flex items-center rounded-lg px-3 py-1.5 text-[13px] font-semibold ${cls} ${disabled ? 'opacity-40' : ''}`
  if (href) return <a href={href} className={base}>{children}</a>
  return <button className={base} disabled={disabled}>{children}</button>
}

function Badge({ color = 'blue', children }: { color?: string; children: React.ReactNode }) {
  const palette: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-800', green: 'bg-green-100 text-green-800', amber: 'bg-amber-100 text-amber-800', violet: 'bg-violet-100 text-violet-800',
  }
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ${palette[color] ?? palette.blue}`}>{children}</span>
}

function Heading({ level = 3, children }: { level?: number; children: React.ReactNode }) {
  return <div className={`font-bold text-slate-900 ${level <= 2 ? 'text-xl' : 'text-base'}`}>{children}</div>
}

function Text({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] text-slate-600">{children}</p>
}

function Spinner({ size = 24 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-slate-300 border-t-slate-700" style={{ width: size, height: size }} />
}

function EmptyState({ title, description, ctaText, ctaLink }: { title: string; description: string; ctaText: string; ctaLink: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center">
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <div className="mt-1 text-[12px] text-slate-500">{description}</div>
      <a href={ctaLink} className="mt-3 inline-flex items-center rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white">{ctaText}</a>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 py-3 last:border-0">
      <div className="w-32 shrink-0 font-mono text-[11px] text-slate-400">{label}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

export default function Components() {
  return (
    <Page
      title="Component library"
      subtitle="Live UI components instantiated inside a plan. Here they're illustrative inline mocks so the page renders anywhere; in your project you import your own components and they hot-reload via the daemon's Vite resolution."
      meta={{ Owner: 'kacper', Source: 'inline mocks (illustrative)' }}
    >
      <Section title="These are illustrative mocks">
        <P>
          The <code>Button</code>, <code>Badge</code>, <code>Spinner</code>, etc. below are tiny
          inline components built from plain JSX + Tailwind, so this gallery page renders in any
          repo with no external dependencies. <strong>The feature being shown is the pattern</strong>:
          in a real project you <code>import</code> your OWN components (e.g.
          <code>{" import { Button } from '@app/components/button'"}</code>) once you've set the
          per-project coupling config — a path alias (the familiar <code>@</code>-style import) and
          the Tailwind content globs so their classes compile. The daemon's Vite then resolves them
          from source and edits hot-reload right here.
        </P>
      </Section>

      <Section title="Button">
        <P>A mock button with the usual variants — color, outline, plain, as-link, disabled:</P>
        <Mockup bar="import { Button } from '@app/components/button'">
          <Row label="color"><Button color="blue">Blue</Button><Button color="green">Green</Button><Button color="red">Red</Button><Button color="zinc">Zinc</Button></Row>
          <Row label="outline"><Button outline>Outline</Button></Row>
          <Row label="plain"><Button plain>Plain</Button></Row>
          <Row label="as link"><Button href="#">Link button</Button></Row>
          <Row label="disabled"><Button color="blue" disabled>Disabled</Button></Row>
        </Mockup>
      </Section>

      <Section title="Badge · Heading · Text">
        <Mockup bar="import { Badge, Heading, Text } from '@app/components/...'">
          <Row label="badge"><Badge color="blue">blue</Badge><Badge color="green">green</Badge><Badge color="amber">amber</Badge><Badge color="violet">violet</Badge></Row>
          <Row label="heading"><Heading level={3}>Heading level 3</Heading></Row>
          <Row label="text"><Text>Body text from the kit.</Text></Row>
        </Mockup>
      </Section>

      <Section title="Spinner · EmptyState">
        <Mockup bar="import { Spinner, EmptyState } from '@app/components/...'">
          <Row label="spinner"><Spinner size={20} /><Spinner size={32} /></Row>
          <div className="mt-3"><EmptyState title="No saves yet" description="Items you save show up here." ctaText="Browse library" ctaLink="#" /></div>
        </Mockup>
      </Section>

      <Section title="PrStatus — live GitHub PR status">
        <P>
          <code>{'<PrStatus pr={3721} />'}</code> — fetches the PR via <code>gh</code> through the
          dev server (<code>/api/gh/pr/&lt;n&gt;</code>), renders a clickable <code>#NNNN</code> +
          live status pill, and polls every ~30s while the PR is open. Pill states: <em>merged ·
          ready · checks failing · conflicts · behind main · blocked · open · draft · closed</em>.
          Status reflects GitHub now, no manual updates. (This one is a <code>@page</code> primitive —
          portable, no per-project wiring needed.)
        </P>
        <Mockup bar="import { PrStatus } from '@page'">
          <Row label="open"><PrStatus pr={3721} /></Row>
          <Row label="merged"><PrStatus pr={3722} /></Row>
        </Mockup>
      </Section>
    </Page>
  )
}
