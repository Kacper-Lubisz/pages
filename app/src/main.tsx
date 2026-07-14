import { createRoot } from 'react-dom/client'
import './index.css'
import { Index } from './Index'
import { setTab } from './lib/tab'

// CENTRAL store: pages live in notes/pages/*.page.tsx (project-agnostic) AND in one level of
// project subdirs notes/pages/<project>/*.page.tsx (project-bound — the subdir binds the page
// to a project in .config/projects.json, and a Vite plugin resolves that project's @/ imports).
// The component gallery is in notes/pages/templates/. *.plan.tsx is the legacy extension —
// still globbed so pre-rename pages keep rendering; on a slug collision the .page.tsx wins.
//
// A project-bound page's slug carries its subdir ("<project>/<name>") so it routes at
// /p/<project>/<name> and never collides with another project's same-named page. Flat pages
// keep a bare "<name>" slug. The `templates/` subdir is handled by its own glob/route (/t/),
// so it is excluded from the project-page glob below.
//
// Modules are loaded NON-eagerly and isolated in try/catch: a single page/template that fails
// to import (e.g. a gallery demo importing a package this project doesn't have) must NOT blank
// every other page. A broken module is skipped and surfaced as its own error card.
const pageMods = import.meta.glob('../../*.page.tsx') as Record<string, () => Promise<any>>
const legacyMods = import.meta.glob('../../*.plan.tsx') as Record<string, () => Promise<any>>
const projPageMods = import.meta.glob('../../*/*.page.tsx') as Record<string, () => Promise<any>>
const projLegacyMods = import.meta.glob('../../*/*.plan.tsx') as Record<string, () => Promise<any>>
const templateMods = import.meta.glob(['../../templates/*.page.tsx', '../../templates/*.plan.tsx']) as Record<string, () => Promise<any>>

type Entry = { slug: string; meta: any; Component: any; error?: string }
// Flat pages → bare name; project subdirs → "<project>/<name>". Strip the leading "../../".
const slugOf = (path: string) => path.replace(/^(\.\.\/)+/, '').replace(/\.(page|plan)\.tsx$/, '')
// Templates route under /t/ with a bare basename slug; the project-page glob catches them too
// (templates is a plain subdir), so they are filtered out of the page registry by this prefix.
const isTemplatePath = (path: string) => /(^|\/)templates\/[^/]+\.(page|plan)\.tsx$/.test(path)
const basenameSlug = (path: string) => path.split('/').pop()!.replace(/\.(page|plan)\.tsx$/, '')

async function toRegistry(
  slugFn: (path: string) => string,
  ...modGroups: Record<string, () => Promise<any>>[]
): Promise<Entry[]> {
  const bySlug = new Map<string, Entry>()
  for (const mods of modGroups) {
    for (const [path, load] of Object.entries(mods)) {
      if (slugFn === slugOf && isTemplatePath(path)) continue // templates handled by /t/
      const slug = slugFn(path)
      if (bySlug.has(slug)) continue
      try {
        const mod = await load()
        bySlug.set(slug, { slug, meta: mod.meta ?? {}, Component: mod.default })
      } catch (err) {
        // Isolate the failure to this one slug instead of crashing the whole registry.
        console.error(`[pages] failed to load ${path}:`, err)
        const message = err instanceof Error ? err.message : String(err)
        bySlug.set(slug, { slug, meta: { title: slug }, Component: null, error: message })
      }
    }
  }
  return [...bySlug.values()].sort((a, b) => String(a.meta.title || a.slug).localeCompare(String(b.meta.title || b.slug)))
}

function ErrorCard({ slug, error }: { slug: string; error: string }) {
  return (
    <div className="mx-auto max-w-3xl px-8 py-16 font-sans text-slate-900">
      <h1 className="text-2xl font-bold text-red-600">Failed to load “{slug}”</h1>
      <p className="mt-2 text-slate-600">This page threw while importing — other pages are unaffected.</p>
      <pre className="mt-4 overflow-x-auto rounded-md bg-slate-100 px-4 py-3 font-mono text-[13px] text-slate-700">{error}</pre>
      <p className="mt-4"><a href="/" className="text-blue-600 underline">← index</a></p>
    </div>
  )
}

function makeApp(pages: Entry[], templates: Entry[]) {
  const byRoute: Record<string, Entry[]> = { p: pages, t: templates }
  return function App() {
    const m = location.pathname.match(/^\/(p|t)\/(.+)$/)
    if (m) {
      const e = byRoute[m[1]]?.find(r => r.slug === decodeURIComponent(m[2]))
      if (e?.error) {
        setTab({ title: `Error · ${e.slug}`, slug: e.slug })
        return <ErrorCard slug={e.slug} error={e.error} />
      }
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
}

const root = createRoot(document.getElementById('root')!)
root.render(<div className="p-10 font-sans text-slate-400">Loading…</div>)
Promise.all([
  toRegistry(slugOf, pageMods, projPageMods, legacyMods, projLegacyMods),
  toRegistry(basenameSlug, templateMods),
]).then(([pages, templates]) => {
  root.render(<>{(() => { const App = makeApp(pages, templates); return <App /> })()}</>)
})
