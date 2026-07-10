import { Glyph } from './lib/tab'

type Entry = { slug: string; meta: any }

export function Index({ registry, title = 'Plans', basePath = '/p/', templatesLink = false, back = false }: {
  registry: Entry[]; title?: string; basePath?: string; templatesLink?: boolean; back?: boolean
}) {
  return (
    <div className="mx-auto max-w-4xl px-8 py-16 font-sans text-slate-900">
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <div className="flex items-center gap-4 text-xs">
          {back && <a href="/" className="text-blue-600 underline">← Plans</a>}
          {templatesLink && <a href="/templates" className="text-blue-600 underline">Components →</a>}
          <span className="text-slate-400">{registry.length} {registry.length === 1 ? 'item' : 'items'}</span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {registry.map(e => (
          <a key={e.slug} href={basePath + e.slug}
            className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-400 hover:shadow-sm">
            <Glyph icon={e.meta?.icon} title={e.meta?.title} slug={e.slug} />
            <div className="min-w-0">
              <div className="font-semibold">{e.meta?.title ?? e.slug}</div>
              <div className="mt-1 text-[11px] text-slate-400">{[e.meta?.owner, e.meta?.created].filter(Boolean).join(' · ')}</div>
              {e.meta?.status && (
                <span className="mt-2 inline-block rounded bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">{e.meta.status}</span>
              )}
            </div>
          </a>
        ))}
        {registry.length === 0 && <div className="text-slate-400">Nothing here yet.</div>}
      </div>
    </div>
  )
}
