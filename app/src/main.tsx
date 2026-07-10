import { createRoot } from 'react-dom/client'
import './index.css'
import { Index } from './Index'
import { setTab } from './lib/tab'

// pages live in notes/pages/*.page.tsx; the component gallery in notes/pages/templates/.
// *.plan.tsx is the legacy extension — still globbed so pre-rename pages keep rendering;
// on a slug collision the .page.tsx wins.
const pageMods = import.meta.glob('../../*.page.tsx', { eager: true }) as Record<string, any>
const legacyMods = import.meta.glob('../../*.plan.tsx', { eager: true }) as Record<string, any>
const templateMods = import.meta.glob(['../../templates/*.page.tsx', '../../templates/*.plan.tsx'], { eager: true }) as Record<string, any>

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.(page|plan)\.tsx$/, '')
function toRegistry(...modGroups: Record<string, any>[]) {
  const bySlug = new Map<string, { slug: string; meta: any; Component: any }>()
  for (const mods of modGroups) {
    for (const [path, mod] of Object.entries(mods)) {
      const slug = slugOf(path)
      if (!bySlug.has(slug)) bySlug.set(slug, { slug, meta: mod.meta ?? {}, Component: mod.default })
    }
  }
  return [...bySlug.values()].sort((a, b) => String(a.meta.title || a.slug).localeCompare(String(b.meta.title || b.slug)))
}
const pages = toRegistry(pageMods, legacyMods)
const templates = toRegistry(templateMods)
const byRoute: Record<string, typeof pages> = { p: pages, t: templates }

function App() {
  const m = location.pathname.match(/^\/(p|t)\/(.+)$/)
  if (m) {
    const e = byRoute[m[1]]?.find(r => r.slug === decodeURIComponent(m[2]))
    if (e?.Component) {
      setTab({ icon: e.meta?.icon, title: e.meta?.title, slug: e.slug })
      const C = e.Component
      return <C />
    }
    setTab({ title: 'Not found', slug: m[2] })
    return <div className="p-10 font-sans text-slate-900">Not found: <code>{m[2]}</code> · <a href="/" className="text-blue-600 underline">index</a></div>
  }
  if (location.pathname === '/templates') {
    setTab({ title: 'Components', slug: 'templates', icon: '🧩' })
    return <Index registry={templates} title="Components" basePath="/t/" back />
  }
  setTab({ title: 'Pages', slug: 'pages', icon: '🗂️' })
  return <Index registry={pages} title="Pages" basePath="/p/" templatesLink />
}

createRoot(document.getElementById('root')!).render(<App />)
