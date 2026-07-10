/* Component library — real product components instantiated live in a plan. The daemon's
   Vite resolves them from source (catalyst from the shared kit, others from apps/web), so
   editing their source hot-reloads here. A clean reference, not a flow. */
import { Page, Section, P, Mockup, PrStatus } from '@page'
import { Button, Badge, Heading, Text } from '@turbocharge/catalyst-ui-kit'
import { Spinner } from '@/components/spinner'
import { EmptyState } from '@/components/dashboard/EmptyState'

export const meta = { title: 'Component library', owner: 'kacper', created: '2026-06-19', status: 'reference' }

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
      subtitle="Real product components, instantiated live via the daemon's Vite resolution. Edit a component's source and it hot-reloads here."
      meta={{ Owner: 'kacper', Source: '@turbocharge/catalyst-ui-kit · apps/web' }}
    >
      <Section title="Button — the real catalyst component">
        <P>Straight from the shared UI kit — <code>import {'{ Button }'} from '@turbocharge/catalyst-ui-kit'</code>. No screenshots, no mock; this is the actual component rendering:</P>
        <Mockup bar="import { Button } from '@turbocharge/catalyst-ui-kit'">
          <Row label="color"><Button color="blue">Blue</Button><Button color="green">Green</Button><Button color="red">Red</Button><Button color="zinc">Zinc</Button></Row>
          <Row label="outline"><Button outline>Outline</Button></Row>
          <Row label="plain"><Button plain>Plain</Button></Row>
          <Row label="as link"><Button href="#">Link button</Button></Row>
          <Row label="disabled"><Button color="blue" disabled>Disabled</Button></Row>
        </Mockup>
      </Section>

      <Section title="Badge · Heading · Text">
        <Mockup bar="@turbocharge/catalyst-ui-kit">
          <Row label="badge"><Badge color="blue">blue</Badge><Badge color="green">green</Badge><Badge color="amber">amber</Badge><Badge color="violet">violet</Badge></Row>
          <Row label="heading"><Heading level={3}>Heading level 3</Heading></Row>
          <Row label="text"><Text>Body text from the kit.</Text></Row>
        </Mockup>
      </Section>

      <Section title="From the web app">
        <Mockup bar="@/components/spinner · @/components/dashboard/EmptyState">
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
          Status reflects GitHub now, no manual updates.
        </P>
        <Mockup bar="import { PrStatus } from '@page'">
          <Row label="open"><PrStatus pr={3721} /></Row>
          <Row label="merged"><PrStatus pr={3722} /></Row>
        </Mockup>
      </Section>
    </Page>
  )
}
