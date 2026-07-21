/* page-ui — the page primitives as Tailwind React components.
   Aesthetic mirrors the legacy HTML template: white bg, slate ink, single blue accent,
   hairline borders, rounded cards. Author plans by composing these. */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { marked } from 'marked'

/* ---- static (shared-snapshot) mode ------------------------------------ */
// __PAGE_STATIC__ is a Vite define: false on the dev daemon, true in share.mjs exports.
// In static mode the dev-server APIs don't exist, so components hydrate from globals baked
// into the exported index.html instead — and the ShareBar (dev tooling) renders nothing.
declare const __PAGE_STATIC__: boolean
declare global {
  interface Window {
    __PAGE_STATE__?: unknown
    __PAGE_GH__?: Record<string, PrInfo>
    __PAGE_SHARE__?: { slug?: string; title?: string; sharedAt?: string; expiresAt?: string | null }
  }
}
const IS_STATIC = typeof __PAGE_STATIC__ !== 'undefined' && __PAGE_STATIC__

/* ---- progress + approval context -------------------------------------- */
type Register = (id: string, done: number, total: number) => void
const PageCtx = createContext<{ approved: boolean; register: Register }>({ approved: false, register: () => {} })

export type PageMeta = Record<string, ReactNode>

export function Page({ title, subtitle, meta, approved = false, children }: {
  title: string; subtitle?: ReactNode; meta?: PageMeta; approved?: boolean; children: ReactNode
}) {
  const [counts, setCounts] = useState<Record<string, [number, number]>>({})
  const register: Register = (id, done, total) => setCounts(c => (c[id]?.[0] === done && c[id]?.[1] === total ? c : { ...c, [id]: [done, total] }))
  const [done, total] = Object.values(counts).reduce(([d, t], [cd, ct]) => [d + cd, t + ct], [0, 0])
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <PageCtx.Provider value={{ approved, register }}>
      <div className="mx-auto flex w-full max-w-[96rem] gap-8 px-6 font-sans text-slate-900 [font-feature-settings:'cv11','ss01'] sm:px-8">
        <SideNav />
        <div data-page-content className="min-w-0 flex-1 py-16 sm:py-20">
          <header className="mb-12">
            {IS_STATIC ? <SnapshotBanner /> : <ShareBar />}
            <h1 className="text-[34px] font-bold leading-tight tracking-[-0.025em] sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-2.5 text-lg leading-relaxed text-slate-600">{subtitle}</p>}
            {meta && (
              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-400">
                {Object.entries(meta).map(([k, v]) => (
                  <span key={k}><strong className="mr-1.5 font-semibold text-slate-900">{k}</strong>{v}</span>
                ))}
              </div>
            )}
            {approved && (
              <div className="mt-6 flex items-center gap-3 text-xs text-slate-600">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: pct + '%' }} />
                </div>
                <div className="whitespace-nowrap font-medium tabular-nums text-slate-900">{done} / {total}{total ? `  ·  ${pct}%` : ''}</div>
              </div>
            )}
          </header>
          {children}
        </div>
      </div>
    </PageCtx.Provider>
  )
}

/* ---- sharing (ShareBar = dev-only header widget; SnapshotBanner = static) ---- */
type ShareInfo = {
  title?: string; sharedAt?: string; expiresAt?: string | null
  url?: string | null; ngrokUrl?: string | null; expired?: boolean
}
type ShareStatus = {
  ok?: boolean
  vercel?: { installed?: boolean; authed?: boolean; user?: string; hint?: string; error?: string }
  ngrok?: { installed?: boolean; up?: boolean; url?: string; hint?: string }
  shares?: Record<string, ShareInfo>
  baseUrl?: string | null
}
function daysLeft(expiresAt?: string | null): string | null {
  if (!expiresAt) return null
  const d = Math.ceil((Date.parse(expiresAt) - Date.now()) / 86_400_000)
  return d <= 0 ? 'expired' : `${d}d left`
}
const chipTone = {
  good: 'border-green-300 text-green-700 [&_i]:bg-green-500',
  warn: 'border-amber-300 text-amber-700 [&_i]:bg-amber-500',
  bad: 'border-red-300 text-red-600 [&_i]:bg-red-500',
  neutral: 'border-slate-200 text-slate-500 [&_i]:bg-slate-300',
}
function StatusChip({ tone, label, href, title }: { tone: keyof typeof chipTone; label: string; href?: string; title?: string }) {
  const cls = `inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] font-medium ${chipTone[tone]} ${href ? 'no-underline hover:opacity-75' : ''}`
  const body = <><i className="h-1.5 w-1.5 rounded-full" />{label}</>
  return href
    ? <a className={cls} href={href} target="_blank" rel="noreferrer" title={title}>{body}</a>
    : <span className={cls} title={title}>{body}</span>
}

// Publish / tunnel controls + live Vercel & ngrok chips, top of every plan page. Dev-daemon
// only (compiled out of static exports). Backed by the daemon's /api/share endpoints, which
// relay share.mjs — so "vercel not installed / not authed" arrive as hints, not crashes.
function ShareBar() {
  const slug = decodeURIComponent(location.pathname.match(/^\/p\/([^/]+)/)?.[1] ?? '')
  const [st, setSt] = useState<ShareStatus | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)
  useEffect(() => {
    if (!slug) return
    let live = true
    const refresh = () => fetch('/api/share/status').then(r => r.json()).then(j => { if (live) setSt(j) }).catch(() => {})
    refresh()
    const t = setInterval(refresh, 20_000)
    return () => { live = false; clearInterval(t) }
  }, [slug])
  if (!slug) return null

  const v = st?.vercel
  const n = st?.ngrok
  const share = st?.shares?.[slug]
  const refresh = () => fetch('/api/share/status').then(r => r.json()).then(setSt).catch(() => {})
  const act = async (action: string) => {
    setBusy(action)
    setMsg(null)
    try {
      const r = await fetch(`/api/share/${encodeURIComponent(slug)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const j = await r.json()
      if (j.ok && j.url) {
        try { await navigator.clipboard.writeText(j.url) } catch {}
        setMsg({ tone: 'good', text: `${j.url} — link copied` })
      } else if (j.ok) {
        setMsg({ tone: 'good', text: j.dist ? `exported → ${j.dist}` : 'done' })
      } else {
        setMsg({ tone: 'bad', text: [j.reason || j.error || 'failed', j.hint].filter(Boolean).join(' — ') })
      }
    } catch {
      setMsg({ tone: 'bad', text: 'request failed (is the daemon healthy?)' })
    }
    setBusy(null)
    refresh()
  }

  const vercelChip = (() => {
    if (!st) return <StatusChip tone="neutral" label="Vercel · …" />
    if (!v?.installed) return <StatusChip tone="neutral" label="Vercel · not installed" title={v?.hint} />
    if (!v?.authed) return <StatusChip tone="warn" label="Vercel · not authed" title={v?.hint} />
    if (share?.url && !share.expired) return <StatusChip tone="good" label={`Vercel · live${share.expiresAt ? ` · ${daysLeft(share.expiresAt)}` : ''}`} href={share.url} title={share.url} />
    if (share?.expired) return <StatusChip tone="bad" label="Vercel · expired" title="publish again to refresh" />
    return <StatusChip tone="neutral" label="Vercel · not shared" title={`authed as ${v?.user ?? '?'}`} />
  })()
  const ngrokChip = (() => {
    if (!st) return <StatusChip tone="neutral" label="ngrok · …" />
    if (!n?.installed) return <StatusChip tone="neutral" label="ngrok · not installed" title={n?.hint} />
    if (n?.up) return <StatusChip tone="good" label="ngrok · live" href={share?.ngrokUrl ?? n.url} title={n.url} />
    return <StatusChip tone="neutral" label="ngrok · off" />
  })()

  const item = (label: string, sub: string | undefined, action: string, enabled: boolean) => (
    <button
      className={`block w-full rounded-lg px-3 py-2 text-left ${enabled ? 'hover:bg-slate-50' : 'cursor-not-allowed opacity-45'}`}
      disabled={!enabled || !!busy}
      onClick={() => { setOpen(false); act(action) }}
    >
      <div className="text-[13px] font-medium text-slate-800">{busy === action ? '⏳ ' : ''}{label}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </button>
  )

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {vercelChip}
        {ngrokChip}
        <div className="relative">
          <button
            className="rounded-full bg-blue-600 px-3.5 py-1 text-[12px] font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            disabled={!!busy}
            onClick={() => setOpen(o => !o)}
          >
            {busy ? 'Working…' : 'Share'}
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
              <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                {item(
                  share?.url ? 'Update on Vercel' : 'Publish to Vercel',
                  !v?.installed ? (v?.hint ?? 'vercel CLI missing') : !v?.authed ? (v?.hint ?? 'vercel login') : 'static snapshot · durable link · 14d TTL',
                  'publish', !!(v?.installed && v?.authed),
                )}
                {item(
                  n?.up ? 'Stop ngrok fallback' : 'Start ngrok fallback',
                  !n?.installed ? (n?.hint ?? 'ngrok missing') : n?.up ? 'tears down the tunnel + static server' : 'tunnels the exported site · while this machine is up',
                  n?.up ? 'ngrok-down' : 'ngrok-up', !!n?.installed,
                )}
                {item('Export bundle only', 'notes/pages/.share/<slug>/ — no upload', 'export', true)}
                {share?.url && item('Unpublish', 'remove from the shared site + redeploy', 'unpublish', true)}
                {st?.baseUrl && (
                  <a className="block rounded-lg px-3 py-2 text-[11px] text-slate-400 no-underline hover:bg-slate-50" href={st.baseUrl} target="_blank" rel="noreferrer">
                    overview: {st.baseUrl.replace(/^https:\/\//, '')}
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {msg && (
        <div className={`mt-2 text-right text-[11px] ${msg.tone === 'good' ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</div>
      )}
    </div>
  )
}

// Static exports: a quiet provenance line (and a loud one once the snapshot is expired).
function SnapshotBanner() {
  const s = typeof window !== 'undefined' ? window.__PAGE_SHARE__ : undefined
  if (!s) return null
  const fmt = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null)
  const expired = !!(s.expiresAt && Date.parse(s.expiresAt) < Date.now())
  if (expired) {
    return (
      <div className="mb-6 rounded-md border border-red-300 bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700">
        <strong className="font-semibold">This shared snapshot expired on {fmt(s.expiresAt)}.</strong>{' '}
        It may be out of date — ask for a fresh link.
      </div>
    )
  }
  return (
    <div className="mb-6 text-[11px] text-slate-400">
      Static snapshot · shared {fmt(s.sharedAt) ?? '—'} · {s.expiresAt ? `expires ${fmt(s.expiresAt)}` : 'no expiry'}
    </div>
  )
}

/* ---- structure -------------------------------------------------------- */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3.5 mt-[52px] text-2xl font-bold leading-tight tracking-[-0.015em]">{title}</h2>
      {children}
    </section>
  )
}

/* ---- side nav ("On this page") -----------------------------------------
   Auto-built from the headings rendered in the content column — the page <h1>,
   <Section> h2s, and h3/h4 subheads (<H3>, <Tasks> titles, <Markdown> headings)
   — as a leveled, indented index: a real left sidebar COLUMN that the main
   content sits beside (an in-flow flex child of <Page>, sticky as you scroll,
   hidden below lg so narrow viewports get the full width). Scroll-spied so the
   current heading is highlighted, click to jump. Nothing to author — any page
   with 2+ headings below the title gets it for free. Headings inside overlays
   and board cards carry data-toc-skip (boards get their own SideNavBoard block
   instead); decorative bits inside a heading (e.g. the <Tasks> phase chip)
   carry data-toc-ignore so they stay out of the index label. */
type TocItem = { id: string; title: string; level: number }
// indent + size per heading level: h1 (page title) flush and bold, deeper levels step right
const tocDepthCls: Record<number, string> = {
  1: 'pl-2 text-[12.5px] font-semibold',
  2: 'pl-4 text-[12.5px]',
  3: 'pl-6 text-[12px]',
  4: 'pl-8 text-[12px]',
}
function SideNav() {
  const [items, setItems] = useState<TocItem[]>([])
  const [active, setActive] = useState('')
  useEffect(() => {
    const headings = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-page-content] :is(h1, h2, h3, h4)'))
        .filter(el => !el.closest('[data-toc-skip]'))
    const labelOf = (el: HTMLElement) => {
      const clone = el.cloneNode(true) as HTMLElement
      clone.querySelectorAll('[data-toc-ignore]').forEach(n => n.remove())
      return clone.textContent?.trim() ?? ''
    }
    const scan = () => {
      const seen = new Set<string>()
      const list = headings()
        .map(el => {
          const title = labelOf(el)
          const base = el.id || title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'section'
          let id = base
          for (let n = 2; seen.has(id); n++) id = `${base}-${n}`
          seen.add(id)
          if (el.id !== id) el.id = id
          if (!el.style.scrollMarginTop) el.style.scrollMarginTop = '2rem'
          return { id, title, level: Number(el.tagName[1]) }
        })
        .filter(x => x.title)
      setItems(prev => (prev.length === list.length && prev.every((p, i) => p.id === list[i].id && p.title === list[i].title && p.level === list[i].level) ? prev : list))
    }
    scan()
    // childList-only observer: setting el.id/style above emits attribute mutations we must not loop on
    const mo = new MutationObserver(scan)
    mo.observe(document.body, { childList: true, subtree: true })
    const onScroll = () => {
      let cur = ''
      for (const el of headings()) if (el.getBoundingClientRect().top < 140) cur = el.id
      setActive(c => (c === cur ? c : cur))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { mo.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])
  const boards = useBoards()
  // require real structure below the page title before showing the index
  const showToc = items.filter(i => i.level >= 2).length >= 2
  if (!showToc && boards.length === 0) return null
  return (
    <nav aria-label="Sections" className="hidden w-56 shrink-0 pt-16 sm:pt-20 lg:block">
      <div className="sticky top-8 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-xl border border-slate-200/70 bg-white/85 p-2 shadow-sm backdrop-blur">
        {showToc && (
          <>
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">On this page</div>
            {items.map(it => (
              <a
                key={it.id}
                href={`#${it.id}`}
                onClick={e => {
                  e.preventDefault()
                  document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  history.replaceState(null, '', `#${it.id}`)
                }}
                className={`block truncate rounded-md py-1 pr-2 no-underline transition ${tocDepthCls[Math.min(Math.max(it.level, 1), 4)]} ${active === it.id ? 'bg-blue-600/8 font-semibold text-blue-700' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}
              >
                {it.title}
              </a>
            ))}
          </>
        )}
        {boards.map(b => <SideNavBoard key={b.uid} board={b} />)}
      </div>
    </nav>
  )
}

// Per-board block in the SideNav: progress bar + decided count + a jump list of every item,
// each dotted by its decision and clickable to scroll it into view (ux16/ux17).
function SideNavBoard({ board }: { board: BoardSummary }) {
  const pct = board.total ? Math.round((board.decided / board.total) * 100) : 0
  return (
    <div className="mt-2 border-t border-slate-100 pt-2 first:mt-0 first:border-t-0">
      <div className="flex items-baseline justify-between px-2 pb-1 pt-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Decisions</span>
        <span className="text-[10px] font-semibold tabular-nums text-slate-500">{board.decided}/{board.total}</span>
      </div>
      <div className="mx-2 mb-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-blue-600 transition-[width] duration-300" style={{ width: pct + '%' }} />
      </div>
      <div className="max-h-[42vh] overflow-y-auto">
        {board.items.map(it => (
          <button
            key={it.id}
            onClick={() => board.jump(it.id)}
            title={it.label}
            className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] no-underline transition ${it.focused ? 'bg-indigo-50 font-semibold text-indigo-700' : it.decision ? 'text-slate-500 hover:bg-slate-50' : 'text-slate-700 hover:bg-slate-50'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotFor(it.decision)}`} />
            <span className="truncate">{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2.5 mt-7 text-[17px] font-semibold">{children}</h3>
}
export function P({ children }: { children: ReactNode }) {
  return <p className="mb-3.5 leading-relaxed [&_a]:text-blue-600 [&_a]:underline [&_a]:underline-offset-2 [&_strong]:font-semibold [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700">{children}</p>
}
export function UL({ children, items }: { children?: ReactNode; items?: ReactNode[] }) {
  // `items` is an authoring convenience (and a real-world footgun repair: pages have
  // passed items={[…]} expecting it to work, and the list silently rendered empty).
  return <ul className="mb-4 list-disc space-y-1 pl-6 leading-relaxed marker:text-slate-400 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700 [&_strong]:font-semibold">{items ? items.map((x, i) => <li key={i}>{x}</li>) : children}</ul>
}
export function Pre({ children }: { children: ReactNode }) {
  return <pre className="mb-4 overflow-x-auto rounded-md bg-slate-100 px-4 py-3.5 font-mono text-[13px] leading-relaxed text-slate-700">{children}</pre>
}

// Markdown — render a GitHub-flavored markdown string (headings, bold, code,
// fenced blocks, lists, tables, links) as styled HTML. Content is trusted (authored
// in the page source), so it's injected directly. Great for PR bodies / release notes.
export function Markdown({ children }: { children: string }) {
  const html = useMemo(
    () => marked.parse(String(children ?? ''), { async: false, gfm: true }) as string,
    [children],
  )
  return (
    <div className="mb-4">
      <style>{`
        .page-md{color:#334155;font-size:15px;line-height:1.65}
        .page-md > :first-child{margin-top:0}
        .page-md h1{font-size:1.55rem;font-weight:700;margin:1.4rem 0 .7rem;color:#0f172a}
        .page-md h2{font-size:1.25rem;font-weight:700;margin:1.3rem 0 .55rem;color:#0f172a}
        .page-md h3{font-size:1.05rem;font-weight:600;margin:1.1rem 0 .45rem;color:#0f172a}
        .page-md p{margin:.6rem 0}
        .page-md ul{list-style:disc;padding-left:1.4rem;margin:.6rem 0}
        .page-md ol{list-style:decimal;padding-left:1.4rem;margin:.6rem 0}
        .page-md li{margin:.25rem 0}
        .page-md code{background:#f1f5f9;padding:.1rem .35rem;border-radius:4px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:.88em}
        .page-md pre{background:#f1f5f9;padding:.8rem 1rem;border-radius:6px;overflow-x:auto;margin:.8rem 0}
        .page-md pre code{background:none;padding:0;font-size:.82rem;line-height:1.5}
        .page-md a{color:#2563eb;text-decoration:underline}
        .page-md strong{font-weight:600;color:#0f172a}
        .page-md em{font-style:italic}
        .page-md table{border-collapse:collapse;margin:.8rem 0;display:block;overflow-x:auto;font-size:13px}
        .page-md th,.page-md td{border:1px solid #e2e8f0;padding:.4rem .7rem;text-align:left;vertical-align:top}
        .page-md th{background:#f8fafc;font-weight:600;color:#0f172a}
        .page-md hr{border:0;border-top:1px solid #e2e8f0;margin:1.4rem 0}
        .page-md blockquote{border-left:3px solid #e2e8f0;padding-left:1rem;color:#64748b;margin:.8rem 0}
      `}</style>
      <div className="page-md" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

/* ---- multi-page sets (board / plans / tracker) -------------------------
   Every triage/bug-bash round used to hand-roll these; they're primitives now.
   <PageLink> is an in-daemon link to another page; <PageTabs> is the strip
   linking the sibling pages of a set (board / plans / tracker). */
export function PageLink({ slug, children }: { slug: string; children: ReactNode }) {
  return (
    <a href={`/p/${slug}`} className="text-blue-600 underline underline-offset-2 hover:text-blue-700">
      {children}
    </a>
  )
}
export function PageTabs({ tabs, current }: { tabs: { label: string; slug: string }[]; current: string }) {
  return (
    <div className="mb-6 flex gap-1 border-b border-slate-200">
      {tabs.map(t => (
        <a
          key={t.slug}
          href={`/p/${t.slug}`}
          className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium no-underline transition-colors ${t.slug === current ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
        >
          {t.label}
        </a>
      ))}
    </div>
  )
}
// Tracker status chips — the vocabulary every round's tracker table reuses.
const trackerTone: Record<string, { tone: keyof typeof pillTone; label: string }> = {
  merged: { tone: 'primary', label: 'merged' },
  'in-review': { tone: 'good', label: 'in review' },
  branch: { tone: 'warn', label: 'branch started' },
  plan: { tone: 'neutral', label: 'plan ready' },
  awaiting: { tone: 'neutral', label: 'awaiting decision' },
  blocked: { tone: 'bad', label: 'blocked' },
}
export function TrackerStatus({ s }: { s: keyof typeof trackerTone | (string & {}) }) {
  const t = trackerTone[s] ?? { tone: 'neutral' as const, label: s }
  return <Pill tone={t.tone}>{t.label}</Pill>
}

/* ---- Linear ticket ------------------------------------------------------
   A ticket rendered the way Linear renders an issue: status donut + identifier +
   title header, a property-chip row (status, assignee, team, project, parent,
   labels), the description as real markdown (via <Markdown>, so it reads exactly
   as it does in Linear), then attachment chips, related-issue chips, and
   sub-issue rows. Status names cover the workspace vocabulary below; unknown
   names fall back via `statusType` (Linear's backlog/unstarted/started/
   completed/canceled) so custom state names on other teams still get the right
   icon + color. Provenance is explicit and unmissable in both directions:
   a ticket WITH an `id` is a mirror of a real Linear issue and wears a quiet
   "mirrored from Linear · <fetched>" stamp (pass `fetched` with the pull date);
   a ticket WITHOUT an `id` is a DRAFT that exists only on the page — amber
   dashed border, "DRAFT — not yet in Linear" badge, and an amber footer — for
   planning pages that show a paste-ready ticket before it is filed. */
type TicketDot =
  | { kind: 'dashed'; color: string }
  | { kind: 'hollow'; color: string }
  | { kind: 'pie'; color: string; frac: number }
  | { kind: 'done'; color: string }
  | { kind: 'x'; color: string }
const ticketStatusSpec: Record<string, TicketDot> = {
  Triage: { kind: 'hollow', color: '#6e79d6' },
  Backlog: { kind: 'dashed', color: '#bec2c8' },
  Todo: { kind: 'hollow', color: '#b8bcc4' },
  'In Progress': { kind: 'pie', color: '#f2c94c', frac: 0.5 },
  'In Review': { kind: 'pie', color: '#26b5ce', frac: 0.75 },
  'PR Feedback Loop': { kind: 'pie', color: '#f2994a', frac: 0.75 },
  Paused: { kind: 'pie', color: '#95a2b3', frac: 0.5 },
  Done: { kind: 'done', color: '#5e6ad2' },
  Canceled: { kind: 'x', color: '#95a2b3' },
  Duplicate: { kind: 'x', color: '#95a2b3' },
}
const ticketTypeSpec: Record<string, TicketDot> = {
  triage: ticketStatusSpec.Triage,
  backlog: ticketStatusSpec.Backlog,
  unstarted: ticketStatusSpec.Todo,
  started: ticketStatusSpec['In Progress'],
  completed: ticketStatusSpec.Done,
  canceled: ticketStatusSpec.Canceled,
  duplicate: ticketStatusSpec.Duplicate,
}
function TicketStatusDot({ spec, size = 14 }: { spec: TicketDot; size?: number }) {
  const c = size / 2
  const r = c - 1.5
  const wedge = (frac: number) => {
    const a = frac * 2 * Math.PI - Math.PI / 2
    const rw = r - 1.75
    return `M${c},${c} L${c},${c - rw} A${rw},${rw} 0 ${frac > 0.5 ? 1 : 0} 1 ${c + rw * Math.cos(a)},${c + rw * Math.sin(a)} Z`
  }
  const inner = (() => {
    if (spec.kind === 'dashed') {
      return <circle cx={c} cy={c} r={r} fill="none" stroke={spec.color} strokeWidth="1.6" strokeDasharray="2 1.7" />
    } else if (spec.kind === 'hollow') {
      return <circle cx={c} cy={c} r={r} fill="none" stroke={spec.color} strokeWidth="1.6" />
    } else if (spec.kind === 'pie') {
      return <>
        <circle cx={c} cy={c} r={r} fill="none" stroke={spec.color} strokeWidth="1.6" />
        <path d={spec.frac >= 1 ? '' : wedge(spec.frac)} fill={spec.color} />
      </>
    } else if (spec.kind === 'done') {
      return <>
        <circle cx={c} cy={c} r={r + 0.75} fill={spec.color} />
        <path d={`M${c - r * 0.52},${c} l${r * 0.36},${r * 0.42} l${r * 0.66},${r * -0.78}`} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    } else if (spec.kind === 'x') {
      return <>
        <circle cx={c} cy={c} r={r + 0.75} fill={spec.color} />
        <path d={`M${c - r * 0.42},${c - r * 0.42} L${c + r * 0.42},${c + r * 0.42} M${c + r * 0.42},${c - r * 0.42} L${c - r * 0.42},${c + r * 0.42}`} stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </>
    } else {
      throw new Error(`unknown ticket dot ${(spec satisfies never as TicketDot).kind}`)
    }
  })()
  return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden>{inner}</svg>
}
function TicketChip({ href, title, children }: { href?: string; title?: string; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-[3px] text-[12px] font-medium text-slate-600 no-underline'
  return href
    ? <a href={href} target="_blank" rel="noreferrer" className={`${cls} hover:border-slate-300 hover:text-slate-900`} title={title}>{children}</a>
    : <span className={cls} title={title}>{children}</span>
}
type TicketRef = { id: string; title?: ReactNode; url?: string; status?: string; statusType?: string }
function ticketDotFor(status?: string, statusType?: string): TicketDot {
  return (status && ticketStatusSpec[status]) || (statusType && ticketTypeSpec[statusType]) || ticketStatusSpec.Todo
}
export function LinearTicket({ id, url, title, status, statusType, assignee, team, project, parent, relations, subIssues, links, labels, markdown, fetched, children }: {
  id?: string; url?: string; title: ReactNode
  status?: string; statusType?: string
  assignee?: string; team?: string
  project?: { name: string; url?: string; icon?: ReactNode }
  parent?: TicketRef
  relations?: TicketRef[]
  subIssues?: TicketRef[]
  links?: { label: ReactNode; url: string }[]
  labels?: ReactNode[]
  markdown?: string
  /** when the data was pulled from Linear — shown in the "mirrored from Linear" stamp on filed tickets */
  fetched?: string
  children?: ReactNode
}) {
  const dot = ticketDotFor(status, statusType)
  const isDraft = !id
  const initials = assignee ? assignee.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() : null
  const subRow = (t: TicketRef, tag?: string) => (
    <div key={t.id} className="flex min-w-0 items-center gap-2.5 py-[7px] text-[13px]">
      {tag
        ? <span className="w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-slate-400">{tag}</span>
        : <TicketStatusDot spec={ticketDotFor(t.status, t.statusType)} size={13} />}
      <a href={t.url} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[12px] font-semibold text-slate-500 no-underline hover:text-blue-600">{t.id}</a>
      <span className="min-w-0 truncate text-slate-700">{t.title}</span>
      {t.status && <span className="ml-auto shrink-0 text-[11px] font-medium text-slate-400">{t.status}</span>}
    </div>
  )
  return (
    <div data-toc-skip className={`mb-5 overflow-hidden rounded-xl bg-white shadow-sm ${isDraft ? 'border-2 border-dashed border-amber-400/80' : 'border border-slate-200'}`}>
      <div className={`border-b px-5 pb-3.5 pt-4 ${isDraft ? 'border-amber-200/80 bg-amber-50/70' : 'border-slate-100'}`}>
        <div className="flex items-center gap-2">
          <TicketStatusDot spec={dot} />
          {id
            ? <a href={url} target="_blank" rel="noreferrer" className="font-mono text-[13px] font-semibold text-slate-500 no-underline hover:text-blue-600">{id}</a>
            : <span className="rounded border border-dashed border-amber-500/60 bg-amber-100/90 px-2 py-px text-[10px] font-bold uppercase tracking-wider text-amber-800">Draft — not yet in Linear</span>}
          {parent && (
            <span className="min-w-0 truncate text-[12px] text-slate-400">
              ‹ <a href={parent.url} target="_blank" rel="noreferrer" className="text-slate-400 no-underline hover:text-blue-600">{parent.id}{parent.title ? <> · {parent.title}</> : null}</a>
            </span>
          )}
          {isDraft
            ? <span className="ml-auto shrink-0 text-[11px] font-semibold text-amber-700">exists only on this page</span>
            : (
              <a href={url} target="_blank" rel="noreferrer" title="This card mirrors the live issue in Linear — open it there" className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-slate-400 no-underline hover:text-blue-600">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
                mirrored from Linear{fetched ? ` · ${fetched}` : ''}
              </a>
            )}
        </div>
        <div className="mt-1.5 text-[17px] font-semibold leading-snug tracking-[-0.01em]">
          {url ? <a href={url} target="_blank" rel="noreferrer" className="text-slate-900 no-underline hover:text-blue-700">{title}</a> : title}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {status && <TicketChip><TicketStatusDot spec={dot} size={12} />{status}</TicketChip>}
          {assignee && <TicketChip title={assignee}><span className="flex h-4 w-4 items-center justify-center rounded-full bg-indigo-500 text-[8px] font-bold text-white">{initials}</span>{assignee}</TicketChip>}
          {team && <TicketChip>{team}</TicketChip>}
          {project && <TicketChip href={project.url} title="Linear project">{project.icon && <span className="text-[12px] leading-none">{project.icon}</span>}{project.name}</TicketChip>}
          {labels?.map((l, i) => <TicketChip key={i}><span className="h-2 w-2 rounded-full bg-slate-300" />{l}</TicketChip>)}
        </div>
      </div>
      <div className="px-5 py-4">
        {markdown ? <Markdown>{markdown}</Markdown> : children}
      </div>
      {isDraft && (
        <div className="border-t border-dashed border-amber-300/80 bg-amber-50/70 px-5 py-2.5 text-[12px] font-medium text-amber-800">
          ✎ This is a draft — it has not been filed in Linear. Once filed, swap in the real <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">id</code>, <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">url</code>, and <code className="rounded bg-amber-100 px-1 font-mono text-[11px]">status</code> so the card becomes a mirror.
        </div>
      )}
      {links && links.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-slate-100 px-5 py-3">
          {links.map((l, i) => (
            <TicketChip key={i} href={l.url} title={l.url}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
              {l.label}
            </TicketChip>
          ))}
        </div>
      )}
      {((relations && relations.length > 0) || (subIssues && subIssues.length > 0)) && (
        <div className="divide-y divide-slate-100 border-t border-slate-100 bg-slate-50/70 px-5 py-1.5">
          {relations?.map(r => subRow(r, 'related'))}
          {subIssues?.map(s => subRow(s))}
        </div>
      )}
    </div>
  )
}

/* ---- Wide (deprecated no-op) ------------------------------------------
   Was: break a block out of the prose column and center it wider. That
   breakout is GONE — the content column now fills the width beside the left
   sidebar, so every block already spans the full measure and nothing overflows
   the page. Kept only as a passthrough so existing pages that still wrap a
   block in <Wide> keep rendering; it no longer widens or offsets anything.
   Don't reach for it in new pages. */
export function Wide({ children }: { width?: number; children: ReactNode }) {
  return <div className="my-5">{children}</div>
}
/* ---- gallery ---------------------------------------------------------- */
// Responsive equal-column grid for side-by-side artifacts (device mockups,
// option frames, before/after screens). Each child gets its own cell + real
// gap — no abutting/overlap. Fills the content column like everything else.
export function Gallery({ cols = 3, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const c = { 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols]
  return <div className={`mb-[18px] grid grid-cols-1 gap-5 ${c}`}>{children}</div>
}
// A single titled artifact cell for a <Gallery> — centers its content (a phone
// frame, a screen) and hangs a caption underneath, so a row of them reads evenly.
export function GalleryItem({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex w-full justify-center [&_img]:mx-auto [&_img]:block [&_img]:max-h-[70vh] [&_img]:w-auto [&_img]:max-w-full">{children}</div>
      {label && <div className="text-center text-[13px] font-medium text-slate-500">{label}</div>}
    </div>
  )
}

/* ---- cards ------------------------------------------------------------ */
const pillTone: Record<string, string> = {
  primary: 'bg-blue-600 text-white', good: 'bg-green-600/12 text-green-700', warn: 'bg-amber-600/12 text-amber-700',
  bad: 'bg-red-600/12 text-red-600', neutral: 'bg-slate-200 text-slate-600',
}
export function Pill({ tone = 'neutral', children }: { tone?: keyof typeof pillTone; children: ReactNode }) {
  return <span className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${pillTone[tone]}`}>{children}</span>
}

/* ---- live GitHub PR status (shared) ----------------------------------- */
// Fetches /api/gh/pr/<n> (backed by `gh pr view` on the dev server), renders a clickable
// "#NNNN <state>" chip that links to the PR, and polls so the status stays live. Drop
// <PrStatus pr={3721} /> into any plan. The poll only runs while the PR is non-terminal
// (open/draft); merged/closed PRs stop polling.
type PrInfo = {
  ok: boolean
  number?: number
  state?: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft?: boolean
  merge?: string
  checks?: 'pass' | 'fail' | 'pending' | 'none'
  url?: string
  title?: string
  error?: string
}
function prLabel(d: PrInfo): { tone: keyof typeof pillTone; text: string } {
  if (!d.ok) return { tone: 'neutral', text: 'unknown' }
  if (d.state === 'MERGED') return { tone: 'primary', text: 'merged' }
  if (d.state === 'CLOSED') return { tone: 'bad', text: 'closed' }
  if (d.isDraft) return { tone: 'neutral', text: 'draft' }
  // OPEN: GitHub's mergeStateStatus is the most reliable single signal; fall back to the
  // raw check rollup when it's UNKNOWN (GitHub computes it lazily).
  if (d.merge === 'DIRTY') return { tone: 'bad', text: 'conflicts' }
  if (d.merge === 'BEHIND') return { tone: 'warn', text: 'behind main' }
  if (d.merge === 'BLOCKED') return { tone: 'warn', text: 'blocked' }
  if (d.merge === 'UNSTABLE') return { tone: 'warn', text: 'checks failing' }
  if (d.merge === 'CLEAN' || d.merge === 'HAS_HOOKS') return { tone: 'good', text: 'ready' }
  if (d.checks === 'fail') return { tone: 'warn', text: 'checks failing' }
  if (d.checks === 'pending') return { tone: 'warn', text: 'open · checks…' }
  return { tone: 'warn', text: 'open' }
}
export function PrStatus({ pr, poll = true }: { pr: number; poll?: boolean }) {
  const [d, setD] = useState<PrInfo | null>(null)
  useEffect(() => {
    // static snapshot: the dev-server gh endpoint doesn't exist — share.mjs baked the
    // status at export time; render it frozen (the chip still links to the live PR)
    if (IS_STATIC) {
      setD(window.__PAGE_GH__?.[String(pr)] ?? { ok: false, error: 'not in snapshot' })
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      let ok = false
      try {
        const r = await fetch(`/api/gh/pr/${pr}`)
        const j: PrInfo = await r.json()
        if (!alive) return
        ok = !!j.ok
        // keep the last good value on a transient error rather than flashing "unknown"
        setD(prev => (j.ok || !prev ? j : prev))
        if (poll && j.ok && j.state !== 'OPEN') return // terminal — stop polling
      } catch {
        if (!alive) return
        setD(prev => prev || { ok: false, error: 'fetch failed' })
      }
      // poll on: open PRs (live) and transient errors (retry sooner)
      if (poll) timer = setTimeout(tick, ok ? 30_000 : 15_000)
    }
    tick()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [pr, poll])

  const href = d?.url || `https://github.com/Abzorb-it/Retainit/pull/${pr}`
  const { tone, text } = d ? prLabel(d) : { tone: 'neutral' as const, text: '…' }
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 no-underline hover:opacity-80" title={d?.title || ''}>
      <code className="rounded bg-slate-100 px-1.5 py-px font-mono text-[0.85em] text-slate-700">#{pr}</code>
      <Pill tone={tone}>{text}</Pill>
    </a>
  )
}
export function Cards({ flat = false, children }: { flat?: boolean; children: ReactNode }) {
  return <div className={`mb-[18px] flex flex-col gap-3 ${flat ? 'plan-cards-flat' : ''}`}>{children}</div>
}
export function Card({ rank, title, pills, variant, children }: {
  rank?: ReactNode; title?: ReactNode; pills?: ReactNode; variant?: 'primary' | 'bad'; children: ReactNode
}) {
  const border = variant === 'primary' ? 'border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]'
    : variant === 'bad' ? 'border-red-600/45 shadow-[0_0_0_3px_rgba(220,38,38,0.07)]' : 'border-slate-200'
  return (
    <div className={`grid grid-cols-[44px_1fr] gap-3.5 rounded-lg border bg-white px-[18px] py-3.5 ${border} [.plan-cards-flat_&]:grid-cols-1`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-[15px] font-bold [.plan-cards-flat_&]:hidden ${variant === 'primary' ? 'bg-blue-600 text-white' : variant === 'bad' ? 'bg-red-600/12 text-red-600' : 'bg-blue-600/8 text-blue-600'}`}>{rank}</div>
      <div>
        {(title || pills) && (
          <div className="mb-1 flex flex-wrap items-center gap-2">
            {title && <span className="text-[15px] font-semibold">{title}</span>}
            {pills}
          </div>
        )}
        <div className="text-sm leading-relaxed text-slate-600 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700 [&_p]:m-0 [&_strong]:font-semibold">{children}</div>
      </div>
    </div>
  )
}

/* ---- choices ---------------------------------------------------------- */
export function Choices({ cols = 2, children }: { cols?: 2 | 3; children: ReactNode }) {
  return <div className={`mb-[18px] grid gap-3.5 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</div>
}
export function Choice({ title, tag, recommended, pros, cons, children }: {
  title: ReactNode; tag?: ReactNode; recommended?: boolean; pros?: ReactNode[]; cons?: ReactNode[]; children?: ReactNode
}) {
  return (
    <div className={`rounded-lg border bg-white px-5 py-[18px] ${recommended ? 'border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]' : 'border-slate-200'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-base font-semibold">{title}</span>
        {tag && <span className={`flex-shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${recommended ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{tag}</span>}
      </div>
      <div className="text-sm leading-snug [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700 [&_p]:mb-2">{children}</div>
      {pros && <><p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Pros</p><ul className="mt-1 list-disc pl-[1.1em] text-[13px] marker:text-green-600">{pros.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {cons && <><p className="mt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Cons</p><ul className="mt-1 list-disc pl-[1.1em] text-[13px] marker:text-red-600">{cons.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
    </div>
  )
}

/* ---- before / after ---------------------------------------------------
   One self-contained comparison CARD: a header with the mode selector, then the view.
     • Click to swap — one pane, click toggles before⇄after (DEFAULT; shows AFTER first
                       so the after is what you read, and you click to inspect the before)
     • Side by side  — both panes
     • Swipe         — overlay with a draggable reveal divider
     • Diff          — one pane showing the pixel diff (only when `diff` is passed)
   Always prefer showing the AFTER when a single image is shown. Images are height-capped
   (max-h-[70vh], aspect preserved). Swipe/swap need before+after at the same dimensions. */
type CompareMode = 'swap' | 'side' | 'swipe' | 'diff'
export function BeforeAfter({ beforeLabel = 'Before', afterLabel = 'After', before, after, diff }: {
  beforeLabel?: string; afterLabel?: string; before: ReactNode; after: ReactNode; diff?: ReactNode
}) {
  const modes: { k: CompareMode; label: string }[] = [
    { k: 'swap', label: 'Click to swap' },
    { k: 'side', label: 'Side by side' },
    { k: 'swipe', label: 'Swipe' },
    ...(diff ? [{ k: 'diff' as CompareMode, label: 'Diff' }] : []),
  ]
  const [mode, setMode] = useState<CompareMode>('swap')
  const [showAfter, setShowAfter] = useState(true) // prefer AFTER
  const [pos, setPos] = useState(50)
  const [full, setFull] = useState(false)
  const railRef = useRef<HTMLDivElement>(null)
  const swipeTo = (clientX: number) => {
    const el = railRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  // Window-level listeners while dragging — robust across the clipped overlay (which still
  // hit-tests its full box) and pointer-capture quirks. The inner imgs are pointer-events-none
  // so the gesture never starts a native image drag.
  const startSwipe = (e: React.PointerEvent) => {
    e.preventDefault()
    swipeTo(e.clientX)
    const move = (ev: PointerEvent) => swipeTo(ev.clientX)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // Fullscreen: close on Escape, lock body scroll while the overlay is open.
  useEffect(() => {
    if (!full) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prevOverflow }
  }, [full])
  // pointer-events-none + draggable-off on inner imgs so the swipe gesture drags the DIVIDER,
  // not the browser's native image-drag ghost (which froze the comparison). Two static caps
  // (70vh inline, 92vh fullscreen) — kept as literals so Tailwind's JIT scanner emits both.
  const imgBase = '[&_img]:block [&_img]:h-auto [&_img]:w-full [&_img]:object-contain [&_img]:select-none'
  const iwInline = `${imgBase} [&_img]:max-h-[70vh]`
  const iwFull = `${imgBase} [&_img]:max-h-[92vh]`
  const noDragImg = '[&_img]:pointer-events-none'
  const tag = 'rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest'
  const label = 'border-b border-slate-200 px-3.5 py-2 text-[10px] font-bold uppercase tracking-widest'

  const modeBar = (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1">
      {modes.map(m => (
        <button
          key={m.k}
          onClick={() => setMode(m.k)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition ${mode === m.k ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-700'}`}
        >
          {m.label}
        </button>
      ))}
    </div>
  )

  // The four comparison views, parameterised by the image-height cap so the inline card and the
  // fullscreen overlay render byte-identically at different sizes.
  const body = (iw: string) => (
    <>
      {mode === 'side' && (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="overflow-hidden rounded-lg border border-red-600/35 bg-white">
            <div className={`${label} bg-red-600/[0.04] text-red-600`}>{beforeLabel}</div>
            <div className={`p-3 ${iw}`}>{before}</div>
          </div>
          <div className="overflow-hidden rounded-lg border border-blue-600 bg-white shadow-[0_0_0_3px_rgba(37,99,235,0.08)]">
            <div className={`${label} bg-blue-600/8 text-blue-600`}>{afterLabel}</div>
            <div className={`p-3 ${iw}`}>{after}</div>
          </div>
        </div>
      )}

      {mode === 'swipe' && (
        <div
          ref={railRef}
          onDragStart={e => e.preventDefault()}
          className={`relative cursor-ew-resize touch-none select-none overflow-hidden rounded-lg border border-slate-200 bg-white ${iw} ${noDragImg}`}
          onPointerDown={startSwipe}
        >
          <div>{before}</div>
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>{after}</div>
          <div className="pointer-events-none absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-blue-500" style={{ left: `${pos}%` }}>
            <div className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-blue-500 bg-white text-[11px] text-blue-600 shadow">↔</div>
          </div>
          <span className={`pointer-events-none absolute left-2 top-2 z-10 ${tag} bg-red-600/80 text-white`}>{beforeLabel}</span>
          <span className={`pointer-events-none absolute right-2 top-2 z-10 ${tag} bg-blue-600/80 text-white`}>{afterLabel}</span>
        </div>
      )}

      {mode === 'swap' && (
        <button
          onClick={() => setShowAfter(s => !s)}
          className={`block w-full overflow-hidden rounded-lg border bg-white text-left ${showAfter ? 'border-blue-600 shadow-[0_0_0_3px_rgba(37,99,235,0.08)]' : 'border-red-600/50'}`}
        >
          <div className={`flex items-center justify-between ${label} ${showAfter ? 'bg-blue-600/8 text-blue-600' : 'bg-red-600/[0.04] text-red-600'}`}>
            <span>{showAfter ? afterLabel : beforeLabel}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-slate-500">click to see {showAfter ? beforeLabel.toLowerCase() : afterLabel.toLowerCase()}</span>
          </div>
          <div className={`p-3 ${iw}`}>{showAfter ? after : before}</div>
        </button>
      )}

      {mode === 'diff' && diff && (
        <div className="overflow-hidden rounded-lg border border-amber-600 bg-white">
          <div className={`${label} bg-amber-600/[0.06] text-amber-700`}>Diff — changed pixels highlighted</div>
          <div className={`p-3 ${iw}`}>{diff}</div>
        </div>
      )}
    </>
  )

  return (
    <div className="mb-[18px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5">
        <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Compare</span>
        {modeBar}
        <button
          onClick={() => setFull(true)}
          title="Fullscreen"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
        >
          <span className="text-[13px] leading-none">⛶</span> Fullscreen
        </button>
      </div>

      <div className="p-4">{body(iwInline)}</div>

      {full && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[9999] flex flex-col bg-slate-950/95 motion-safe:animate-[fadeIn_120ms_ease-out] supports-[backdrop-filter]:backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Compare</span>
            {modeBar}
            <button
              onClick={() => setFull(false)}
              title="Close (Esc)"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10"
            >
              ✕ Close <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] tracking-normal text-slate-400">Esc</span>
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4 sm:p-6">{body(iwFull)}</div>
        </div>
      )}
    </div>
  )
}

/* ---- callout ---------------------------------------------------------- */
export function Callout({ tone = 'info', children }: { tone?: 'info' | 'good' | 'warn'; children: ReactNode }) {
  const map = { info: ['border-blue-600 bg-blue-600/8', 'bg-blue-600', 'i'], good: ['border-green-600 bg-green-600/[0.07]', 'bg-green-600', '✓'], warn: ['border-red-600 bg-red-600/[0.07]', 'bg-red-600', '!'] } as const
  const [box, dot, icon] = map[tone]
  return (
    <div className={`mb-4 flex gap-3 rounded-md border-l-[3px] px-[18px] py-3.5 ${box}`}>
      <span className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold text-white ${dot}`}>{icon}</span>
      <div className="text-sm leading-snug [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_p:last-child]:mb-0 [&_strong]:font-semibold">{children}</div>
    </div>
  )
}

/* ---- diagram (raw SVG/JSX passthrough) -------------------------------- */
export function Diagram({ caption, children }: { caption?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/70 p-6">
      <div className="[&_svg]:block [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full">{children}</div>
      {caption && <div className="mt-3 text-center text-[13px] text-slate-500">{caption}</div>}
    </div>
  )
}

/* ---- mockup ----------------------------------------------------------- */
export function Mockup({ bar, children }: { bar?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3.5 py-2 font-mono text-xs text-slate-400">{bar}</div>
      <div className="p-[18px] text-sm [&_img]:mx-auto [&_img]:block [&_img]:max-h-[70vh] [&_img]:w-auto [&_img]:max-w-full">{children}</div>
    </div>
  )
}

/* ---- kv table ---------------------------------------------------------
   from → to mapping (renames, schema moves, env audits). The `from`/`to` cells
   are mono and stay on one line — keep them to short identifiers. Long, prose
   values belong in the wrapping `note` column (or use <Cards>), not in `to`. */
export function KvTable({ rows }: { rows: { from: ReactNode; to?: ReactNode; note?: ReactNode }[] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full bg-white text-[13px] [border-collapse:collapse]">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-200 first:border-t-0">
              <td className="whitespace-nowrap px-3.5 py-2 align-top font-mono text-xs text-slate-600">{r.from}</td>
              {r.to !== undefined && <td className="w-5 px-1 py-2 text-center align-top text-slate-400">→</td>}
              {r.to !== undefined && <td className="px-3.5 py-2 align-top font-mono text-xs font-medium text-blue-600">{r.to}</td>}
              {r.note !== undefined && <td className="px-3.5 py-2 align-top text-[12.5px] text-slate-600">{r.note}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---- stats (report metric tiles) ------------------------------------- */
export function Stats({ children }: { children: ReactNode }) {
  return <div className="mb-[18px] grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
}
export function Stat({ value, label, tone = 'ink', delta }: { value: ReactNode; label: ReactNode; tone?: 'ink' | 'good' | 'bad' | 'warn'; delta?: ReactNode }) {
  const c = { ink: 'text-slate-900', good: 'text-green-600', bad: 'text-red-600', warn: 'text-amber-600' }[tone]
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className={`text-2xl font-bold tabular-nums ${c}`}>{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {delta && <div className="mt-1 text-xs text-slate-500">{delta}</div>}
    </div>
  )
}

/* ---- timeline (RCA / postmortem events) ------------------------------ */
export function Timeline({ items }: { items: { time: ReactNode; title: ReactNode; body?: ReactNode; tone?: 'ink' | 'bad' | 'good' | 'warn' }[] }) {
  const dot = { ink: 'bg-slate-400', bad: 'bg-red-600', good: 'bg-green-600', warn: 'bg-amber-600' }
  return (
    <ol className="mb-[18px] ml-2 list-none border-l border-slate-200 pl-0">
      {items.map((it, i) => (
        <li key={i} className="relative mb-4 pl-5 last:mb-0">
          <span className={`absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full ring-2 ring-white ${dot[it.tone ?? 'ink']}`} />
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[11px] text-slate-400">{it.time}</span>
            <span className="text-sm font-semibold">{it.title}</span>
          </div>
          {it.body && <div className="mt-0.5 text-[13px] leading-snug text-slate-600">{it.body}</div>}
        </li>
      ))}
    </ol>
  )
}

/* ---- decision table (N×M short-cell matrix) --------------------------
   Keep cells SHORT — if a cell wants a paragraph, use <Cards> instead. A
   genuinely wide matrix (many columns) scrolls horizontally within the content
   column rather than collapsing columns or overflowing the page. */
export function DecisionTable({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full min-w-[34rem] bg-white text-[13px] [border-collapse:collapse]">
        <thead><tr>{head.map((h, i) => <th key={i} className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} className="border-t border-slate-200 first:border-t-0">
            {r.map((c, j) => <td key={j} className="px-4 py-2.5 align-top [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700">{c}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

/* ---- flow timeline (animated e2e flow viewer) ------------------------------
   One events[] array → a device with a cursor that animates to each tap, a draggable +
   clickable rail, and a clickable synced log. Define a flow by passing `screens`
   (concept: screenName → live React) or `frames` (replay: screenName → image url).
   <FlowCompare> drives two flows from one shared scrubber. */
export type FlowEvent = { t: number; type: 'launch' | 'tap' | 'type' | 'navigate' | 'assert' | 'screenshot'; label: ReactNode; screen?: string; x?: number; y?: number }
export type FlowState = { time: number; index: number; event: FlowEvent; screen?: string }
export type ScreenMap = Record<string, (s: FlowState) => ReactNode>
export type FrameMap = Record<string, string>
// A screen recording + the keyframes (named screenshot moments) captured during it,
// as wall-clock offsets from the recording start. The viewer seeks the video to the
// scrubber time between keyframes, and snaps to the crisp keyframe still (frames[name])
// at each keyframe. This is the "video mode" replay produced by the e2e harness.
export type FlowKeyframe = { name: string; tMs: number }
export type FlowVideo = { src: string; keyframes: FlowKeyframe[] }
export type Flow = { label?: ReactNode; mode?: 'concept' | 'replay'; events: FlowEvent[]; screens?: ScreenMap; frames?: FrameMap; video?: FlowVideo }
// One environment's recording within a replay flow. A <FlowTimeline> can hold several
// tracks (web big, web small, mobile, …); the viewer shows a selector and labels the
// active track by platform/size. Each track carries its own video, keyframe stills,
// and frame dimensions (a wide desktop track vs a tall phone track).
export type FlowTrack = {
  label?: string
  platform: string
  size?: string
  video: FlowVideo
  frames?: FrameMap
  events?: FlowEvent[]
  duration?: number
  width?: number
  height?: number
  fit?: 'cover' | 'contain'
  // Source recording dimensions — tap/event x,y are in these pixels; the viewer scales
  // them to the displayed width/height. Omit if events use display-space coords.
  srcWidth?: number
  srcHeight?: number
  // Alignment escape hatch. Positive when the VIDEO lags the event clock — i.e. the
  // action recorded at event-time `e.t` doesn't appear on screen until `e.t + offsetMs/1000`
  // (a `screenrecord` head-latency, or dead time from a mid-capture Metro "Downloading…"
  // stall). The viewer subtracts it from `video.currentTime` so markers line up with the
  // picture. Default 0 → unchanged. Prefer fixing the capture (prewarm + anchor t0 to the
  // first frame); use this to rescue an already-captured clip without a re-record.
  offsetMs?: number
}
const trackEnvLabel = (tr: FlowTrack) => tr.label ?? ([tr.platform, tr.size].filter(Boolean).join(' · ') || 'replay')
const trackDuration = (tr: FlowTrack) => tr.duration ?? tr.video.keyframes.reduce((m, k) => Math.max(m, k.tMs), 0) / 1000 + 1
// Keyframe times (s) that sit in a "crowded" run — a neighbouring keyframe within
// `clusterGapMs`. These are the states that flash by too fast to read because their inputs
// fired in quick succession, so the replay viewer briefly pauses on them. Well-spaced
// keyframes return none, so nothing changes for calm flows.
function crowdedKeyframes(kfs: FlowKeyframe[], clusterGapMs: number): number[] {
  const ts = kfs.map(k => k.tMs).sort((a, b) => a - b)
  const out: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const prevClose = i > 0 && ts[i] - ts[i - 1] < clusterGapMs
    const nextClose = i < ts.length - 1 && ts[i + 1] - ts[i] < clusterGapMs
    if (prevClose || nextClose) out.push(ts[i] / 1000)
  }
  return out
}

const FT_TYPES: Record<string, { c: string; n: string }> = {
  launch: { c: '#475569', n: 'LAUNCH' }, tap: { c: '#2563eb', n: 'TAP' }, type: { c: '#8b5cf6', n: 'TYPE' },
  navigate: { c: '#0891b2', n: 'NAV' }, assert: { c: '#16a34a', n: 'ASSERT' }, screenshot: { c: '#b45309', n: 'SHOT' },
}
// Soft rgba tint of an FT type color (for the active-event row background / dot ring).
const ftTint = (hex: string, a = 0.1) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const FT_PAD = 4
const ftPos = (time: number, dur: number) => FT_PAD + (time / dur) * (100 - 2 * FT_PAD)
const ftUnpos = (frac: number, dur: number) => Math.max(0, Math.min(dur, ((frac * 100 - FT_PAD) / (100 - 2 * FT_PAD)) * dur))
function flowAt(events: FlowEvent[], t: number) {
  let index = 0; for (let k = 0; k < events.length; k++) if (events[k].t <= t + 1e-6) index = k
  let screen: string | undefined; for (const e of events) if (e.t <= t + 1e-6 && e.screen) screen = e.screen
  let tap: FlowEvent | null = null; for (const e of events) if (e.t <= t + 1e-6 && e.type === 'tap') tap = e
  return { index, screen, tap, event: events[index] }
}
// The keyframe within `eps` seconds of the scrubber time (the closest one), else null.
// When non-null the viewer shows the crisp still instead of the seeked video frame.
function ftKeyframeAt(kfs: FlowKeyframe[], t: number, eps = 0.18): FlowKeyframe | null {
  let best: FlowKeyframe | null = null; let bd = eps
  for (const k of kfs) { const d = Math.abs(k.tMs / 1000 - t); if (d <= bd) { bd = d; best = k } }
  return best
}
// The closest keyframe regardless of distance — used as a never-white fallback still
// when the <video> hasn't painted a frame yet (pre-autoplay / paused / headless).
function ftNearestKeyframe(kfs: FlowKeyframe[], t: number): FlowKeyframe | null {
  let best: FlowKeyframe | null = null; let bd = Infinity
  for (const k of kfs) { const d = Math.abs(k.tMs / 1000 - t); if (d < bd) { bd = d; best = k } }
  return best
}
function useFlowClock(duration: number) {
  const [t, setT] = useState(0); const [playing, setPlaying] = useState(true); const last = useRef<number | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = (ts: number) => { if (last.current == null) last.current = ts; const dt = (ts - last.current) / 1000; last.current = ts; if (playing) setT(p => { const n = p + dt; return n >= duration ? 0 : n }); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf)
  }, [playing, duration])
  return { t, setT, playing, setPlaying }
}
const modeOf = (f: Flow) => f.mode ?? (f.frames || f.video ? 'replay' : 'concept')
function ModeTag({ flow }: { flow: Flow }) {
  const m = modeOf(flow)
  return <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white ${m === 'concept' ? 'bg-violet-500' : 'bg-amber-600'}`}>{m}</span>
}

// A plain framed viewport (no phone bezel). Sizes to width×height — pass a tall box for
// phone screenshots or a wide box for desktop ones. fit defaults to contain for wide
// (desktop) frames and cover-top for tall (phone) frames.
function FlowFrame({ flow, t, width = 240, height = 470, fit }: { flow: Flow; t: number; width?: number; height?: number; fit?: 'cover' | 'contain' }) {
  const { index, screen, tap, event } = flowAt(flow.events, t)
  const rid = useRef(0); const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const prev = useRef(0); const wrapped = index < prev.current
  useEffect(() => { prev.current = index })
  useEffect(() => {
    if (event?.type === 'tap' && t - event.t < 0.35 && typeof event.x === 'number') {
      const id = ++rid.current; setRipples(r => [...r, { id, x: event.x!, y: event.y! }])
      const to = setTimeout(() => setRipples(r => r.filter(x => x.id !== id)), 650); return () => clearTimeout(to)
    }
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  const objectFit = fit ?? (width > height ? 'contain' : 'cover')
  const imgFit = objectFit === 'contain' ? 'bg-slate-50 object-contain' : 'object-cover object-top'
  // video mode: keep the <video> mounted (no reload thrash) and drive its currentTime from the
  // scrubber clock; overlay the crisp keyframe still when the clock is at a keyframe.
  const videoRef = useRef<HTMLVideoElement>(null)
  const kf = flow.video ? ftKeyframeAt(flow.video.keyframes, t) : null
  useEffect(() => {
    const v = videoRef.current
    if (v && flow.video && !kf && Number.isFinite(t)) { try { v.currentTime = t } catch { /* seek before metadata */ } }
  }, [t, kf, flow.video])
  const content = flow.video
    ? (
      <>
        <video ref={videoRef} src={flow.video.src} muted playsInline preload="auto" className={`h-full w-full ${imgFit}`} />
        {kf && flow.frames?.[kf.name] && <img src={flow.frames[kf.name]} alt={kf.name} className={`absolute inset-0 h-full w-full ${imgFit}`} />}
      </>
    )
    : flow.frames
    ? <img src={flow.frames[screen ?? ''] ?? Object.values(flow.frames)[0]} alt={screen ?? ''} className={`h-full w-full ${imgFit}`} />
    : flow.screens?.[screen ?? '']?.({ time: t, index, event, screen })
  return (
    <div className="relative shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm" style={{ width, height, maxWidth: '100%' }}>
      {content}
      {tap && <div className="pointer-events-none absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500 bg-blue-500/25 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]" style={{ left: tap.x, top: tap.y, transition: wrapped ? 'none' : 'left .4s cubic-bezier(.34,1.1,.64,1), top .4s cubic-bezier(.34,1.1,.64,1)' }} />}
      {ripples.map(r => <div key={r.id} className="ft-ripple pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500" style={{ left: r.x, top: r.y }} />)}
    </div>
  )
}

// Media-transport glyphs (filled, currentColor) — crisper than the ▶/❚❚ text glyphs.
const IconPlay = () => <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px] translate-x-px"><path d="M8 5v14l11-7z" /></svg>
const IconPause = () => <svg viewBox="0 0 24 24" fill="currentColor" className="h-[15px] w-[15px]"><path d="M7 5h3.2v14H7zM13.8 5H17v14h-3.2z" /></svg>
const IconPrev = () => <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M6.5 6h2v12h-2zM19 6v12l-9-6z" /></svg>
const IconNext = () => <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><path d="M15.5 6h2v12h-2zM5 6l9 6-9 6z" /></svg>

function FlowRail({ events, t, duration, onSeek, keyframes, activeIndex }: { events: FlowEvent[]; t: number; duration: number; onSeek: (t: number) => void; keyframes?: FlowKeyframe[]; activeIndex?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const seekX = (clientX: number) => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); onSeek(ftUnpos((clientX - r.left) / r.width, duration)) }
  return (
    <div ref={ref} className="relative mb-3 h-10 cursor-ew-resize touch-none select-none rounded-lg border border-slate-200 bg-white"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seekX(e.clientX) }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekX(e.clientX) }}>
      <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-blue-500/[0.06]" style={{ width: ftPos(t, duration) + '%' }} />
      {/* keyframe notches (video mode): amber diamonds the scrubber snaps a crisp still onto */}
      {keyframes?.map((k, i) => <span key={`kf${i}`} title={k.name} className="pointer-events-none absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-amber-500" style={{ left: ftPos(k.tMs / 1000, duration) + '%' }} />)}
      {/* event dots — the ACTIVE one is enlarged with a pulsing ring so the current step reads
         straight off the horizontal timeline (not just the log below). */}
      {events.map((e, i) => {
        const c = FT_TYPES[e.type].c
        const active = i === activeIndex
        return active
          ? <span key={i} className="ft-now-dot pointer-events-none absolute top-1/2 z-[2] h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: ftPos(e.t, duration) + '%', background: c, '--ft-now-ring': ftTint(c, 0.45) } as CSSProperties} />
          : <span key={i} className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: ftPos(e.t, duration) + '%', background: c }} />
      })}
      <div className="pointer-events-none absolute -top-1 -bottom-1 z-[3] w-0.5 bg-slate-900" style={{ left: ftPos(t, duration) + '%' }}><div className="absolute -left-[5px] -top-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-900 shadow" /></div>
    </div>
  )
}

function FlowControls({ t, duration, playing, onToggle, onPrev, onNext, hint = 'drag the rail · click an event' }: { t: number; duration: number; playing: boolean; onToggle: () => void; onPrev?: () => void; onNext?: () => void; hint?: string }) {
  const stepBtn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700'
  return (
    <div className="mb-3 flex items-center gap-2">
      {onPrev && <button onClick={onPrev} className={stepBtn} aria-label="previous event"><IconPrev /></button>}
      <button onClick={onToggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow hover:bg-blue-700" aria-label="play/pause">{playing ? <IconPause /> : <IconPlay />}</button>
      {onNext && <button onClick={onNext} className={stepBtn} aria-label="next event"><IconNext /></button>}
      <span className="ml-1 font-mono text-xs tabular-nums text-slate-600">{t.toFixed(1)}s / {duration.toFixed(1)}s</span>
      <span className="ml-auto text-[11px] text-slate-400">{hint}</span>
    </div>
  )
}

// Seek to the event just before / after the current clock time (for the ⏮ ⏭ controls).
const ftPrevEventT = (events: FlowEvent[], t: number) => { let p = 0; for (const e of events) if (e.t < t - 0.06) p = e.t; return p }
const ftNextEventT = (events: FlowEvent[], t: number, dur: number) => { const n = events.find(e => e.t > t + 0.06); return n ? n.t : dur }

function FlowLog({ events, index, onSeek }: { events: FlowEvent[]; index: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  // scroll ONLY this container — never use scrollIntoView (it scrolls the window too, which
  // made the whole page jump every time the active event changed during playback).
  useEffect(() => {
    const c = ref.current; const el = c?.children[index] as HTMLElement | undefined
    if (!c || !el) return
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect()
    if (er.top < cr.top) c.scrollTop -= cr.top - er.top
    else if (er.bottom > cr.bottom) c.scrollTop += er.bottom - cr.bottom
  }, [index])
  // Rendered as a vertical progress-timeline (stepper): a connecting rail runs down the
  // left, filled up to the current step; each event is past / now / future. The "now" row
  // is strongly highlighted (tinted background, colored left accent, pulsing dot, NOW pill)
  // so it's unmistakable which step the scrubber is on — this replaces the old on-image caption.
  const traveled = '#94a3b8' // slate-400  (rail already passed)
  const ahead = '#e2e8f0' // slate-200  (rail not yet reached)
  return (
    <div ref={ref} className="flex max-h-[300px] flex-col overflow-auto pr-1">
      {events.map((e, i) => {
        const c = FT_TYPES[e.type].c
        const state = i < index ? 'past' : i === index ? 'now' : 'future'
        const last = i === events.length - 1
        return (
          <button
            key={i}
            onClick={() => onSeek(e.t)}
            className={`group relative flex items-center gap-2.5 rounded-md py-1.5 pl-9 pr-2.5 text-left text-[12.5px] transition ${
              state === 'now' ? 'font-semibold text-slate-900' : state === 'past' ? 'text-slate-500 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100'
            }`}
            style={state === 'now' ? { background: ftTint(c, 0.09) } : undefined}
          >
            {/* connector rail: top half toward the previous dot, bottom half toward the next */}
            <span aria-hidden className="pointer-events-none absolute left-4 top-0 h-1/2 w-px" style={{ background: i <= index ? traveled : ahead, opacity: i === 0 ? 0 : 1 }} />
            <span aria-hidden className="pointer-events-none absolute left-4 bottom-0 h-1/2 w-px" style={{ background: i < index ? traveled : ahead, opacity: last ? 0 : 1 }} />
            {/* step dot: past = filled, now = filled with a soft ring, future = hollow */}
            <span aria-hidden className="absolute left-[10px] top-1/2 flex w-3 -translate-y-1/2 justify-center">
              {state === 'now' ? (
                <span className="h-[11px] w-[11px] rounded-full" style={{ background: c, boxShadow: `0 0 0 3px ${ftTint(c, 0.3)}` }} />
              ) : state === 'past' ? (
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
              ) : (
                <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-300 bg-white" />
              )}
            </span>
            <span className="min-w-[52px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-extrabold tracking-wide text-white" style={{ background: c, opacity: state === 'future' ? 0.55 : 1 }}>{FT_TYPES[e.type].n}</span>
            <span className="flex-1">{e.label}</span>
            <span className="shrink-0 font-mono text-[10.5px] text-slate-400">{e.t.toFixed(1)}s</span>
          </button>
        )
      })}
    </div>
  )
}

// Replay viewer: the VIDEO is the clock. We read video.currentTime each frame (never
// write it during playback — driving currentTime per rAF tick thrashes seeking so the
// element never paints, which showed as white between keyframes). Supports multiple
// tracks (platform/size) with a selector, and labels the active environment.
function FlowReplay({ tracks, label, keyframeHoldMs = 500, clusterGapMs = 1200 }: { tracks: FlowTrack[]; label?: ReactNode; keyframeHoldMs?: number; clusterGapMs?: number }) {
  const [idx, setIdx] = useState(0)
  const track = tracks[Math.min(idx, tracks.length - 1)]
  const videoRef = useRef<HTMLVideoElement>(null)
  const offset = (track.offsetMs ?? 0) / 1000 // seconds the video lags the event clock
  const [t, setT] = useState(0) // event-clock time = video.currentTime - offset
  const [dur, setDur] = useState(() => trackDuration(track))
  const [playing, setPlaying] = useState(true)
  const [painted, setPainted] = useState(false) // has the <video> shown a real frame yet?
  const w = track.width ?? 240
  const h = track.height ?? 470

  // States that flash by too fast to read (inputs fired close together) → briefly dwell on
  // each so it's legible. Empty for calm flows, so nothing changes there.
  const holds = useMemo(
    () => (keyframeHoldMs > 0 ? crowdedKeyframes(track.video.keyframes, clusterGapMs) : []),
    [track.video.keyframes, clusterGapMs, keyframeHoldMs],
  )
  const playingRef = useRef(playing); useEffect(() => { playingRef.current = playing }, [playing])
  const honored = useRef<Set<number>>(new Set()) // holds already dwelt on this loop
  const prevRaw = useRef(0) // last raw video.currentTime, to detect crossings + loop wrap

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const raw = v.currentTime
        if (!v.paused) setT(raw - offset)
        // loop wrap → allow the crowded states to dwell again next pass
        if (raw < prevRaw.current - 0.05) honored.current.clear()
        // auto-dwell: when playback crosses a crowded keyframe, pause briefly then resume
        if (!v.paused && playingRef.current && holds.length) {
          for (const hp of holds) {
            const hpRaw = hp + offset
            if (prevRaw.current < hpRaw && raw >= hpRaw && !honored.current.has(hp)) {
              honored.current.add(hp)
              v.pause()
              window.setTimeout(() => { const vv = videoRef.current; if (vv && playingRef.current) vv.play().catch(() => {}) }, keyframeHoldMs)
              break
            }
          }
        }
        prevRaw.current = raw
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [offset, holds, keyframeHoldMs])
  useEffect(() => { setT(0); setPlaying(true); setPainted(false); setDur(trackDuration(track)); honored.current.clear(); prevRaw.current = 0 }, [idx]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMeta = () => { const v = videoRef.current; if (v && Number.isFinite(v.duration) && v.duration > 0) setDur(v.duration - offset) }
  const seek = (nt: number) => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = nt + offset } setT(nt); setPlaying(false); honored.current.clear() }
  const toggle = () => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play().catch(() => {}); setPlaying(true) } else { v.pause(); setPlaying(false) } }

  // Events drive the rail + log + the animated cursor. Use captured events (taps, typing,
  // navigation) if the recording supplied them; otherwise fall back to one marker per keyframe.
  const events = track.events?.length
    ? track.events
    : track.video.keyframes.map(k => ({ t: +(k.tMs / 1000).toFixed(3), type: 'screenshot' as const, label: k.name, screen: k.name }))
  const objectFit = track.fit ?? (w > h ? 'contain' : 'cover')
  const imgFit = objectFit === 'contain' ? 'bg-slate-50 object-contain' : 'object-cover object-top'
  const stacked = w > h

  // Never show white, but never FLASH either: cover the <video> with a keyframe still ONLY
  // while it isn't truly playing painted motion (pre-autoplay / paused). During playback we
  // show the live video continuously — snapping to a still on every keyframe made it jump.
  const showStill = !playing || !painted
  const stillName = (ftKeyframeAt(track.video.keyframes, t) ?? ftNearestKeyframe(track.video.keyframes, t))?.name
  const stillSrc = stillName ? track.frames?.[stillName] : undefined

  // Animated cursor + live caption from the events. x,y are in source pixels → scale to display.
  const { index, tap, event } = flowAt(events, t)
  const sx = w / (track.srcWidth ?? w)
  const sy = h / (track.srcHeight ?? h)
  const rid = useRef(0)
  const [ripples, setRipples] = useState<{ id: number; x: number; y: number }[]>([])
  const prevIdx = useRef(0)
  const wrapped = index < prevIdx.current
  useEffect(() => { prevIdx.current = index })
  useEffect(() => {
    if (event?.type === 'tap' && typeof event.x === 'number') {
      const id = ++rid.current
      setRipples(r => [...r, { id, x: event.x! * sx, y: event.y! * sy }])
      const to = setTimeout(() => setRipples(r => r.filter(x => x.id !== id)), 650)
      return () => clearTimeout(to)
    }
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  const frame = (
    <div className="relative shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm" style={{ width: w, height: h, maxWidth: '100%' }}>
      <video
        key={track.video.src}
        ref={videoRef}
        src={track.video.src}
        muted
        playsInline
        autoPlay
        loop
        preload="auto"
        onLoadedMetadata={onMeta}
        onTimeUpdate={() => { const v = videoRef.current; if (v && v.currentTime > 0.02) setPainted(true) }}
        onPlaying={() => setPainted(true)}
        className={`h-full w-full ${imgFit}`}
        style={{ opacity: showStill ? 0 : 1 }}
      />
      {showStill && stillSrc && <img src={stillSrc} alt={stillName} draggable={false} className={`absolute inset-0 h-full w-full ${imgFit}`} />}
      {/* tap cursor (smoothly animates between taps) + ripple */}
      {tap && typeof tap.x === 'number' && (
        <div
          className="pointer-events-none absolute z-20 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500 bg-blue-500/25 shadow-[0_0_0_4px_rgba(59,130,246,0.12)]"
          style={{ left: tap.x * sx, top: tap.y * sy, transition: wrapped ? 'none' : 'left .4s cubic-bezier(.34,1.1,.64,1), top .4s cubic-bezier(.34,1.1,.64,1)' }}
        />
      )}
      {ripples.map(r => (
        <div key={r.id} className="ft-ripple pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500" style={{ left: r.x, top: r.y }} />
      ))}
    </div>
  )
  const panel = (
    <div className="flex min-w-0 flex-col">
      <FlowControls t={t} duration={dur} playing={playing} onToggle={toggle} onPrev={() => seek(ftPrevEventT(events, t))} onNext={() => seek(ftNextEventT(events, t, dur))} hint="drag the rail · ● event · ◆ keyframe" />
      <FlowRail events={events} t={t} duration={dur} onSeek={seek} keyframes={track.video.keyframes} activeIndex={index} />
      <FlowLog events={events} index={index} onSeek={seek} />
    </div>
  )
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">REPLAY</span>
        <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">{trackEnvLabel(track)}</span>
        {label && <span>{label}</span>}
        {tracks.length > 1 && (
          <span className="ml-auto inline-flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
            {tracks.map((tr, i) => (
              <button key={i} onClick={() => setIdx(i)} className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${i === idx ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                {trackEnvLabel(tr)}
              </button>
            ))}
          </span>
        )}
      </div>
      {stacked
        ? <div className="flex flex-col gap-4"><div className="flex justify-center">{frame}</div>{panel}</div>
        : <div className="grid items-start gap-6" style={{ gridTemplateColumns: `${w}px minmax(0,1fr)` }}>{frame}{panel}</div>}
    </div>
  )
}

export function FlowTimeline(props: {
  duration?: number; events?: FlowEvent[]; screens?: ScreenMap; frames?: FrameMap; video?: FlowVideo
  tracks?: FlowTrack[]; label?: ReactNode; width?: number; height?: number; fit?: 'cover' | 'contain'
  // Replay dwell tuning. keyframeHoldMs=0 disables the auto-dwell; clusterGapMs is how close
  // two captured states must be (ms) to count as "too fast to read".
  keyframeHoldMs?: number; clusterGapMs?: number
}) {
  const { duration, events, screens, frames, video, tracks, label, width = 240, height = 470, fit, keyframeHoldMs, clusterGapMs } = props
  // Replay mode (one or more video tracks) → the video-driven viewer.
  if (tracks?.length || video) {
    const trackList: FlowTrack[] = tracks?.length
      ? tracks
      : [{ platform: '', video: video!, frames, events, duration, width, height, fit }]
    return <FlowReplay tracks={trackList} label={label} keyframeHoldMs={keyframeHoldMs} clusterGapMs={clusterGapMs} />
  }
  // Concept / static-frames mode → the rAF clock + FlowFrame.
  const dur = duration ?? 0
  const evs = events ?? []
  return <FlowConcept duration={dur} events={evs} screens={screens} frames={frames} label={label} width={width} height={height} fit={fit} />
}

function FlowConcept({ duration, events, screens, frames, label, width = 240, height = 470, fit }: {
  duration: number; events: FlowEvent[]; screens?: ScreenMap; frames?: FrameMap; label?: ReactNode; width?: number; height?: number; fit?: 'cover' | 'contain'
}) {
  const { t, setT, playing, setPlaying } = useFlowClock(duration)
  const flow: Flow = { events, screens, frames }
  const seek = (nt: number) => { setT(nt); setPlaying(false) }
  const stacked = width > height
  const frame = <FlowFrame flow={flow} t={t} width={width} height={height} fit={fit} />
  const panel = (
    <div className="flex min-w-0 flex-col">
      <FlowControls t={t} duration={duration} playing={playing} onToggle={() => setPlaying(p => !p)} onPrev={() => seek(ftPrevEventT(events, t))} onNext={() => seek(ftNextEventT(events, t, duration))} />
      <FlowRail events={events} t={t} duration={duration} onSeek={seek} activeIndex={flowAt(events, t).index} />
      <FlowLog events={events} index={flowAt(events, t).index} onSeek={seek} />
    </div>
  )
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="mb-4 flex items-center gap-2 text-xs text-slate-600"><ModeTag flow={flow} /><span>{label ?? (modeOf(flow) === 'concept' ? 'live React · before implementation' : 'real e2e screenshots · after implementation')}</span></div>
      {stacked
        ? <div className="flex flex-col gap-4"><div className="flex justify-center">{frame}</div>{panel}</div>
        : <div className="grid items-start gap-6" style={{ gridTemplateColumns: `${width}px minmax(0,1fr)` }}>{frame}{panel}</div>}
    </div>
  )
}

export function FlowCompare({ duration, flows, width = 224, height = 430, fit, hint }: { duration: number; flows: [Flow, Flow]; width?: number; height?: number; fit?: 'cover' | 'contain'; hint?: string }) {
  const { t, setT, playing, setPlaying } = useFlowClock(duration)
  const seek = (nt: number) => { setT(nt); setPlaying(false) }
  const wide = width > height // desktop frames → stack the two; phone frames → side by side
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <FlowControls t={t} duration={duration} playing={playing} onToggle={() => setPlaying(p => !p)} onPrev={() => seek(ftPrevEventT(flows[0].events, t))} onNext={() => seek(ftNextEventT(flows[0].events, t, duration))} hint={hint ?? 'one scrubber drives both flows'} />
      <FlowRail events={flows[0].events} t={t} duration={duration} onSeek={seek} activeIndex={flowAt(flows[0].events, t).index} />
      <div className={`mt-4 grid gap-6 ${wide ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
        {flows.map((f, i) => (
          <div key={i} className="flex flex-col items-center gap-3">
            <div className="flex w-full items-center gap-2 text-xs text-slate-600"><ModeTag flow={f} /><span>{f.label}</span></div>
            <FlowFrame flow={f} t={t} width={width} height={height} fit={fit} />
          </div>
        ))}
      </div>
    </div>
  )
}

/* ==== FlowAlign — aligned dual-flow replay (time-warped) ====================
   Two recordings of the SAME journey that run at different speeds and/or have
   extra steps on one side (the motivating case: web vs mobile onboarding). You
   give it a MERGED stage list — each stage owns a screen on track 0, track 1, or
   both — and two video tracks. It offers:
     • Combined  — one control line (play · prev/next · rail · clickable step list)
       over BOTH clients. The two videos play *time-warped*: each segment between
       shared steps is stretched to the slower side's real duration, so the slow
       client runs ≈ real-time and the fast one is slowed, and both cross every
       step together. A step only one side has shows a "no screen here" view on
       the other while it keeps playing. Two live timers show real elapsed time.
     • Individual — the two <FlowTimeline> players, each on its own clock.
   Colours: shared steps use `sharedColor`; a step unique to a track uses that
   track's `accent`. Frames are full URLs (caller owns the asset paths). --------- */
export type AlignScreen = { tMs: number; frame?: string } | null
export type AlignStage = { label: string; screens: [AlignScreen, AlignScreen] }
export type AlignTrack = { label: ReactNode; short?: string; accent?: string; video: string; duration: number; width?: number; height?: number; fit?: 'cover' | 'contain' }
type FaView = { kind: 'still' | 'video' | 'none'; frame?: string; tMs: number; present: boolean }

const faFmt = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
const faKind = (s: AlignStage): 0 | 1 | 2 => (s.screens[0] && s.screens[1] ? 2 : s.screens[0] ? 0 : 1)

function FaControls({ curIdx, count, playing, onToggle, onPrev, onNext }: { curIdx: number; count: number; playing: boolean; onToggle: () => void; onPrev: () => void; onNext: () => void }) {
  const stepBtn = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50 hover:text-slate-700'
  return (
    <div className="mb-3 flex items-center gap-2">
      <button onClick={onPrev} className={stepBtn} aria-label="previous step"><IconPrev /></button>
      <button onClick={onToggle} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow hover:bg-blue-700" aria-label="play/pause">{playing ? <IconPause /> : <IconPlay />}</button>
      <button onClick={onNext} className={stepBtn} aria-label="next step"><IconNext /></button>
      <span className="ml-1 font-mono text-xs tabular-nums text-slate-600">step {curIdx + 1} / {count}</span>
      <span className="ml-auto text-[11px] text-slate-400">play · step · or click a row →</span>
    </div>
  )
}

function FaRail({ t, dur, marks, colors, onSeek }: { t: number; dur: number; marks: number[]; colors: string[]; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const seekX = (clientX: number) => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); onSeek(ftUnpos((clientX - r.left) / r.width, dur)) }
  let active = 0, ad = Infinity
  marks.forEach((m, i) => { const d = Math.abs(m - t); if (d < ad) { ad = d; active = i } })
  return (
    <div ref={ref} className="relative mb-4 h-10 cursor-ew-resize touch-none select-none rounded-lg border border-slate-200 bg-white"
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); seekX(e.clientX) }}
      onPointerMove={e => { if (e.currentTarget.hasPointerCapture(e.pointerId)) seekX(e.clientX) }}>
      <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-lg bg-blue-500/[0.06]" style={{ width: ftPos(t, dur) + '%' }} />
      {marks.map((m, i) => i === active
        ? <span key={i} className="ft-now-dot pointer-events-none absolute top-1/2 z-[2] h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: ftPos(m, dur) + '%', background: colors[i], '--ft-now-ring': ftTint(colors[i], 0.45) } as CSSProperties} />
        : <span key={i} className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ left: ftPos(m, dur) + '%', background: colors[i] }} />)}
      <div className="pointer-events-none absolute -top-1 -bottom-1 z-[3] w-0.5 bg-slate-900" style={{ left: ftPos(t, dur) + '%' }}><div className="absolute -left-[5px] -top-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-900 shadow" /></div>
    </div>
  )
}

function FaLog({ stages, colors, tracks, accents, curIdx, onSeek }: { stages: AlignStage[]; colors: string[]; tracks: [AlignTrack, AlignTrack]; accents: [string, string]; curIdx: number; onSeek: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const c = ref.current; const el = c?.children[curIdx] as HTMLElement | undefined
    if (!c || !el) return
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect()
    if (er.top < cr.top) c.scrollTop -= cr.top - er.top
    else if (er.bottom > cr.bottom) c.scrollTop += er.bottom - cr.bottom
  }, [curIdx])
  const traveled = '#94a3b8', ahead = '#e2e8f0'
  return (
    <div ref={ref} className="flex max-h-[440px] flex-col overflow-auto pr-1">
      {stages.map((s, i) => {
        const c = colors[i]; const k = faKind(s)
        const state = i < curIdx ? 'past' : i === curIdx ? 'now' : 'future'
        const last = i === stages.length - 1
        const pill = k === 2 ? 'BOTH' : (tracks[k].short ?? String(tracks[k].label)).toUpperCase()
        const t0 = s.screens[0], t1 = s.screens[1]
        return (
          <button key={i} onClick={() => onSeek(i)} className={`group relative flex items-center gap-2.5 rounded-md py-1.5 pl-9 pr-2.5 text-left text-[12.5px] transition ${state === 'now' ? 'font-semibold text-slate-900' : state === 'past' ? 'text-slate-500 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-100'}`} style={state === 'now' ? { background: ftTint(c, 0.09) } : undefined}>
            <span aria-hidden className="pointer-events-none absolute left-4 top-0 h-1/2 w-px" style={{ background: i <= curIdx ? traveled : ahead, opacity: i === 0 ? 0 : 1 }} />
            <span aria-hidden className="pointer-events-none absolute left-4 bottom-0 h-1/2 w-px" style={{ background: i < curIdx ? traveled : ahead, opacity: last ? 0 : 1 }} />
            <span aria-hidden className="absolute left-[10px] top-1/2 flex w-3 -translate-y-1/2 justify-center">
              {state === 'now' ? <span className="h-[11px] w-[11px] rounded-full" style={{ background: c, boxShadow: `0 0 0 3px ${ftTint(c, 0.3)}` }} />
                : state === 'past' ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                : <span className="h-2.5 w-2.5 rounded-full border-2 border-slate-300 bg-white" />}
            </span>
            <span className="min-w-[58px] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-extrabold tracking-wide text-white" style={{ background: c, opacity: state === 'future' ? 0.55 : 1 }}>{pill}</span>
            <span className="flex-1">{s.label}</span>
            <span className="shrink-0 font-mono text-[10.5px] tabular-nums">
              <span style={{ color: t0 ? accents[0] : '#cbd5e1' }}>{t0 ? faFmt(t0.tMs) : '—:—'}</span>
              <span className="text-slate-300"> · </span>
              <span style={{ color: t1 ? accents[1] : '#cbd5e1' }}>{t1 ? faFmt(t1.tMs) : '—:—'}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function FaPanel({ track, accent, view, vref, height }: { track: AlignTrack; accent: string; view: FaView; vref: RefObject<HTMLVideoElement>; height: number }) {
  const w = track.width ?? 320
  const fit = track.fit === 'cover' ? 'object-cover' : 'object-contain'
  // Stay "in the video": a <video> holds its current (seeked) frame even while
  // paused, so once it has painted a real frame we keep showing it — pausing or
  // scrubbing lands on the actual video frame, not the crisp keyframe screenshot.
  // The still underneath is only the pre-paint base (never-played / headless);
  // `onSeeked` covers scrubbing while paused, which paints without ever playing.
  const [painted, setPainted] = useState(false)
  const paint = () => setPainted(true)
  const showVideo = view.kind !== 'none' && painted
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-baseline gap-2.5">
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: accent }}>{track.label}</span>
        <span className="font-mono text-[22px] font-bold tabular-nums" style={{ color: view.present ? '#0f172a' : '#cbd5e1' }}>{faFmt(view.tMs)}</span>
        {!view.present && <span className="text-[10px] text-slate-400">held</span>}
      </div>
      <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-900 shadow-sm" style={{ width: w, height }}>
        {/* crisp still base — shown only until the <video> first paints a real frame */}
        {view.kind !== 'none' && view.frame && <img src={view.frame} alt="" className={`absolute inset-0 h-full w-full ${fit}`} style={{ opacity: showVideo ? 0 : 1 }} />}
        {/* live video on top, revealed once it's painted (and kept revealed when paused) */}
        <video ref={vref} src={track.video} muted playsInline preload="auto" onPlaying={paint} onTimeUpdate={paint} onSeeked={paint} onLoadedData={paint} className={`absolute inset-0 h-full w-full ${fit}`} style={{ opacity: showVideo ? 1 : 0 }} />
        {view.kind === 'none' && (<>
          {view.frame && <img src={view.frame} alt="" className={`absolute inset-0 h-full w-full ${fit} opacity-20 grayscale`} />}
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900/40 p-4 text-center text-[13px] font-semibold text-slate-200">no screen here</div>
        </>)}
      </div>
    </div>
  )
}

function FaIndividual({ tracks, stages }: { tracks: [AlignTrack, AlignTrack]; stages: AlignStage[] }) {
  const flowFor = (idx: 0 | 1) => {
    const rows = stages.filter(s => s.screens[idx])
    return {
      keyframes: rows.map(s => ({ name: s.label, tMs: s.screens[idx]!.tMs })),
      frames: Object.fromEntries(rows.filter(s => s.screens[idx]!.frame).map(s => [s.label, s.screens[idx]!.frame!])) as FrameMap,
      events: rows.map(s => ({ t: s.screens[idx]!.tMs / 1000, type: 'screenshot' as const, label: s.label, screen: s.label })) as FlowEvent[],
    }
  }
  return (
    <div className="flex flex-wrap justify-center gap-10">
      {([0, 1] as const).map(idx => {
        const tr = tracks[idx]; const f = flowFor(idx)
        return (
          <div key={idx}>
            <div className="mb-2 text-center text-[13px] font-bold" style={{ color: tr.accent ?? '#334155' }}>{tr.label}</div>
            <FlowTimeline label={<>{tr.label} — click a screen on the rail</>} video={{ src: tr.video, keyframes: f.keyframes }} frames={f.frames} events={f.events} duration={tr.duration} width={tr.width ?? 300} height={tr.height ?? 600} fit={tr.fit ?? 'contain'} />
          </div>
        )
      })}
    </div>
  )
}

export function FlowAlign({ tracks, stages, pace = 0.6, sharedColor = '#6366f1', gapSeconds = 0.9, height = 410, defaultMode = 'combined' }: {
  tracks: [AlignTrack, AlignTrack]; stages: AlignStage[]
  pace?: number; sharedColor?: string; gapSeconds?: number; height?: number; defaultMode?: 'combined' | 'individual'
}) {
  const accents: [string, string] = [tracks[0].accent ?? '#2563eb', tracks[1].accent ?? '#7c3aed']
  const colorFor = (s: AlignStage) => { const k = faKind(s); return k === 2 ? sharedColor : accents[k] }

  // Geometry — depends only on the stage times: each segment's SHARED duration is
  // the slowest real sub-range that plays in it (× pace); STAGE_S are the cumulative
  // shared times, so both sides reach each stage at the same instant.
  const geo = useMemo(() => {
    const a0 = stages.map(s => s.screens[0]); const a1 = stages.map(s => s.screens[1])
    const seg: number[] = []
    for (let i = 0; i < stages.length - 1; i++) {
      const spans: number[] = []
      if (a0[i] && a0[i + 1]) spans.push((a0[i + 1]!.tMs - a0[i]!.tMs) / 1000)
      if (a1[i] && a1[i + 1]) spans.push((a1[i + 1]!.tMs - a1[i]!.tMs) / 1000)
      seg.push(spans.length ? Math.max(...spans) * pace : gapSeconds)
    }
    const S = [0]; for (let i = 0; i < seg.length; i++) S.push(S[i] + seg[i])
    return { a: [a0, a1] as [AlignScreen[], AlignScreen[]], seg, S, total: S[S.length - 1] }
  }, [stages, pace, gapSeconds])
  const { a, seg, S, total } = geo

  const [mode, setMode] = useState<'combined' | 'individual'>(defaultMode)
  const v0Ref = useRef<HTMLVideoElement>(null)
  const v1Ref = useRef<HTMLVideoElement>(null)
  const tauRef = useRef(0)
  const [tau, setTauState] = useState(0)
  const setTau = (v: number) => { tauRef.current = v; setTauState(v) }
  const [playing, setPlaying] = useState(false)
  const curSeg = useRef(-1)

  const segAt = (t: number) => { for (let i = 0; i < stages.length - 1; i++) if (t < S[i + 1]) return i; return stages.length - 2 }
  const nearestStage = (t: number) => { let b = 0, bd = Infinity; for (let i = 0; i < S.length; i++) { const d = Math.abs(S[i] - t); if (d < bd) { bd = d; b = i } } return b }
  const EPS = 0.05
  const viewOf = (t: number, arr: AlignScreen[]): FaView => {
    const i = segAt(t), s0 = S[i], s1 = S[i + 1], frac = s1 > s0 ? (t - s0) / (s1 - s0) : 0
    const onK = Math.abs(t - s0) < EPS ? i : Math.abs(t - s1) < EPS ? i + 1 : -1
    if (onK >= 0 && arr[onK]) return { kind: 'still', frame: arr[onK]!.frame, tMs: arr[onK]!.tMs, present: true }
    if (arr[i] && arr[i + 1]) return { kind: 'video', frame: frac < 0.5 ? arr[i]!.frame : arr[i + 1]!.frame, tMs: arr[i]!.tMs + (arr[i + 1]!.tMs - arr[i]!.tMs) * frac, present: true }
    let held: AlignScreen = null
    for (let j = i; j >= 0; j--) if (arr[j]) { held = arr[j]; break }
    if (!held) for (let j = i + 1; j < arr.length; j++) if (arr[j]) { held = arr[j]; break }
    return { kind: 'none', frame: held?.frame, tMs: held ? held.tMs : 0, present: false }
  }

  const applySegment = (t: number, play: boolean) => {
    const i = segAt(t), s0 = S[i], s1 = S[i + 1], frac = s1 > s0 ? (t - s0) / (s1 - s0) : 0
    const place = (v: HTMLVideoElement | null, arr: AlignScreen[]) => {
      if (!v) return
      if (arr[i] && arr[i + 1]) {
        const t0 = arr[i]!.tMs / 1000, t1 = arr[i + 1]!.tMs / 1000
        try { v.currentTime = t0 + (t1 - t0) * frac } catch { /* seek before metadata */ }
        v.playbackRate = Math.max(0.0625, Math.min(16, (t1 - t0) / seg[i]))
        if (play) v.play().catch(() => {}); else v.pause()
      } else v.pause()
    }
    place(v0Ref.current, a[0]); place(v1Ref.current, a[1])
  }

  const seek = (v: number) => { const nx = Math.max(0, Math.min(total, v)); setPlaying(false); curSeg.current = -1; applySegment(nx, false); setTau(nx) }

  useEffect(() => {
    if (mode !== 'combined' || !playing) { v0Ref.current?.pause(); v1Ref.current?.pause(); return }
    applySegment(tauRef.current, true); curSeg.current = segAt(tauRef.current)
    let raf = 0, last = 0
    const tick = (ts: number) => {
      if (!last) last = ts
      const dt = (ts - last) / 1000; last = ts
      let nx = tauRef.current + dt
      if (nx >= total) nx = total
      const sg = segAt(nx)
      if (sg !== curSeg.current) { curSeg.current = sg; applySegment(nx, true) }
      setTau(nx)
      if (nx >= total) { setPlaying(false); return }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, mode, total])

  const toggle = () => { if (!playing) { if (tauRef.current >= total) setTau(0); setPlaying(true) } else setPlaying(false) }
  const switchMode = (m: 'combined' | 'individual') => { setPlaying(false); setMode(m) }

  const cur = nearestStage(tau)
  const stage = stages[cur]
  const kColor = colorFor(stage)
  const kindLabel = (() => { const k = faKind(stage); return k === 2 ? 'both' : `${tracks[k].short ?? String(tracks[k].label)} only` })()
  const colors = stages.map(colorFor)

  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
          {(['combined', 'individual'] as const).map(m => (
            <button key={m} onClick={() => switchMode(m)} className={`rounded-md px-3.5 py-1.5 text-[13px] font-semibold capitalize transition ${mode === m ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}>{m}</button>
          ))}
        </div>
        <span className="text-xs text-slate-500">{mode === 'combined' ? 'one control line drives both — videos play time-warped so they stay step-aligned' : 'the two players, each on its own clock'}</span>
      </div>

      {mode === 'individual' ? <FaIndividual tracks={tracks} stages={stages} /> : (
        <>
          <FaControls curIdx={cur} count={stages.length} playing={playing} onToggle={toggle} onPrev={() => seek(S[Math.max(0, cur - 1)])} onNext={() => seek(S[Math.min(stages.length - 1, cur + 1)])} />
          <FaRail t={tau} dur={total} marks={S} colors={colors} onSeek={seek} />
          <div className="mt-4 flex flex-wrap gap-7">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-2.5">
                <span className="text-[15px] font-bold text-slate-900">{stage.label}</span>
                <span className="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: kColor }}>{kindLabel}</span>
              </div>
              <div className="flex flex-wrap items-start justify-center gap-6">
                <FaPanel track={tracks[0]} accent={accents[0]} view={viewOf(tau, a[0])} vref={v0Ref} height={height} />
                <FaPanel track={tracks[1]} accent={accents[1]} view={viewOf(tau, a[1])} vref={v1Ref} height={height} />
              </div>
            </div>
            <div className="min-w-[260px] flex-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Steps — click to jump</span>
                <span className="font-mono text-[10px]"><span style={{ color: accents[0] }}>{tracks[0].short ?? tracks[0].label}</span> · <span style={{ color: accents[1] }}>{tracks[1].short ?? tracks[1].label}</span></span>
              </div>
              <FaLog stages={stages} colors={colors} tracks={tracks} accents={accents} curIdx={cur} onSeek={i => seek(S[i])} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ---- tasks ------------------------------------------------------------ */
export type TaskItem = { text: ReactNode; done?: boolean }
export function Tasks({ phase, title, items }: { phase?: string; title?: ReactNode; items: TaskItem[] }) {
  const { approved, register } = useContext(PageCtx)
  const id = useId()
  const done = items.filter(i => i.done).length
  useEffect(() => register(id, done, items.length), [id, done, items.length, register])
  return (
    <>
      {(phase || title) && (
        <h3 className="mb-2.5 mt-7 text-[17px] font-semibold">
          {phase && <span data-toc-ignore className="mr-2.5 inline-block rounded bg-blue-600/8 px-2.5 py-[3px] align-middle text-[11px] font-semibold uppercase tracking-wide text-blue-600">{phase}</span>}
          {title}
        </h3>
      )}
      <ul className={approved ? 'mb-4 space-y-1' : 'mb-4 list-disc space-y-1 pl-6 marker:text-slate-400'}>
        {items.map((it, i) => approved ? (
          <li key={i} className="relative flex gap-2.5 py-0.5 text-sm">
            <span className={`mt-1 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded border ${it.done ? 'border-blue-600 bg-blue-600' : 'border-slate-300 bg-white'}`}>
              {it.done && <svg viewBox="0 0 12 9" className="h-2 w-2.5"><path d="M1 4.5 L4.5 8 L11 1" fill="none" stroke="#fff" strokeWidth="2" /></svg>}
            </span>
            <span className={it.done ? 'text-slate-400 line-through [&_code]:no-underline' : '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700'}>{it.text}</span>
          </li>
        ) : (
          <li key={i} className="text-sm leading-relaxed [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-px [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-slate-700 [&_strong]:font-semibold">{it.text}</li>
        ))}
      </ul>
    </>
  )
}

/* ---- interactive state (file-backed via /api/state/<slug>) ------------- */
// Loads JSON from the dev-server state endpoint on mount, and debounce-persists back on every
// user-driven update. Returns [state, update, status]. `update` takes a value or updater fn.
export function usePageState<T>(slug: string, initial: T): [T, (u: T | ((prev: T) => T)) => void, { loaded: boolean; saving: boolean }] {
  const [state, setState] = useState<T>(initial)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = useRef(false)
  useEffect(() => {
    // static snapshot: hydrate from the state baked at export time; nothing persists
    if (IS_STATIC) {
      const baked = window.__PAGE_STATE__
      if (baked && typeof baked === 'object') setState(prev => ({ ...prev, ...(baked as Partial<T>) }))
      setLoaded(true)
      return
    }
    let live = true
    fetch(`/api/state/${slug}`)
      .then(r => r.json())
      .then(d => { if (live && d && typeof d === 'object') setState(prev => ({ ...prev, ...d })) })
      .catch(() => {})
      .finally(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [slug])
  useEffect(() => {
    if (IS_STATIC || !dirty.current) return
    setSaving(true)
    const t = setTimeout(() => {
      fetch(`/api/state/${slug}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state) })
        .catch(() => {})
        .finally(() => setSaving(false))
    }, 250)
    return () => clearTimeout(t)
  }, [state, slug])
  // In a static snapshot there is no /api/state to persist to, so editing is a lie — clicks
  // would update the in-tab React state and then vanish on reload. Make update a hard no-op so
  // interactive primitives (e.g. ReviewStream) render genuinely read-only in shared exports.
  const update = (u: T | ((prev: T) => T)) => { if (IS_STATIC) return; dirty.current = true; setState(u as any) }
  return [state, update, { loaded, saving }]
}

/* ---- review stream (chat-style decision board) ------------------------ */
export type ReviewAttachment = { name: string; kind?: 'image' | 'video' }
export type ReviewMsg = {
  id: string
  author?: string
  time?: string
  text?: ReactNode
  links?: { label: string; href: string }[]
  attachments?: ReviewAttachment[]
  replies?: { author: string; time?: string; text: ReactNode }[]
  type?: string
  pri?: string
  rec?: Decision
  recNote?: ReactNode
  flag?: 'needs-image' | 'in-flight' | null
}
type Decision = 'go' | 'defer' | 'nogo'
// Tasks the reviewer adds live in the board itself (not the authored page source), so they must
// be persisted in the state file — the triage skill reads them back from `added` alongside the
// decisions/notes it already consumes.
type AddedItem = { id: string; text: string; author?: string; time?: string }
type DecisionState = { decisions: Record<string, Decision>; notes: Record<string, string>; round: 'go' | 'hold' | null; added?: AddedItem[] }

const DECISIONS: { key: Decision; label: string; on: string; off: string }[] = [
  { key: 'go', label: 'Go', on: 'bg-green-600 text-white border-green-600', off: 'text-green-700 border-green-300 hover:bg-green-50' },
  { key: 'defer', label: 'Defer', on: 'bg-amber-500 text-white border-amber-500', off: 'text-amber-700 border-amber-300 hover:bg-amber-50' },
  { key: 'nogo', label: 'No-go', on: 'bg-red-600 text-white border-red-600', off: 'text-red-600 border-red-300 hover:bg-red-50' },
]
const recTone: Record<Decision, string> = { go: 'text-green-700', defer: 'text-amber-700', nogo: 'text-red-600' }
const flagPill: Record<string, { tone: 'good' | 'warn' | 'neutral'; label: string }> = {
  'needs-image': { tone: 'neutral', label: 'needs screenshot' },
  'in-flight': { tone: 'good', label: 'in-flight — verify' },
}

function Attachment({ slug, att }: { slug: string; att: ReviewAttachment }) {
  const src = `/api/asset/${slug}/${encodeURIComponent(att.name)}`
  const kind = att.kind ?? (/\.(mp4|mov|webm|m4v)$/i.test(att.name) ? 'video' : 'image')
  // Probe existence with fetch (a 404 here isn't logged as a console error, unlike a failed
  // <img>/<video> load) so missing attachments render a clean placeholder, not a broken tile.
  // Static exports have no probe endpoint (and assets were copied in at export time), so
  // assume present and fall back to the placeholder via onError.
  const [present, setPresent] = useState<boolean | null>(IS_STATIC ? true : null)
  useEffect(() => {
    if (IS_STATIC) return
    let live = true
    fetch(src, { method: 'HEAD' }).then(r => { if (live) setPresent(r.headers.get('x-asset-present') === '1') }).catch(() => { if (live) setPresent(false) })
    return () => { live = false }
  }, [src])
  if (present === null) return <div className="mt-2 h-9 w-40 animate-pulse rounded-lg bg-slate-100" />
  if (!present) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
        <span className="text-base">{kind === 'video' ? '🎬' : '📷'}</span>
        <span className="font-mono text-slate-600">{att.name}</span>
        <span className="text-slate-400">— drop into <code className="rounded bg-slate-200 px-1">{slug}-assets/</code></span>
      </div>
    )
  }
  if (kind === 'video') return <video src={src} controls className="mt-2 max-h-80 w-auto rounded-lg border border-slate-200" onError={() => setPresent(false)} />
  return <img src={src} alt={att.name} className="mt-2 max-h-80 w-auto rounded-lg border border-slate-200" onError={() => setPresent(false)} />
}

/* ---- keyboard-active stream registry ---------------------------------
   A page can hold several <ReviewStream>s (one per source group). Only ONE
   should respond to the global hotkeys at a time, else j/k would move focus in
   every board at once. The first mounted stream claims focus; clicking into any
   other stream hands it over. Tiny pub-sub so each stream re-renders its own
   isActive without a context. */
const streamSubs = new Set<(id: string | null) => void>()
let activeStreamId: string | null = null
function claimStream(id: string) {
  if (activeStreamId === id) return
  activeStreamId = id
  streamSubs.forEach(fn => fn(id))
}

/* ---- board-summary registry (ux16 / ux17) ----------------------------
   Each <ReviewStream> publishes its progress + a lite item list here so the
   fixed-left "On this page" SideNav can render per-board progress and a
   one-click jump list — the cross-group progress the P3 idea asked for, and the
   "effectively focus mode" jump list (no separate mode needed). */
type BoardItemLite = { id: string; label: string; decision?: Decision; focused?: boolean }
type BoardSummary = { uid: string; slug: string; decided: number; total: number; items: BoardItemLite[]; focusedId: string | null; jump: (id: string) => void }
const boardReg = new Map<string, BoardSummary>()
const boardSubs = new Set<() => void>()
function publishBoard(b: BoardSummary) { boardReg.set(b.uid, b); boardSubs.forEach(f => f()) }
function retireBoard(uid: string) { if (boardReg.delete(uid)) boardSubs.forEach(f => f()) }
function useBoards(): BoardSummary[] {
  const [, bump] = useState(0)
  useEffect(() => { const f = () => bump(n => n + 1); boardSubs.add(f); return () => { boardSubs.delete(f) } }, [])
  return Array.from(boardReg.values())
}
const decColor: Record<Decision, string> = { go: 'bg-green-500', defer: 'bg-amber-500', nogo: 'bg-red-500' }
const dotFor = (d?: Decision) => (d ? decColor[d] : 'border border-slate-300 bg-white')
// A plain-text label for the nav list / command palette (ReviewMsg.text is a ReactNode).
function liteLabel(m: ReviewMsg): string {
  if (typeof m.text === 'string' && m.text.trim()) return m.text.trim().replace(/\s+/g, ' ').slice(0, 60)
  return m.id
}
// A tiny keycap, for annotating buttons with their hotkey (ux19 note).
function Kbd({ children, on = false }: { children: ReactNode; on?: boolean }) {
  return <kbd className={`ml-1 rounded border px-1 font-mono text-[9px] font-bold leading-[1.4] ${on ? 'border-white/40 text-white/80' : 'border-slate-300 bg-slate-50 text-slate-400'}`}>{children}</kbd>
}

/* ux1 — auto-growing note. A <textarea> that starts at one row (empty), grows
   with content, and holds a ~2-row minimum once focused so a long instruction
   note has room. Cmd/Ctrl+Enter blurs (commit + hand keyboard back to the board).
   inputRef hands the DOM node up so the `e` hotkey can focus it. */
function AutoNote({ value, placeholder, onChange, onFocus, inputRef, dot }: {
  value: string; placeholder?: string; onChange: (v: string) => void
  onFocus?: () => void; inputRef?: (el: HTMLTextAreaElement | null) => void; dot?: ReactNode
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [focused, setFocused] = useState(false)
  const resize = () => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(el.scrollHeight, focused ? 52 : 0) + 'px'
  }
  useEffect(resize, [value, focused]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="relative mt-2">
      <textarea
        ref={el => { ref.current = el; inputRef?.(el) }}
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onInput={resize}
        onFocus={() => { setFocused(true); onFocus?.() }}
        onBlur={() => setFocused(false)}
        onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() } }}
        className="block w-full resize-none overflow-hidden rounded-md border border-slate-200 bg-white py-1.5 pl-2.5 pr-6 text-sm leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
      />
      {dot && <span className="absolute right-2 top-2">{dot}</span>}
    </div>
  )
}

/* Add-a-task affordance at the foot of the stream. Collapsed to a dashed "＋ Add a task"
   button; expands to a textarea. ⌘/Ctrl+↵ (or the button) appends the task and keeps the box
   open + focused for rapid entry; Esc closes it when empty. */
function AddTaskRow({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => { if (open) ref.current?.focus() }, [open])
  const submit = () => { const t = text.trim(); if (!t) return; onAdd(t); setText(''); ref.current?.focus() }
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-sm font-medium text-slate-500 transition hover:border-slate-400 hover:bg-slate-50 hover:text-slate-700"
      >
        <span className="text-base leading-none">＋</span> Add a task
      </button>
    )
  }
  return (
    <div className="rounded-xl border border-slate-300 bg-white p-3 shadow-sm">
      <textarea
        ref={ref}
        rows={2}
        value={text}
        placeholder="Describe the task…  (⌘/Ctrl+Enter to add · Esc to close)"
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() }
          else if (e.key === 'Escape') { e.stopPropagation(); if (!text.trim()) { setText(''); setOpen(false) } }
        }}
        className="block w-full resize-none rounded-md border border-slate-200 bg-white p-2.5 text-sm leading-relaxed text-slate-700 placeholder:text-slate-300 focus:border-blue-400 focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <button onClick={() => { setText(''); setOpen(false) }} className="rounded-md px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">Cancel</button>
        <button
          onClick={submit}
          disabled={!text.trim()}
          className="rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
        >
          Add task
        </button>
      </div>
    </div>
  )
}

export function ReviewStream({ slug, messages: authored }: { slug: string; messages: ReviewMsg[] }) {
  const seed: DecisionState = { decisions: {}, notes: {}, round: null, added: [] }
  const [state, update, status] = usePageState<DecisionState>(slug, seed)
  const decisions = state.decisions || {}
  const notes = state.notes || {}
  const added = state.added || []

  // The effective item list = authored items + reviewer-added tasks. Everything downstream
  // (tally, filter, nav, decisions, notes) operates on this merged list, so an added task
  // behaves exactly like an authored one. `addedIds` marks which cards can be removed.
  const addedIds = useMemo(() => new Set(added.map(a => a.id)), [added])
  const messages = useMemo<ReviewMsg[]>(
    () => [...authored, ...added.map(a => ({ id: a.id, text: a.text, author: a.author ?? 'You', time: a.time }))],
    [authored, added],
  )

  // local (never-persisted) UI state — ux2/ux3/ux4/ux5
  const uid = useId()
  const [isActive, setIsActive] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'undecided' | Decision>('all')
  const [showHelp, setShowHelp] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [lastEditedId, setLastEditedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ id: string; prev?: Decision; d: Decision; label: string } | null>(null)
  const undoStack = useRef<{ id: string; prev?: Decision }[]>([])
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const noteRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})
  const headerRef = useRef<HTMLDivElement | null>(null) // sticky summary bar — measured so jumps clear it

  // Register in the keyboard-active pub-sub. First stream on the page claims focus.
  useEffect(() => {
    const cb = (id: string | null) => setIsActive(id === uid)
    streamSubs.add(cb)
    if (activeStreamId == null) claimStream(uid)
    else setIsActive(activeStreamId === uid)
    return () => { streamSubs.delete(cb) }
  }, [uid])
  useEffect(() => () => retireBoard(uid), [uid]) // drop this board from the SideNav on unmount

  const setDecisionRaw = (id: string, d: Decision | undefined) =>
    update(s => {
      const next = { ...s.decisions }
      if (d == null) delete next[id]
      else next[id] = d
      return { ...s, decisions: next }
    })
  const setDecision = (id: string, d: Decision) => setDecisionRaw(id, decisions[id] === d ? undefined : d) // toggle
  const setDecisionValue = (id: string, d: Decision) => setDecisionRaw(id, d)
  const setNote = (id: string, v: string) => { setLastEditedId(id); update(s => ({ ...s, notes: { ...s.notes, [id]: v } })) }
  const acceptAllRecs = () =>
    update(s => {
      const next = { ...s.decisions }
      for (const m of messages) if (m.rec && next[m.id] == null) next[m.id] = m.rec
      return { ...s, decisions: next }
    })
  const setRound = (r: 'go' | 'hold') => update(s => ({ ...s, round: s.round === r ? null : r }))

  const tally = messages.reduce(
    (a, m) => { const d = decisions[m.id]; if (d) a[d]++; else a.undecided++; return a },
    { go: 0, defer: 0, nogo: 0, undecided: 0 } as Record<string, number>,
  )
  const decided = messages.length - tally.undecided

  // ux4 — client-side filter (no state-file change). Navigation walks the VISIBLE subset.
  const matches = (m: ReviewMsg) => filter === 'all' ? true : filter === 'undecided' ? !decisions[m.id] : decisions[m.id] === filter
  const visible = messages.filter(matches)

  // ux2/ux3 — navigation + keyboard actions (recomputed each render → always see fresh state)
  // Scroll a card into view so its top clears the sticky summary bar. We can't use
  // scrollIntoView({block:'center'}): a triage card taller than the viewport can't be
  // centred, so the browser top-aligns it and the sticky header sits ON TOP of the card.
  // Instead measure the header's actual bottom edge and land the card just below it.
  const scrollTo = (id: string) => {
    const el = cardRefs.current[id]
    if (!el) return
    const headerBottom = headerRef.current?.getBoundingClientRect().bottom ?? 0
    const gap = 12 // breathing room between the header and the card top
    const top = el.getBoundingClientRect().top + window.scrollY - headerBottom - gap
    window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
  }
  const focusItem = (id: string) => { setFocusId(id); scrollTo(id) }
  const moveFocus = (dir: 1 | -1) => {
    if (!visible.length) return
    const cur = visible.findIndex(m => m.id === focusId)
    const next = cur === -1 ? (dir > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, cur + dir))
    focusItem(visible[next].id)
  }
  const nextUndecided = (fromId: string | null, skip?: string) => {
    const start = messages.findIndex(m => m.id === fromId)
    for (let i = 1; i <= messages.length; i++) {
      const m = messages[(((start < 0 ? -1 : start) + i) % messages.length + messages.length) % messages.length]
      if (m.id !== skip && !decisions[m.id]) return m.id
    }
    return null
  }
  const jumpToNextUndecided = () => { const id = nextUndecided(focusId); if (id) focusItem(id) }
  const labelOf = (id: string) => { const m = messages.find(x => x.id === id); return m ? liteLabel(m) : id }

  // Add / remove reviewer tasks. Ids use a `u` prefix (user-added, distinct from the authored
  // source prefixes s*/l*/g*), numbered off the highest existing one so they never collide or
  // reuse a removed id. A new task is focused once its card renders (pendingFocus effect below).
  const pendingFocus = useRef<string | null>(null)
  const addTask = (text: string) => {
    const t = text.trim()
    if (!t) return
    const nextNum = added.reduce((mx, a) => { const m = /^u(\d+)$/.exec(a.id); return m ? Math.max(mx, +m[1]) : mx }, 0) + 1
    const id = `u${nextNum}`
    pendingFocus.current = id
    setFilter('all') // an added task is undecided — make sure the active filter can't hide it
    update(s => ({ ...s, added: [...(s.added ?? []), { id, text: t }] }))
  }
  const removeTask = (id: string) =>
    update(s => {
      const nextDec = { ...s.decisions }; delete nextDec[id]
      const nextNotes = { ...s.notes }; delete nextNotes[id]
      return { ...s, added: (s.added ?? []).filter(a => a.id !== id), decisions: nextDec, notes: nextNotes }
    })
  // Once a freshly-added card is in the DOM, focus + scroll it into view.
  useEffect(() => {
    const id = pendingFocus.current
    if (id && cardRefs.current[id]) { focusItem(id); pendingFocus.current = null }
  })

  // ux19 — undo. Each keyboard decision pushes {id, prev} and raises a toast; Cmd/Ctrl+Z
  // (or the toast button) restores the previous value. prev===undefined means "back to undecided".
  const recordUndo = (id: string, prev: Decision | undefined, d: Decision) => {
    undoStack.current.push({ id, prev })
    setToast({ id, prev, d, label: labelOf(id) })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }
  const restoreDecision = (id: string, prev?: Decision) => setDecisionRaw(id, prev)
  const undoLast = () => {
    const last = undoStack.current.pop()
    if (!last) return
    restoreDecision(last.id, last.prev)
    clearTimeout(toastTimer.current); setToast(null)
    focusItem(last.id)
  }

  const decideAndAdvance = (id: string, d: Decision) => {
    recordUndo(id, decisions[id], d)
    setDecisionValue(id, d)
    const nid = nextUndecided(id, id) // next still-undecided item, skipping the one we just set
    if (nid) focusItem(nid); else setFocusId(id)
  }
  // ux19 key-flow — decide from INSIDE the note (Ctrl/Cmd+g/d/x): mark the current item, then
  // advance to the next undecided AND focus its note, so you type-a-note-then-decide without
  // ever leaving the field. "The text is selected, I press ctrl+g, it marks go and moves on."
  const decideFromNote = (d: Decision) => {
    const id = focusId
    if (!id) return
    recordUndo(id, decisions[id], d)
    setDecisionValue(id, d)
    const nid = nextUndecided(id, id)
    if (nid) { setFocusId(nid); scrollTo(nid); requestAnimationFrame(() => noteRefs.current[nid]?.focus()) }
  }
  const focusNote = () => {
    const id = focusId ?? visible[0]?.id
    if (!id) return
    setFocusId(id)
    noteRefs.current[id]?.focus()
  }

  // ux16/ux17 — publish this board's progress + item list to the fixed-left SideNav so the
  // cross-group progress and a one-click jump list live there (no separate focus mode needed).
  useEffect(() => {
    publishBoard({
      uid, slug, decided, total: messages.length, focusedId: focusId,
      items: messages.map(m => ({ id: m.id, label: liteLabel(m), decision: decisions[m.id], focused: isActive && m.id === focusId })),
      jump: (id: string) => { claimStream(uid); setFilter('all'); focusItem(id) },
    })
  })

  // Global hotkeys. Mounted once; reads the latest handlers/flags through a ref so we never
  // re-subscribe. NEVER fires while a text field is focused (typing a note) — only Escape,
  // which blurs the field and hands the keyboard back to the board.
  const kb = useRef<{
    isActive: boolean; showHelp: boolean; paletteOpen: boolean
    move: (d: 1 | -1) => void; decide: (d: Decision) => void; decideNote: (d: Decision) => void
    e: () => void; u: () => void; a: () => void; help: () => void; palette: () => void; undo: () => void
  }>(null as never)
  kb.current = {
    isActive, showHelp, paletteOpen,
    move: dir => moveFocus(dir),
    decide: d => { const id = focusId ?? visible[0]?.id; if (id) decideAndAdvance(id, d) },
    decideNote: decideFromNote,
    e: focusNote, u: jumpToNextUndecided, a: acceptAllRecs,
    help: () => setShowHelp(h => !h), palette: () => setPaletteOpen(true), undo: undoLast,
  }
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const k = kb.current
      if (k.paletteOpen) return // the command palette owns the keyboard while open
      const el = document.activeElement as HTMLElement | null
      const typing = !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)
      const key = ev.key.toLowerCase()
      const mod = ev.metaKey || ev.ctrlKey
      // decide from INSIDE a note — Ctrl/Cmd + g/d/x. This is the ONE combo allowed while
      // typing (the key flow): mark + advance + focus the next note.
      if (mod && !ev.altKey && k.isActive) {
        const dk: Decision | undefined = key === 'g' ? 'go' : key === 'd' ? 'defer' : key === 'x' ? 'nogo' : undefined
        if (dk) { ev.preventDefault(); k.decideNote(dk); return }
      }
      if (ev.key === 'Escape') { if (k.showHelp) k.help(); else if (typing && el) el.blur(); return }
      if (typing || !k.isActive) return
      if (mod && key === 'z') { ev.preventDefault(); k.undo(); return }
      if (mod && key === 'k') { ev.preventDefault(); k.palette(); return }
      if (mod || ev.altKey) return
      const map: Record<string, (() => void) | undefined> = {
        j: () => k.move(1), k: () => k.move(-1),
        ArrowDown: () => k.move(1), ArrowUp: () => k.move(-1),
        g: () => k.decide('go'), d: () => k.decide('defer'), x: () => k.decide('nogo'),
        e: k.e, u: k.u, a: k.a, '?': k.help,
      }
      const fn = map[ev.key]
      if (fn) { ev.preventDefault(); fn() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chip = (k: 'all' | 'undecided' | Decision, label: string, n: number) => (
    <button
      key={k}
      onClick={() => setFilter(k)}
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition ${filter === k ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
    >
      {label} <span className="tabular-nums opacity-70">{n}</span>
    </button>
  )

  return (
    <div data-toc-skip onPointerDownCapture={() => claimStream(uid)}>
      {IS_STATIC && (
        <div className="mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>⚠ Read-only snapshot — this board can’t save.</strong> This is a shared static
          export: Go / Defer / No-go and notes are disabled here, and anything you type would vanish
          on reload. Open the page on the local pages daemon (<code>localhost:4317</code>) to record
          decisions.
        </div>
      )}
      {/* sticky summary / filters / round gate */}
      <div ref={headerRef} className="sticky top-3 z-10 mb-6 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="font-semibold text-slate-900">{decided}/{messages.length} decided</span>
          <span className="text-green-700">● {tally.go} go</span>
          <span className="text-amber-700">● {tally.defer} defer</span>
          <span className="text-red-600">● {tally.nogo} no-go</span>
          <span className="text-slate-400">○ {tally.undecided} undecided</span>
          <span className="ml-auto flex items-center gap-2">
            <button onClick={acceptAllRecs} className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
              Accept all recommendations<Kbd>a</Kbd>
            </button>
            {/* fixed width so saving⇄saved text swaps never shift the row while typing a note */}
            <span className={`inline-block w-14 text-right text-[11px] tabular-nums ${status.saving ? 'text-amber-600' : 'text-slate-300'}`}>
              {status.saving ? 'saving…' : status.loaded ? 'saved' : '…'}
            </span>
          </span>
        </div>

        {/* ux4 filter chips · ux3 jump-to-next-undecided · ux2 shortcuts */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {chip('all', 'All', messages.length)}
          {chip('undecided', 'Undecided', tally.undecided)}
          {chip('go', 'Go', tally.go)}
          {chip('defer', 'Defer', tally.defer)}
          {chip('nogo', 'No-go', tally.nogo)}
          <span className="ml-auto flex items-center gap-1.5">
            {tally.undecided > 0 && (
              <button onClick={jumpToNextUndecided} className="rounded-md border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50">
                next undecided ↓<Kbd>u</Kbd>
              </button>
            )}
            <button
              onClick={() => setPaletteOpen(true)}
              title="command palette (⌘K)"
              className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
            >
              ⌘K
            </button>
            <button
              onClick={() => setShowHelp(h => !h)}
              title="keyboard shortcuts (?)"
              className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${isActive ? 'border-indigo-300 text-indigo-600 hover:bg-indigo-50' : 'border-slate-200 text-slate-400 hover:bg-slate-50'}`}
            >
              ⌨ ?
            </button>
          </span>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
          <div className="flex h-full">
            <div className="bg-green-500" style={{ width: `${(tally.go / messages.length) * 100}%` }} />
            <div className="bg-amber-400" style={{ width: `${(tally.defer / messages.length) * 100}%` }} />
            <div className="bg-red-500" style={{ width: `${(tally.nogo / messages.length) * 100}%` }} />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next round</span>
          <button
            onClick={() => setRound('go')}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition ${state.round === 'go' ? 'border-green-600 bg-green-600 text-white' : 'border-green-300 text-green-700 hover:bg-green-50'}`}
          >
            ✓ GO — start round
          </button>
          <button
            onClick={() => setRound('hold')}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold transition ${state.round === 'hold' ? 'border-slate-600 bg-slate-700 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            ✕ HOLD
          </button>
          {state.round === 'go' && tally.undecided > 0 && (
            <span className="text-xs text-amber-600">{tally.undecided} still undecided</span>
          )}
        </div>
      </div>

      {/* message stream */}
      <div className="space-y-5">
        {visible.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
            No items match the <strong className="font-semibold text-slate-500">{filter}</strong> filter.
          </div>
        )}
        {messages.map(m => {
          if (!matches(m)) return null
          const d = decisions[m.id]
          const dimmed = d === 'nogo'
          const focused = isActive && m.id === focusId
          const saveDot = lastEditedId === m.id
            ? <span className={`block h-2 w-2 rounded-full ${status.saving ? 'animate-pulse bg-amber-500' : 'bg-green-500'}`} title={status.saving ? 'saving…' : 'saved'} />
            : null
          return (
            <div
              key={m.id}
              id={m.id}
              ref={el => { cardRefs.current[m.id] = el }}
              className={`scroll-mt-24 rounded-xl border p-4 transition ${focused ? 'ring-2 ring-indigo-400 ring-offset-2' : ''} ${d === 'go' ? 'border-green-200 bg-green-50/40' : d === 'nogo' ? 'border-slate-200 bg-slate-50/60 opacity-70' : d === 'defer' ? 'border-amber-200 bg-amber-50/30' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold text-white">
                  {(m.author || 'M')[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-semibold text-slate-900">{m.author || 'Michael'}</span>
                    <span className="text-xs text-slate-400">{m.time}</span>
                    {addedIds.has(m.id) && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">added</span>}
                    {m.type && <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-500">{m.type}{m.pri ? ` · ${m.pri}` : ''}</span>}
                    {addedIds.has(m.id) && (
                      <button
                        onClick={() => removeTask(m.id)}
                        title="Remove this task"
                        className="ml-auto rounded px-1.5 py-0.5 text-xs font-medium text-slate-300 transition hover:bg-red-50 hover:text-red-500"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {m.text != null && <div className={`mt-1 whitespace-pre-line leading-relaxed ${dimmed ? 'text-slate-500' : 'text-slate-800'}`}>{m.text}</div>}
                  {!m.text && (!m.attachments?.length ? null : <div className="mt-1 text-sm italic text-slate-400">(no text — attachment only)</div>)}
                  {m.links && m.links.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {m.links.map((l, i) => (
                        <li key={i}><a href={l.href} target="_blank" rel="noreferrer" className="break-all text-sm text-blue-600 underline underline-offset-2">{l.label}</a></li>
                      ))}
                    </ul>
                  )}
                  {m.attachments?.map((a, i) => <Attachment key={i} slug={slug} att={a} />)}
                  {m.replies?.map((r, i) => (
                    <div key={i} className="mt-2 border-l-2 border-slate-200 pl-3">
                      <span className="text-xs font-semibold text-slate-700">{r.author}</span>
                      <span className="ml-2 text-[11px] text-slate-400">{r.time}</span>
                      <div className="text-sm leading-relaxed text-slate-600">{r.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* recommendation + decision controls */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-slate-100 pt-3">
                {m.rec && (
                  <span className="text-xs text-slate-500">
                    rec: <strong className={recTone[m.rec]}>{DECISIONS.find(x => x.key === m.rec)!.label}</strong>
                    {m.recNote ? <span className="text-slate-400"> — {m.recNote}</span> : null}
                  </span>
                )}
                {m.flag && flagPill[m.flag] && (
                  <Pill tone={flagPill[m.flag].tone}>{flagPill[m.flag].label}</Pill>
                )}
                <div className="ml-auto inline-flex gap-1.5">
                  {DECISIONS.map(b => {
                    const hint = b.key === 'go' ? 'g' : b.key === 'defer' ? 'd' : 'x'
                    return (
                      <button
                        key={b.key}
                        onClick={() => setDecision(m.id, b.key)}
                        className={`rounded-md border px-2.5 py-1 text-xs font-semibold transition ${d === b.key ? b.on : b.off}`}
                      >
                        {b.label}{focused && <Kbd on={d === b.key}>{hint}</Kbd>}
                      </button>
                    )
                  })}
                </div>
              </div>
              <AutoNote
                value={notes[m.id] || ''}
                onChange={v => setNote(m.id, v)}
                onFocus={() => { claimStream(uid); setFocusId(m.id) }}
                inputRef={el => { noteRefs.current[m.id] = el }}
                placeholder="add a note…  (⌘/Ctrl+Enter commits · ⌘/Ctrl+G/D/X decides & moves on)"
                dot={saveDot}
              />
            </div>
          )
        })}
        <AddTaskRow onAdd={addTask} />
      </div>

      {/* ux2 — keyboard cheatsheet overlay (?) */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowHelp(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-bold text-slate-900">Keyboard shortcuts</h3>
              <button onClick={() => setShowHelp(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <dl className="space-y-1.5 text-sm">
              {[
                ['j / k · ↓ / ↑', 'move focus down / up'],
                ['g / d / x', 'Go / Defer / No-go — then auto-advance'],
                ['⌘/Ctrl+G / D / X', 'decide from inside a note — mark & move on'],
                ['e', 'edit the focused note'],
                ['u', 'jump to next undecided'],
                ['a', 'accept all recommendations'],
                ['⌘/Ctrl+K', 'command palette — jump to any item'],
                ['⌘/Ctrl+Z', 'undo the last decision'],
                ['?', 'toggle this cheatsheet'],
                ['Esc', 'leave the note / close this'],
              ].map(([keys, desc]) => (
                <div key={keys as string} className="flex items-center justify-between gap-4">
                  <kbd className="whitespace-nowrap rounded border border-slate-300 bg-slate-50 px-2 py-0.5 font-mono text-[12px] text-slate-700">{keys}</kbd>
                  <span className="text-right text-slate-600">{desc}</span>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-[11px] text-slate-400">
              Shortcuts drive the active board (click a board to activate). Typing in a note suspends the plain keys —
              but ⌘/Ctrl+G/D/X still decide from within the field. Esc returns.
            </p>
          </div>
        </div>
      )}

      {/* ux20 — command palette (⌘K) */}
      {paletteOpen && (
        <CommandPalette
          items={messages.map(m => ({ id: m.id, label: liteLabel(m), decision: decisions[m.id] }))}
          onJump={id => { setFilter('all'); claimStream(uid); focusItem(id) }}
          onAccept={acceptAllRecs}
          onUndecided={jumpToNextUndecided}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* ux19 — undo toast */}
      {toast && <UndoToast label={toast.label} d={toast.d} onUndo={undoLast} onClose={() => setToast(null)} />}
    </div>
  )
}

/* ux20 — command palette: ⌘K opens it; fuzzy-jump to any item by its text/id, or run a
   board action. Owns the keyboard while open (its own arrow/enter/esc handlers). */
function CommandPalette({ items, onJump, onAccept, onUndecided, onClose }: {
  items: BoardItemLite[]; onJump: (id: string) => void; onAccept: () => void; onUndecided: () => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const ql = q.toLowerCase()
  type Row = { kind: 'action'; label: string; run: () => void } | { kind: 'item'; id: string; label: string; decision?: Decision }
  const actions: Row[] = [
    { kind: 'action', label: 'Accept all recommendations', run: onAccept },
    { kind: 'action', label: 'Jump to next undecided', run: onUndecided },
  ]
  const rows: Row[] = [
    ...actions.filter(a => a.label.toLowerCase().includes(ql)),
    ...items
      .filter(it => it.label.toLowerCase().includes(ql) || it.id.toLowerCase().includes(ql))
      .map(it => ({ kind: 'item' as const, id: it.id, label: it.label, decision: it.decision })),
  ]
  const clamp = Math.max(0, Math.min(sel, rows.length - 1))
  const run = (r?: Row) => { if (!r) return; if (r.kind === 'action') r.run(); else onJump(r.id); onClose() }
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={e => { setQ(e.target.value); setSel(0) }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, rows.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
            else if (e.key === 'Enter') { e.preventDefault(); run(rows[clamp]) }
            else if (e.key === 'Escape') { e.preventDefault(); onClose() }
          }}
          placeholder="Jump to an item, or run an action…"
          className="w-full border-b border-slate-200 px-4 py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
        />
        <div className="max-h-80 overflow-auto p-1.5">
          {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-400">no matches</div>}
          {rows.map((r, i) => (
            <button
              key={r.kind === 'item' ? 'i' + r.id : 'a' + r.label}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(r)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${i === clamp ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-50'}`}
            >
              {r.kind === 'action'
                ? <><span className="opacity-70">▸</span><span className="flex-1">{r.label}</span></>
                : <><span className={`h-2 w-2 shrink-0 rounded-full ${dotFor(r.decision)}`} /><span className="flex-1 truncate">{r.label}</span><code className={`shrink-0 text-[10px] ${i === clamp ? 'text-white/70' : 'text-slate-400'}`}>{r.id}</code></>}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">↑↓ navigate · ↵ select · esc close</div>
      </div>
    </div>
  )
}

// ux19 — the undo toast raised after a keyboard decision.
function UndoToast({ label, d, onUndo, onClose }: { label: string; d: Decision; onUndo: () => void; onClose: () => void }) {
  const dl = DECISIONS.find(x => x.key === d)!.label
  return (
    <div className="fixed bottom-5 left-1/2 z-[55] flex max-w-[92vw] -translate-x-1/2 items-center gap-3 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
      <span className={`h-2 w-2 shrink-0 rounded-full ${decColor[d]}`} />
      <span className="truncate"><strong className="font-semibold">{dl}</strong> → <span className="text-slate-300">{label}</span></span>
      <button onClick={onUndo} className="shrink-0 rounded-md bg-white/15 px-2 py-0.5 text-xs font-semibold hover:bg-white/25">Undo <kbd className="ml-0.5 font-mono text-[10px] opacity-80">⌘Z</kbd></button>
      <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-white">✕</button>
    </div>
  )
}

/* ---- modal + sub-page (review a detailed version in place) -------------
   A generic centred overlay (Escape / backdrop-click to close, body-scroll
   locked while open) and a declarative <SubPage> that renders a "nice link"
   which opens arbitrary children in that modal. Lets a review page keep the
   summary inline and let the reader CLICK INTO the full detail without
   leaving the page — no scrolling off to a separate section. */
export function Modal({ open, title, onClose, children, width = 940 }: {
  open: boolean; title?: ReactNode; onClose: () => void; children: ReactNode; width?: number
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])
  if (!open) return null
  return (
    <div
      data-toc-skip
      className="fixed inset-0 z-[9998] flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 py-[6vh] motion-safe:animate-[fadeIn_120ms_ease-out] supports-[backdrop-filter]:backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full rounded-2xl border border-slate-200 bg-white shadow-2xl"
        style={{ maxWidth: width }}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 rounded-t-2xl border-b border-slate-200 bg-white/95 px-5 py-3.5 backdrop-blur">
          <div className="text-sm font-bold text-slate-800">{title}</div>
          <button onClick={onClose} className="rounded-lg px-2.5 py-1 text-sm font-medium text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">Close ✕</button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

export function SubPage({ title, trigger, width, children }: {
  title: ReactNode; trigger?: ReactNode; width?: number; children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
      >
        {trigger ?? <>{title}</>}
        <span aria-hidden className="text-[13px] leading-none opacity-70">⤢</span>
      </button>
      <Modal open={open} title={title} onClose={() => setOpen(false)} width={width}>{children}</Modal>
    </>
  )
}

/* ---- decision board (plans colocated with their Go/Defer/No-go) --------
   ReviewStream is a chat-style board where every card is authored as one flat
   message and the decision controls sit in a single stream — good for triage,
   but the plan and its decision drift apart on a long page. DecisionBoard puts
   each item's full plan (arbitrary children) and its Go/Defer/No-go + note in
   ONE card, so a reviewer reads and records the call without scrolling to a
   separate board. It persists to the SAME {decisions,notes} slug/shape as
   ReviewStream, so the triage skill reads it back identically. Pair with
   <SubPage> in an item's `details` slot to open the deep-dive in a modal. */
type DecisionBoardCtxT = {
  decisions: Record<string, Decision>
  notes: Record<string, string>
  set: (id: string, d: Decision) => void
  note: (id: string, v: string) => void
  register: (id: string) => void
}
const DecisionBoardCtx = createContext<DecisionBoardCtxT | null>(null)

export function DecisionBoard({ slug, children }: { slug: string; children: ReactNode }) {
  const seed: DecisionState = { decisions: {}, notes: {}, round: null, added: [] }
  const [state, update] = usePageState<DecisionState>(slug, seed)
  const decisions = state.decisions || {}
  const notes = state.notes || {}
  const [ids, setIds] = useState<string[]>([])
  const ctx: DecisionBoardCtxT = useMemo(() => ({
    decisions,
    notes,
    set: (id, d) => update(s => {
      const cur = { ...(s.decisions || {}) }
      if (cur[id] === d) delete cur[id]
      else cur[id] = d
      return { ...s, decisions: cur }
    }),
    note: (id, v) => update(s => ({ ...s, notes: { ...(s.notes || {}), [id]: v } })),
    register: id => setIds(prev => (prev.includes(id) ? prev : [...prev, id])),
  }), [decisions, notes, update])
  const decided = ids.filter(id => decisions[id]).length
  const counts = { go: 0, defer: 0, nogo: 0 } as Record<Decision, number>
  ids.forEach(id => { const d = decisions[id]; if (d) counts[d]++ })
  return (
    <DecisionBoardCtx.Provider value={ctx}>
      {IS_STATIC && (
        <div className="mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>⚠ Read-only snapshot — this board can't save.</strong> Decisions recorded here won't
          persist. Open the page on the local pages daemon (<code>localhost:4317</code>) to record Go /
          Defer / No-go.
        </div>
      )}
      <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white/95 px-4 py-2.5 text-sm shadow-sm backdrop-blur">
        <span className="font-bold text-slate-800">{decided}/{ids.length} decided</span>
        <span className="text-green-700">● {counts.go} go</span>
        <span className="text-amber-700">● {counts.defer} defer</span>
        <span className="text-red-600">● {counts.nogo} no-go</span>
      </div>
      <div className="space-y-4">{children}</div>
    </DecisionBoardCtx.Provider>
  )
}

export function DecisionItem({ id, title, tag, rec, recNote, details, detailsWidth, children }: {
  id: string; title: ReactNode; tag?: ReactNode; rec?: Decision; recNote?: ReactNode
  details?: ReactNode; detailsWidth?: number; children: ReactNode
}) {
  const ctx = useContext(DecisionBoardCtx)
  if (!ctx) throw new Error('DecisionItem must be used inside <DecisionBoard>')
  const { decisions, notes, set, note, register } = ctx
  useEffect(() => { register(id) }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = decisions[id]
  const ring = d === 'go' ? 'border-green-300' : d === 'defer' ? 'border-amber-300' : d === 'nogo' ? 'border-red-300' : 'border-slate-200'
  return (
    <div id={`d-${id}`} data-toc-skip className={`scroll-mt-24 rounded-2xl border bg-white p-5 shadow-sm transition ${ring}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-white">{id}</span>
            <h3 className="text-base font-bold text-slate-900">{title}</h3>
          </div>
          {tag && <div className="mt-1 text-xs text-slate-500">{tag}</div>}
        </div>
        {details && (
          <SubPage title={<>{id} — {title}</>} trigger={<>View full plan</>} width={detailsWidth}>{details}</SubPage>
        )}
      </div>
      <div className="mt-3 text-sm leading-relaxed text-slate-700">{children}</div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">decision</span>
        {DECISIONS.map(dd => (
          <button
            key={dd.key}
            onClick={() => set(id, dd.key)}
            className={`rounded-lg border px-3 py-1 text-xs font-semibold transition ${d === dd.key ? dd.on : dd.off}`}
          >
            {dd.label}
          </button>
        ))}
        {rec && <span className={`ml-1 text-xs font-medium ${recTone[rec]}`}>rec: {rec}{recNote ? <> — {recNote}</> : null}</span>}
      </div>
      <AutoNote value={notes[id] ?? ''} placeholder="Add a note / answer an open question…" onChange={v => note(id, v)} />
    </div>
  )
}

/* ---- legacy aliases (the library was born as "plan-ui") ----------------
   Existing *.plan.tsx files import { Plan, usePlanState } and type PlanMeta.
   Keep them working; new pages use Page / usePageState / PageMeta. */
export const Plan = Page
export const usePlanState = usePageState
export type PlanMeta = PageMeta
