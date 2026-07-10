/* Reusable thread-model triage board. Render <TriageBoard slug items plansSlug? />.
   State persists to <slug>.state.json. Keyboard logic in ./triage-hotkeys.mjs (unit-tested).

   This iteration:
     • Comment-first flow only — you live in the comment box; modifier+Enter decides & advances.
     • Decision buttons annotated with their hotkeys; the composer sits at the BOTTOM of each thread
       (below agent replies) so you can always reply again after the agent responds.
     • Left control bar (status + progress + GO/HOLD + a click-to-jump item list + hotkey legend),
       mirroring the "on this page" rail. The old sticky header only shows on narrow screens.
     • Threads can be resolved → collapsed to a one-line headline (click to peek). An agent reply of
       kind 'resolved' surfaces a "Resolve & collapse" proposal.
     • Board shows the HEADLINE only; the full explanation lives on a separate plans page
       (<plansSlug>) reached via "View full plan →". */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePageState, PrStatus, Modal } from '@page'
import { resolveAction, nextUndecided, neighbor } from './triage-hotkeys.mjs'

export type Decision = 'go' | 'defer' | 'nogo'
export type Lnk = { label: string; href: string }
export type Ev =
  | { t: 'proposed'; time?: string; text: ReactNode; rec?: Decision; links?: Lnk[] }
  | { t: 'update' | 'resolved' | 'blocked'; time?: string; text: ReactNode; links?: Lnk[] }
// `headline` is what the board shows; `text` is the full explanation (rendered on the plans page).
export type Item = { id: string; title: string; source?: string; type?: string; pri?: string; rec: Decision; headline?: ReactNode; proposed: Ev & { t: 'proposed' } }

const DEC: Record<Decision, { label: string; solid: string; text: string; softbg: string; hint: string }> = {
  go: { label: 'Go', solid: 'bg-green-600 text-white', text: 'text-green-700', softbg: 'bg-green-50', hint: 'Ctrl+Enter' },
  defer: { label: 'Defer', solid: 'bg-amber-500 text-white', text: 'text-amber-700', softbg: 'bg-amber-50', hint: 'Alt+Enter' },
  nogo: { label: 'No-go', solid: 'bg-red-600 text-white', text: 'text-red-600', softbg: 'bg-red-50', hint: 'Ctrl+Shift+Enter' },
}
const EV: Record<'proposed' | 'update' | 'resolved' | 'blocked' | 'comment', { label: string; glyph: string; text: string; softbg: string }> = {
  proposed: { label: 'Proposed', glyph: '◇', text: 'text-indigo-600', softbg: 'bg-indigo-50' },
  update: { label: 'Update', glyph: '↳', text: 'text-sky-600', softbg: 'bg-sky-50' },
  resolved: { label: 'Resolved', glyph: '✓', text: 'text-green-700', softbg: 'bg-green-50' },
  blocked: { label: 'Blocked', glyph: '⚠', text: 'text-red-600', softbg: 'bg-red-50' },
  comment: { label: 'You', glyph: '◆', text: 'text-slate-600', softbg: 'bg-slate-100' },
}
const decDot: Record<Decision, string> = { go: 'bg-green-500', defer: 'bg-amber-500', nogo: 'bg-red-500' }
const HOTKEYS: [string, string][] = [
  ['Ctrl+Enter', 'Go & next'],
  ['Ctrl+Shift+Enter', 'No-go & next'],
  ['Alt+Enter', 'Defer & next'],
  ['Ctrl+Up / Down', 'move (no decide)'],
  ['Esc', 'leave the box'],
]

type Reply = { seq: number; order?: number; decision?: Decision; comment?: string }
type AgentReply = { seq: number; order?: number; kind: 'update' | 'resolved' | 'blocked'; headline?: string; text: string; links?: Lnk[]; prs?: number[]; time?: string }
type BoardState = { decisions: Record<string, Decision>; replies: Record<string, Reply[]>; agentReplies?: Record<string, AgentReply[]>; resolved?: Record<string, boolean>; round?: 'go' | 'hold' | null }

// first line / first ~140 chars of a string, for headline display.
const oneLine = (s: string, n = 140) => { const t = (s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t }

function LinkRow({ links }: { links?: Lnk[] }) {
  if (!links?.length) return null
  return <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">{links.map((l, i) => <a key={i} href={l.href} target="_blank" rel="noreferrer" className="text-[13px] text-blue-600 underline underline-offset-2">{l.label}</a>)}</div>
}

// Full content shown inside the "View full plan" modal: the long text + any PRs (as live status
// chips) + links.
function FullContent({ text, links, prs }: { text: ReactNode; links?: Lnk[]; prs?: number[] }) {
  return (
    <div>
      <div className="text-[15px] leading-relaxed text-slate-800">{text}</div>
      {prs?.length ? <div className="mt-3 flex flex-wrap gap-3">{prs.map(n => <PrStatus key={n} pr={n} />)}</div> : null}
      <LinkRow links={links} />
    </div>
  )
}

// A rail event shown as a HEADLINE. PRs render as live status chips; "View full plan →" opens the
// full write-up in a modal (via onView).
function HeadlineRow({ kind, label, headline, onView, prs, rec, time, extra }: {
  kind: keyof typeof EV; label?: string; headline: ReactNode; onView?: () => void; prs?: number[]; rec?: Decision; time?: string; extra?: ReactNode
}) {
  const s = EV[kind]
  return (
    <div className="relative">
      <span className={`absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ring-4 ring-white ${s.softbg} ${s.text}`}>{s.glyph}</span>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${s.text}`}>{label ?? s.label}</span>
        {rec && <span className="text-[11px] text-slate-400">rec · <span className={DEC[rec].text}>{DEC[rec].label}</span></span>}
        {extra}
        {time && <span className="ml-auto text-[11px] tabular-nums text-slate-400">{time}</span>}
      </div>
      <div className="mt-1 text-[15px] leading-relaxed text-slate-800">{headline}</div>
      {(prs?.length || onView) && (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          {prs?.map(n => <PrStatus key={n} pr={n} />)}
          {onView && <button onClick={onView} className="text-[13px] font-medium text-indigo-600 hover:underline">View full plan →</button>}
        </div>
      )}
    </div>
  )
}

function CommentLine({ text, onSave, onDelete }: { text: string; onSave: (v: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(text)
  useEffect(() => setV(text), [text])
  if (editing) {
    return (
      <div className="relative">
        <span className={`absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ring-4 ring-white ${EV.comment.softbg} ${EV.comment.text}`}>◆</span>
        <textarea autoFocus rows={2} value={v} onChange={e => setV(e.target.value)}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSave(v.trim()); setEditing(false) } else if (e.key === 'Escape') { e.stopPropagation(); setV(text); setEditing(false) } }}
          className="block w-full resize-none rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none" />
        <div className="mt-1 flex justify-end gap-2">
          <button onClick={() => { setV(text); setEditing(false) }} className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-100">Cancel</button>
          <button onClick={() => { onSave(v.trim()); setEditing(false) }} className="rounded bg-indigo-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">Save</button>
        </div>
      </div>
    )
  }
  return (
    <div className="group relative">
      <span className={`absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ring-4 ring-white ${EV.comment.softbg} ${EV.comment.text}`}>◆</span>
      <div className="flex items-start gap-2">
        <span className="flex-1 whitespace-pre-line text-[14px] leading-relaxed text-slate-700">{text}</span>
        <span className="shrink-0 opacity-0 transition group-hover:opacity-100">
          <button onClick={() => setEditing(true)} title="Edit" className="rounded px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700">✎</button>
          <button onClick={onDelete} title="Delete" className="rounded px-1 text-xs text-slate-300 hover:bg-red-50 hover:text-red-500">✕</button>
        </span>
      </div>
    </div>
  )
}

// The bottom composer: annotated decision buttons + textarea. Lives at the foot of the thread so a
// reply always lands below the agent's latest response.
function Composer({ item, decision, draft, boxRef, onToggle, onDraft, onAdd, onResolve, resolveProposed }: {
  item: Item; decision?: Decision; draft: string; boxRef: (el: HTMLTextAreaElement | null) => void
  onToggle: (d: Decision) => void; onDraft: (v: string) => void; onAdd: () => void; onResolve: () => void; resolveProposed: boolean
}) {
  return (
    <div className="relative">
      <span className="absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-white text-slate-400 ring-4 ring-white">✎</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {(['go', 'defer', 'nogo'] as Decision[]).map(k => (
          <button key={k} onClick={() => onToggle(k)} title={`hotkey ${DEC[k].hint}`}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${decision === k ? DEC[k].solid + ' border-transparent' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>
            {DEC[k].label}
            <kbd className={`rounded px-1 font-mono text-[9px] font-bold leading-[1.4] ${decision === k ? 'bg-white/25 text-white' : 'border border-slate-300 bg-slate-50 text-slate-400'}`}>{DEC[k].hint}</kbd>
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {resolveProposed && <span className="text-[11px] text-green-700">agent proposes resolving</span>}
          <button onClick={onResolve} className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${resolveProposed ? 'border-green-500 bg-green-600 text-white hover:bg-green-700' : 'border-slate-300 text-slate-500 hover:bg-slate-50'}`}>✓ Resolve &amp; collapse</button>
        </span>
      </div>
      <textarea ref={boxRef} rows={2} value={draft} onChange={e => onDraft(e.target.value)}
        placeholder="reply…  (Ctrl+Enter = Go & next · Alt+Enter = Defer · Ctrl+Shift+Enter = No-go)"
        className="mt-2 block w-full resize-none rounded-md border border-slate-200 bg-white p-2 text-sm text-slate-700 placeholder:text-slate-300 focus:border-indigo-400 focus:outline-none" />
      <div className="mt-1 flex justify-end"><button onClick={onAdd} disabled={!draft.trim()} className="rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-40">Add comment ▸</button></div>
    </div>
  )
}

type TimelineEntry = { order: number; kind: 'comment'; seq: number; text: string } | { order: number; kind: 'agent'; reply: AgentReply }

function ThreadCard({ item, decision, comments, agentReplies, resolved, draft, focused, cardRef, boxRef, onView, onToggle, onDraft, onAdd, onEditComment, onDeleteComment, onResolve, onUnresolve, onFocusBox }: {
  item: Item; decision?: Decision; comments: Reply[]; agentReplies: AgentReply[]; resolved: boolean; draft: string; focused: boolean
  cardRef: (el: HTMLDivElement | null) => void; boxRef: (el: HTMLTextAreaElement | null) => void
  onView: (title: ReactNode, content: ReactNode) => void
  onToggle: (d: Decision) => void; onDraft: (v: string) => void; onAdd: () => void
  onEditComment: (seq: number, v: string) => void; onDeleteComment: (seq: number) => void; onResolve: () => void; onUnresolve: () => void; onFocusBox: () => void
}) {
  const status = resolved ? { label: 'resolved', cls: 'bg-green-100 text-green-700' } : decision ? { label: DEC[decision].label, cls: DEC[decision].solid } : { label: 'awaiting reply', cls: 'bg-indigo-100 text-indigo-700' }
  const meta = [item.type, item.pri, item.source].filter(Boolean).join(' · ')

  if (resolved) {
    return (
      <div ref={cardRef} id={item.id} className="scroll-mt-8 rounded-2xl border border-green-200 bg-green-50/40 px-5 py-3">
        <button onClick={onUnresolve} className="flex w-full items-center gap-2 text-left">
          <span className="text-green-600">✓</span>
          <span className="font-mono text-xs font-semibold text-slate-400">{item.id}</span>
          <span className="truncate text-[15px] font-semibold text-slate-700">{item.title}</span>
          <span className="ml-auto shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-700">resolved</span>
          <span className="shrink-0 text-xs text-slate-400">expand ▾</span>
        </button>
      </div>
    )
  }

  // chronological timeline: user comments + agent replies merged by `order`.
  const entries: TimelineEntry[] = [
    ...comments.filter(c => (c.comment || '').trim()).map((c, i) => ({ order: c.order ?? (i + 1), kind: 'comment' as const, seq: c.seq, text: c.comment || '' })),
    ...agentReplies.map((r, i) => ({ order: r.order ?? (100 + i), kind: 'agent' as const, reply: r })),
  ].sort((a, b) => a.order - b.order)

  return (
    <div ref={cardRef} id={item.id} className={`scroll-mt-8 rounded-2xl border p-5 shadow-sm transition ${focused ? 'ring-2 ring-indigo-400 ring-offset-2' : ''} ${decision === 'go' ? 'border-green-200 bg-green-50/25' : decision === 'nogo' ? 'border-slate-200 bg-slate-50/50' : decision === 'defer' ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200 bg-white'}`}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-2 border-b border-slate-100 pb-3">
        <span className="font-mono text-xs font-semibold text-slate-400">{item.id}</span>
        <span className="text-base font-semibold text-slate-900">{item.title}</span>
        {meta && <span className="text-xs text-slate-400">{meta}</span>}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
      </div>
      <div className="relative pl-9">
        <span className="absolute left-[13px] top-2 bottom-2 w-px bg-slate-200" />
        <div className="space-y-5">
          <HeadlineRow kind="proposed" headline={item.headline ?? item.proposed.text} onView={item.headline ? () => onView(`${item.id} — ${item.title}`, <FullContent text={item.proposed.text} links={item.proposed.links} />) : undefined} rec={item.proposed.rec} time={item.proposed.time} />
          {decision && <div className="relative"><span className={`absolute -left-9 top-0.5 flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold ring-4 ring-white ${DEC[decision].softbg} ${DEC[decision].text}`}>◆</span><span className={`text-[11px] font-semibold uppercase tracking-wider ${DEC[decision].text}`}>Decision · {DEC[decision].label}</span></div>}
          {entries.map((e, i) => e.kind === 'comment'
            ? <CommentLine key={'c' + e.seq} text={e.text} onSave={v => onEditComment(e.seq, v)} onDelete={() => onDeleteComment(e.seq)} />
            : <HeadlineRow key={'a' + i} kind={e.reply.kind} headline={e.reply.headline || oneLine(e.reply.text)} prs={e.reply.prs} onView={() => onView(`${item.id} — ${EV[e.reply.kind].label}`, <FullContent text={e.reply.text} links={e.reply.links} prs={e.reply.prs} />)} time={e.reply.time} />)}
          <Composer item={item} decision={decision} draft={draft} boxRef={boxRef} onToggle={onToggle} onDraft={onDraft} onAdd={onAdd} onResolve={onResolve} resolveProposed={agentReplies.some(r => r.kind === 'resolved')} />
        </div>
      </div>
    </div>
  )
}

function LeftBar({ items, decisions, resolved, tally, decided, round, onJump, onAcceptAll, onRound }: {
  items: Item[]; decisions: Record<string, Decision>; resolved: Record<string, boolean>
  tally: Record<string, number>; decided: number; round: 'go' | 'hold' | null | undefined
  onJump: (id: string) => void; onAcceptAll: () => void; onRound: (r: 'go' | 'hold') => void
}) {
  return (
    <div
      style={{ position: 'fixed', bottom: 20, left: 16, width: 224, maxHeight: 'calc(100vh - 40px)', zIndex: 30 }}
      className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur"
    >
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-center justify-between text-sm"><span className="font-semibold text-slate-900">{decided}/{items.length} decided</span><span className="text-[11px] text-slate-400">{tally.undecided} open</span></div>
        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="bg-green-500" style={{ width: `${(tally.go / items.length) * 100}%` }} /><div className="bg-amber-400" style={{ width: `${(tally.defer / items.length) * 100}%` }} /><div className="bg-red-500" style={{ width: `${(tally.nogo / items.length) * 100}%` }} /></div>
        <div className="mt-2 flex items-center gap-2 text-[11px]"><span className="text-green-700">● {tally.go}</span><span className="text-amber-700">● {tally.defer}</span><span className="text-red-600">● {tally.nogo}</span>
          <button onClick={onAcceptAll} className="ml-auto rounded border border-slate-300 px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-50">Accept recs</button>
        </div>
        <div className="mt-2 flex gap-1.5">
          <button onClick={() => onRound('go')} className={`flex-1 rounded border px-2 py-1 text-xs font-semibold ${round === 'go' ? 'border-green-600 bg-green-600 text-white' : 'border-green-300 text-green-700 hover:bg-green-50'}`}>✓ GO</button>
          <button onClick={() => onRound('hold')} className={`flex-1 rounded border px-2 py-1 text-xs font-semibold ${round === 'hold' ? 'border-slate-600 bg-slate-700 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>✕ HOLD</button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1.5">
        {items.map(it => {
          const d = decisions[it.id]
          return (
            <button key={it.id} onClick={() => onJump(it.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px] text-slate-600 hover:bg-slate-50">
              <span className={`h-2 w-2 shrink-0 rounded-full ${resolved[it.id] ? 'bg-green-500 ring-2 ring-green-200' : d ? decDot[d] : 'border border-slate-300 bg-white'}`} />
              <span className="w-8 shrink-0 font-mono text-[11px] text-slate-400">{it.id}</span>
              <span className={`truncate ${resolved[it.id] ? 'text-slate-400 line-through' : ''}`}>{it.title}</span>
            </button>
          )
        })}
      </div>
      <div className="border-t border-slate-100 p-2.5">
        <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">Keyboard · comment-first</div>
        <dl className="space-y-0.5">
          {HOTKEYS.map(([k, d]) => <div key={k} className="flex items-center justify-between gap-2"><kbd className="whitespace-nowrap rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono text-[9px] text-slate-600">{k}</kbd><span className="text-right text-[10px] text-slate-400">{d}</span></div>)}
        </dl>
      </div>
    </div>
  )
}

export function TriageBoard({ slug, items, plansSlug }: { slug: string; items: Item[]; plansSlug?: string }) {
  const ids = items.map(i => i.id)
  const [state, update] = usePageState<BoardState>(slug, { decisions: {}, replies: {}, agentReplies: {}, resolved: {}, round: null })
  const decisions = state.decisions || {}
  const replies = state.replies || {}
  const agentReplies = state.agentReplies || {}
  const resolved = state.resolved || {}

  const [draft, setDraft] = useState<Record<string, string>>({})
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [modal, setModal] = useState<{ title: ReactNode; content: ReactNode } | null>(null)
  // The left control bar needs room; show it via a JS media query (Tailwind responsive variants
  // aren't generated for notes/pages, so we can't rely on xl:*).
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1180px)')
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const boxRefs = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const setDraftFor = (id: string, v: string) => setDraft(d => ({ ...d, [id]: v }))
  const maxOrder = (id: string) => Math.max(0, ...(replies[id] || []).map(r => r.order ?? 0), ...(agentReplies[id] || []).map(r => r.order ?? 0))
  // A new comment must sort AFTER everything currently rendered — including agent replies that have
  // no explicit `order` (the timeline falls those back to 100+i, so we must too, or the new comment
  // lands before them). Mirror the exact fallbacks used when building the timeline.
  const addComment = (id: string, text: string) => { if (!text.trim()) return; update(s => { const rs = s.replies[id] || []; const ars = s.agentReplies?.[id] || []; const effMax = Math.max(0, ...rs.map((r, i) => r.order ?? (i + 1)), ...ars.map((r, i) => r.order ?? (100 + i))); const seq = rs.reduce((m, r) => Math.max(m, r.seq), 0) + 1; return { ...s, replies: { ...s.replies, [id]: [...rs, { seq, order: effMax + 1, comment: text.trim() }] } } }) }
  const commitDraft = (id: string) => { const t = (draft[id] || '').trim(); if (t) { addComment(id, t); setDraftFor(id, '') } }
  const editComment = (id: string, seq: number, v: string) => update(s => ({ ...s, replies: { ...s.replies, [id]: (s.replies[id] || []).map(r => r.seq === seq ? { ...r, comment: v } : r) } }))
  const deleteComment = (id: string, seq: number) => update(s => ({ ...s, replies: { ...s.replies, [id]: (s.replies[id] || []).filter(r => r.seq !== seq) } }))
  const setDecisionValue = (id: string, d: Decision) => update(s => ({ ...s, decisions: { ...s.decisions, [id]: d } }))
  const toggleDecision = (id: string, d: Decision) => update(s => { const n = { ...s.decisions }; if (n[id] === d) delete n[id]; else n[id] = d; return { ...s, decisions: n } })
  const setResolved = (id: string, v: boolean) => update(s => ({ ...s, resolved: { ...(s.resolved || {}), [id]: v } }))
  const setRound = (r: 'go' | 'hold') => update(s => ({ ...s, round: s.round === r ? null : r }))
  const acceptAll = () => update(s => { const n = { ...s.decisions }; for (const it of items) if (n[it.id] == null) n[it.id] = it.rec; return { ...s, decisions: n } })

  const scrollToCard = (id: string) => { const el = cardRefs.current[id]; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY - 24; window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' }) }
  const focusBox = (id: string) => boxRefs.current[id]?.focus()
  const jump = (id: string) => { if (resolved[id]) setResolved(id, false); setFocusedId(id); scrollToCard(id); requestAnimationFrame(() => focusBox(id)) }
  const advance = (fromId: string, decisionsNow: Record<string, Decision>) => { const nid = nextUndecided(ids, decisionsNow, fromId); if (nid) { setFocusedId(nid); scrollToCard(nid); requestAnimationFrame(() => focusBox(nid)) } }
  const decideAndAdvance = (id: string, d: Decision) => { commitDraft(id); setDecisionValue(id, d); advance(id, { ...decisions, [id]: d }) }

  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {})
  handlerRef.current = (e: KeyboardEvent) => {
    const el = document.activeElement as HTMLElement | null
    const inField = !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)
    const action: any = resolveAction('field', { key: e.key, meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, inField })
    if (!action) return
    e.preventDefault()
    const fid = focusedId ?? ids[0]
    if (action.kind === 'decide') decideAndAdvance(fid, action.decision)
    else if (action.kind === 'move') { const nid = neighbor(ids, focusedId, action.dir); if (nid) { setFocusedId(nid); scrollToCard(nid); requestAnimationFrame(() => focusBox(nid)) } }
    else if (action.kind === 'blur') el?.blur()
    else if (action.kind === 'commitAdvance') { commitDraft(fid); advance(fid, decisions) }
  }
  useEffect(() => { const on = (e: KeyboardEvent) => handlerRef.current(e); window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on) }, [])

  const tally = items.reduce((a, it) => { const d = decisions[it.id]; if (d) a[d]++; else a.undecided++; return a }, { go: 0, defer: 0, nogo: 0, undecided: 0 } as Record<string, number>)
  const decided = items.length - tally.undecided

  return (
    <div>
      {wide && <LeftBar items={items} decisions={decisions} resolved={resolved} tally={tally} decided={decided} round={state.round} onJump={jump} onAcceptAll={acceptAll} onRound={setRound} />}
      {/* narrow-screen fallback header (the left bar carries this on wide screens) */}
      {!wide && <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
        <span className="font-semibold text-slate-900">{decided}/{items.length} decided</span>
        <span className="ml-3 text-green-700">● {tally.go}</span><span className="ml-2 text-amber-700">● {tally.defer}</span><span className="ml-2 text-red-600">● {tally.nogo}</span><span className="ml-2 text-slate-400">○ {tally.undecided}</span>
        <button onClick={acceptAll} className="ml-3 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600">Accept recs</button>
      </div>}
      <div className="space-y-4">
        {items.map(it => (
          <ThreadCard
            key={it.id} item={it} decision={decisions[it.id]} comments={replies[it.id] || []} agentReplies={agentReplies[it.id] || []}
            resolved={!!resolved[it.id]} draft={draft[it.id] || ''} focused={focusedId === it.id}
            cardRef={el => { cardRefs.current[it.id] = el }} boxRef={el => { boxRefs.current[it.id] = el }}
            onView={(title, content) => setModal({ title, content })}
            onToggle={d => toggleDecision(it.id, d)} onDraft={v => setDraftFor(it.id, v)} onAdd={() => commitDraft(it.id)}
            onEditComment={(seq, v) => editComment(it.id, seq, v)} onDeleteComment={seq => deleteComment(it.id, seq)}
            onResolve={() => setResolved(it.id, true)} onUnresolve={() => setResolved(it.id, false)} onFocusBox={() => setFocusedId(it.id)}
          />
        ))}
      </div>
      <Modal open={!!modal} title={modal?.title} onClose={() => setModal(null)}>{modal?.content}</Modal>
    </div>
  )
}
