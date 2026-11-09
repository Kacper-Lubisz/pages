import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { Pill } from '@page'

/* ---------- spec ----------------------------------------------------------------------------- */

export type Version = 'before' | 'after'
export type ChangeTag = 'unchanged' | 'new' | 'reworded' | 'notAsked'

export type Exit = { label: string; to: string[] }

export type Side = {
  at: [number, number]
  title: string
  shownWhen: string
  shows: string[]
  exits: Exit[]
  isLogic?: boolean
}

export type FlowBox = { id: string; change: ChangeTag; changeReason: string; before?: Side; after?: Side }

export type Band = { label: string; from: number; to: number; tone: 'new' | 'neutral' | 'changed' }

export type PathStep = string | { id: string; notAsked: string }

export type FlowCase = {
  id: string
  group: string
  label: string
  notes?: { title: string; body: ReactNode }[]
  paths: Record<Version, PathStep[]>
}

export type VideoMark = { box: string; note: string; tMs: number }
export type Recording = { video: string; marks: VideoMark[] }

export type FlowSpec = {
  boxes: FlowBox[]
  bands: Record<Version, Band[]>
  cases: FlowCase[]
  headings: Record<Version, { title: string; note?: string }>
  initialBox?: string
  screen?: (box: FlowBox, version: Version, flowCase: FlowCase) => ReactNode
  recordings?: Record<string, Recording>
}

export const notAsked = (id: string, reason: string) => ({ id, notAsked: reason })

/* ---------- model ---------------------------------------------------------------------------- */

type FlowEdge = { from: string; to: string; labels: string[] }

const toEdgeKey = (from: string, to: string) => `${from}>${to}`

function toEdges(boxes: FlowBox[], version: Version): FlowEdge[] {
  const byKey = new Map<string, FlowEdge>()
  boxes.forEach(box => {
    box[version]?.exits.forEach(exit =>
      exit.to.forEach(to => {
        const key = toEdgeKey(box.id, to)
        byKey.set(key, { from: box.id, to, labels: [...(byKey.get(key)?.labels ?? []), exit.label] })
      }),
    )
  })
  return [...byKey.values()]
}

const NODE_WIDTH_PX = 96
const NODE_HEIGHT_PX = 46
const COLUMN_GAP_PX = 26
const ROW_GAP_PX = 28
const PAD_X_PX = 12
const BAND_LABEL_PX = 20
const LANE_OFFSETS_PX = [-6, -3, 0, 3, 6]

type Rect = { left: number; top: number; right: number; bottom: number; midX: number; midY: number; col: number; row: number }

function toLayout(boxes: FlowBox[], version: Version) {
  const sides = boxes.flatMap(box => (box[version] ? [{ id: box.id, side: box[version] }] : []))
  const rows = sides.map(({ side }) => side.at[1])
  const cols = sides.map(({ side }) => side.at[0])
  const minRow = Math.min(...rows)
  const toX = (col: number) => PAD_X_PX + col * (NODE_WIDTH_PX + COLUMN_GAP_PX)
  const toY = (row: number) => BAND_LABEL_PX + 8 + (row - minRow) * (NODE_HEIGHT_PX + ROW_GAP_PX)
  const rects = new Map<string, Rect>(
    sides.map(({ id, side }) => {
      const [col, row] = side.at
      const left = toX(col)
      const top = toY(row)
      return [id, { left, top, right: left + NODE_WIDTH_PX, bottom: top + NODE_HEIGHT_PX, midX: left + NODE_WIDTH_PX / 2, midY: top + NODE_HEIGHT_PX / 2, col, row }]
    }),
  )
  const width = toX(Math.max(...cols) + 1) - COLUMN_GAP_PX + PAD_X_PX
  const height = toY(Math.max(...rows) + 1) - ROW_GAP_PX + 10
  return { rects, width, height, toX }
}

function toModel(spec: FlowSpec) {
  // A re-record can append marks out of time order; the playhead lookup needs them sorted.
  const recordings: Record<string, Recording> = Object.fromEntries(
    Object.entries(spec.recordings ?? {}).map(([caseId, recording]) => [caseId, { ...recording, marks: [...recording.marks].sort((a, b) => a.tMs - b.tMs) }]),
  )
  return {
    spec,
    recordings,
    boxById: new Map(spec.boxes.map(box => [box.id, box])),
    edges: { before: toEdges(spec.boxes, 'before'), after: toEdges(spec.boxes, 'after') },
    layouts: { before: toLayout(spec.boxes, 'before'), after: toLayout(spec.boxes, 'after') },
    caseGroups: [...new Set(spec.cases.map(flowCase => flowCase.group))],
  }
}

type Model = ReturnType<typeof toModel>

const ModelContext = createContext<Model | null>(null)

function useModel() {
  const model = useContext(ModelContext)
  if (model === null) throw new Error('ScreenFlow parts must render inside <ScreenFlow>')
  return model
}

/* ---------- paths ---------------------------------------------------------------------------- */

type Visit = { orders: number[]; notAsked: string | null }
type PathView = { visits: Map<string, Visit>; edges: Set<string>; missingEdges: string[] }

// A case's path must only move along declared exits; any move that doesn't is listed under the chart, so the
// chart and the cases keep each other honest.
function toPathView(model: Model, steps: PathStep[], version: Version): PathView {
  const normalized = steps.map(step => (typeof step === 'string' ? { id: step, notAsked: null } : step))
  const asked = normalized.filter(step => step.notAsked === null)
  const visits = new Map<string, Visit>(normalized.map(step => [step.id, { orders: [], notAsked: null }]))
  asked.forEach((step, index) => visits.get(step.id)?.orders.push(index + 1))
  normalized.forEach(step => {
    const visit = visits.get(step.id)
    if (step.notAsked !== null && visit && visit.orders.length === 0) visit.notAsked = step.notAsked
  })
  const edgeKeys = asked.slice(1).map((step, index) => toEdgeKey(asked[index].id, step.id))
  const known = new Set(model.edges[version].map(edge => toEdgeKey(edge.from, edge.to)))
  const unplaced = normalized.filter(step => !model.boxById.get(step.id)?.[version]).map(step => `${step.id} (no box)`)
  return { visits, edges: new Set(edgeKeys), missingEdges: [...edgeKeys.filter(key => !known.has(key)), ...unplaced] }
}

const isAskedIn = (view: PathView, id: string) => (view.visits.get(id)?.orders.length ?? 0) > 0

function getChange(box: FlowBox, views: Record<Version, PathView>) {
  const notAskedNow = views.after.visits.get(box.id)?.notAsked
  if (isAskedIn(views.before, box.id) && notAskedNow) return { tag: 'notAsked' as const, reason: `In this case: ${notAskedNow}` }
  return { tag: box.change, reason: box.changeReason }
}

/* ---------- video ---------------------------------------------------------------------------- */

// Seeking lands just after a mark, so the frame shown is the screen the mark names.
const MARK_SEEK_OFFSET_S = 0.05

// Hosts that serve files without byte ranges can't seek into a video that hasn't fully streamed, so each one is
// fetched whole and played from memory. Kept for the page's lifetime, so an object URL is never revoked in use.
const videoObjectUrls = new Map<string, Promise<string>>()

function loadVideoObjectUrl(url: string) {
  const cached = videoObjectUrls.get(url)
  if (cached) return cached
  const loading = fetch(url)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.blob()
    })
    .then(blob => URL.createObjectURL(blob))
  loading.catch(() => videoObjectUrls.delete(url))
  videoObjectUrls.set(url, loading)
  return loading
}

type VideoSource = { status: 'loading' } | { status: 'ready'; objectUrl: string } | { status: 'failed'; message: string }

function useVideoSource(url: string | null) {
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState<{ url: string; source: VideoSource } | null>(null)
  useEffect(() => {
    if (url === null) return
    let isCurrent = true
    loadVideoObjectUrl(url).then(
      objectUrl => isCurrent && setLoaded({ url, source: { status: 'ready', objectUrl } }),
      (error: Error) => isCurrent && setLoaded({ url, source: { status: 'failed', message: error.message } }),
    )
    return () => {
      isCurrent = false
    }
  }, [url, attempt])
  const source: VideoSource = loaded !== null && loaded.url === url ? loaded.source : { status: 'loading' }
  const retry = () => {
    setLoaded(null)
    setAttempt(count => count + 1)
  }
  return { source, retry }
}

type Player = {
  recording: Recording | null
  markIndex: number | null
  source: VideoSource
  isReady: boolean
  retryLoad: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  syncToTime: () => void
  handleLoadedData: () => void
  jumpToMark: (index: number) => void
  stepMark: (direction: 1 | -1) => void
  isVideoPlaying: () => boolean
}

function findMarkIndexAt(marks: VideoMark[], timeMs: number) {
  const index = marks.findLastIndex(mark => mark.tMs <= timeMs)
  return index === -1 ? null : index
}

// The video drives the chart: the latest mark at or before the playhead picks the box.
function useCasePlayer({ recording, caseId, onMarkBox }: { recording: Recording | null; caseId: string; onMarkBox: (boxId: string) => void }): Player {
  const { source, retry } = useVideoSource(recording === null ? null : recording.video)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [shownMark, setShownMark] = useState<{ caseId: string; index: number } | null>(null)
  const [readyCaseId, setReadyCaseId] = useState<string | null>(null)
  // Derived per case, so the render that switches case never reads the previous case's mark from this recording.
  const markIndex = shownMark !== null && shownMark.caseId === caseId && recording !== null && shownMark.index < recording.marks.length ? shownMark.index : null
  const isReady = readyCaseId === caseId && source.status === 'ready'
  const shownIndex = useRef<number | null>(null)
  const pendingSeekS = useRef<number | null>(null)
  useEffect(() => {
    shownIndex.current = null
    pendingSeekS.current = null
    setShownMark(null)
    setReadyCaseId(null)
  }, [caseId])
  const showMark = (index: number | null) => {
    if (index === shownIndex.current) return
    shownIndex.current = index
    setShownMark(index === null ? null : { caseId, index })
    if (index !== null && recording) onMarkBox(recording.marks[index].box)
  }
  const syncToTime = () => {
    const video = videoRef.current
    if (!video || !recording || pendingSeekS.current !== null) return
    showMark(findMarkIndexAt(recording.marks, video.currentTime * 1000))
  }
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0
    const tick = () => {
      syncToTime()
      frame = requestAnimationFrame(tick)
    }
    const start = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(tick)
    }
    const stop = () => cancelAnimationFrame(frame)
    video.addEventListener('play', start)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    if (!video.paused) start()
    return () => {
      stop()
      video.removeEventListener('play', start)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
    }
  })
  const handleLoadedData = () => {
    const video = videoRef.current
    if (!video) return
    if (pendingSeekS.current !== null) video.currentTime = pendingSeekS.current
    pendingSeekS.current = null
    setReadyCaseId(caseId)
  }
  // A box clicked before the video has loaded moves the chart now and the video once it can.
  const jumpToMark = (index: number) => {
    if (!recording || recording.marks.length === 0) return
    const clamped = Math.min(recording.marks.length - 1, Math.max(0, index))
    const seconds = recording.marks[clamped].tMs / 1000 + MARK_SEEK_OFFSET_S
    const video = videoRef.current
    if (video && isReady) {
      video.pause()
      video.currentTime = seconds
    } else {
      pendingSeekS.current = seconds
    }
    showMark(clamped)
    // showMark skips the mark already shown, but the reader may have selected another box since.
    onMarkBox(recording.marks[clamped].box)
  }
  const stepMark = (direction: 1 | -1) => {
    if (!isReady) return
    jumpToMark(markIndex === null ? 0 : markIndex + direction)
  }
  const isVideoPlaying = useCallback(() => videoRef.current !== null && !videoRef.current.paused, [])
  return { recording, markIndex, source, isReady, retryLoad: retry, videoRef, syncToTime, handleLoadedData, jumpToMark, stepMark, isVideoPlaying }
}

/* ---------- diagram -------------------------------------------------------------------------- */

function toPolyline(points: [number, number][]) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ')
}

function toEdgePath(from: Rect, to: Rect, laneIndex: number) {
  const lane = LANE_OFFSETS_PX[laneIndex % LANE_OFFSETS_PX.length]
  if (from.row === to.row && to.col > from.col) return toPolyline([[from.right, from.midY], [to.left - 2, to.midY]])
  if (from.row === to.row) {
    const gutterY = from.bottom + ROW_GAP_PX / 2 + lane
    return toPolyline([[from.midX + lane, from.bottom], [from.midX + lane, gutterY], [to.midX + lane, gutterY], [to.midX + lane, to.bottom + 2]])
  }
  if (from.col === to.col && Math.abs(from.row - to.row) === 1) {
    const shift = to.row > from.row ? 6 : -6
    return to.row > from.row
      ? toPolyline([[from.midX + shift, from.bottom], [to.midX + shift, to.top - 2]])
      : toPolyline([[from.midX + shift, from.top], [to.midX + shift, to.bottom + 2]])
  }
  const isRight = to.col >= from.col
  const exitX = isRight ? from.right : from.left
  const gutterX = isRight ? from.right + COLUMN_GAP_PX / 2 + lane : from.left - COLUMN_GAP_PX / 2 + lane
  const isTargetAbove = to.row < from.row
  const gutterY = isTargetAbove ? to.bottom + ROW_GAP_PX / 2 + lane : to.top - ROW_GAP_PX / 2 + lane
  const entryY = isTargetAbove ? to.bottom + 2 : to.top - 2
  return toPolyline([[exitX, from.midY], [gutterX, from.midY], [gutterX, gutterY], [to.midX + lane, gutterY], [to.midX + lane, entryY]])
}

const isStructuralEdge = (from: Rect, to: Rect) =>
  (from.row === to.row && to.col === from.col + 1) || (from.col === to.col && Math.abs(from.row - to.row) === 1)

const COLOURS = { path: '#2563eb', faint: '#cbd5e1', touch: '#64748b' }

const BAND_TONES: Record<Band['tone'], string> = {
  new: 'bg-blue-50/70 border-blue-200 text-blue-700',
  neutral: 'bg-slate-100/60 border-slate-200 text-slate-500',
  changed: 'bg-amber-50/60 border-amber-200 text-amber-700',
}

const prefersReducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

const DiagramBox = memo(function DiagramBox({ box, side, rect, view, isSelected, isPlaying, onSelect }: { box: FlowBox; side: Side; rect: Rect; view: PathView; isSelected: boolean; isPlaying: boolean; onSelect: (id: string) => void }) {
  const visit = view.visits.get(box.id)
  const isAsked = (visit?.orders.length ?? 0) > 0
  const isNotAsked = !isAsked && visit?.notAsked != null
  const tone = isAsked
    ? 'border-blue-600 bg-blue-50 text-blue-950'
    : isNotAsked
      ? 'border-dashed border-amber-500 bg-amber-50 text-amber-900'
      : `${side.isLogic ? 'border-dashed border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'} text-slate-400`
  const emphasis = isPlaying ? 'ring-[3px] ring-blue-500 ring-offset-2' : isSelected ? 'ring-2 ring-slate-900 ring-offset-1' : ''
  return (
    <button
      type="button"
      data-box-id={box.id}
      aria-pressed={isSelected}
      aria-current={isPlaying ? 'step' : undefined}
      onClick={() => onSelect(box.id)}
      style={{ left: rect.left, top: rect.top, width: NODE_WIDTH_PX, height: NODE_HEIGHT_PX }}
      className={`absolute z-10 flex flex-col items-start overflow-hidden rounded-lg border px-1.5 py-1 text-left text-[10.5px] leading-tight shadow-sm hover:shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 motion-safe:transition-shadow ${tone} ${emphasis}`}
    >
      <span className="flex items-center gap-1 font-mono text-[9px] font-bold">
        <span className="opacity-60">{box.id}</span>
        {isNotAsked && <span className="rounded bg-amber-200/70 px-1 font-sans uppercase tracking-wide text-amber-900">not asked</span>}
      </span>
      <span className="line-clamp-2 font-medium">{side.title}</span>
      {isAsked && (
        <span className="absolute right-0.5 top-0.5 rounded-full bg-blue-600 px-1.5 text-[9px] font-bold leading-4 text-white">{visit?.orders.join(', ')}</span>
      )}
    </button>
  )
})

// Keeps the box the video is on in view inside the diagram's own horizontal scroll. A smooth scroll would fight
// the playhead moving the ring on, so it jumps while the video plays.
function useScrollToBox(scrollRef: RefObject<HTMLDivElement | null>, boxId: string | null, isVideoPlaying: () => boolean) {
  useEffect(() => {
    const container = scrollRef.current
    const target = boxId === null ? null : container?.querySelector<HTMLElement>(`[data-box-id="${boxId}"]`)
    if (!container || !target) return
    const left = target.offsetLeft
    const isVisible = left >= container.scrollLeft && left + target.offsetWidth <= container.scrollLeft + container.clientWidth
    if (isVisible) return
    const behavior = prefersReducedMotion() || isVideoPlaying() ? 'auto' : 'smooth'
    container.scrollTo({ left: Math.max(0, left - container.clientWidth / 2 + target.offsetWidth / 2), behavior })
  }, [scrollRef, boxId, isVideoPlaying])
}

type DiagramProps = {
  version: Version
  view: PathView
  selectedId: string
  playingId: string | null
  onSelect: (id: string) => void
  isVideoPlaying: () => boolean
}

const Diagram = memo(function Diagram({ version, view, selectedId, playingId, onSelect, isVideoPlaying }: DiagramProps) {
  const model = useModel()
  const layout = model.layouts[version]
  const heading = model.spec.headings[version]
  const scrollRef = useRef<HTMLDivElement>(null)
  useScrollToBox(scrollRef, playingId, isVideoPlaying)
  const edges = useMemo(() => model.edges[version]
    .map((edge, index) => {
      const from = layout.rects.get(edge.from)
      const to = layout.rects.get(edge.to)
      if (!from || !to) return null
      const isOnPath = view.edges.has(toEdgeKey(edge.from, edge.to))
      const touchesSelection = edge.from === selectedId
      if (!isOnPath && !touchesSelection && !isStructuralEdge(from, to)) return null
      const colour = isOnPath ? COLOURS.path : touchesSelection ? COLOURS.touch : COLOURS.faint
      return { ...edge, d: toEdgePath(from, to, index), colour, isOnPath, touchesSelection }
    })
    .filter(edge => edge !== null)
    .sort((a, b) => Number(a.isOnPath) - Number(b.isOnPath)), [model, version, layout, view, selectedId])
  return (
    <div className="mb-3 min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[12px] font-bold uppercase tracking-wider text-slate-700">{heading.title}</span>
        {heading.note && <span className="text-[12px] text-slate-500">{heading.note}</span>}
      </div>
      <div ref={scrollRef} className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div className="relative" style={{ width: layout.width, height: layout.height }}>
          {model.spec.bands[version].map(band => (
            <div
              key={band.label}
              style={{ left: layout.toX(band.from) - COLUMN_GAP_PX / 2 + 3, width: layout.toX(band.to + 1) - layout.toX(band.from) - 6, top: 4, bottom: 4 }}
              className={`absolute rounded-lg border border-dashed px-2 pt-0.5 text-[9.5px] font-bold uppercase tracking-wider ${BAND_TONES[band.tone]}`}
            >
              {band.label}
            </div>
          ))}
          <svg className="pointer-events-none absolute left-0 top-0 z-0" width={layout.width} height={layout.height} aria-hidden>
            <defs>
              {Object.entries(COLOURS).map(([name, colour]) => (
                <marker key={name} id={`arrow-${version}-${name}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill={colour} />
                </marker>
              ))}
            </defs>
            {edges.map(edge => (
              <path
                key={`${edge.from}-${edge.to}`}
                d={edge.d}
                fill="none"
                stroke={edge.colour}
                strokeWidth={edge.isOnPath ? 2 : 1.2}
                strokeLinejoin="round"
                markerEnd={`url(#arrow-${version}-${Object.entries(COLOURS).find(([, colour]) => colour === edge.colour)?.[0]})`}
              />
            ))}
          </svg>
          {model.spec.boxes.map(box => {
            const side = box[version]
            const rect = layout.rects.get(box.id)
            if (!side || !rect) return null
            return (
              <DiagramBox
                key={box.id}
                box={box}
                side={side}
                rect={rect}
                view={view}
                isSelected={box.id === selectedId}
                isPlaying={version === 'after' && box.id === playingId}
                onSelect={onSelect}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
})

/* ---------- controls and case card ----------------------------------------------------------- */

function CasePicker({ caseId, onPick, onPreview }: { caseId: string; onPick: (id: string) => void; onPreview: (id: string) => void }) {
  const model = useModel()
  return (
    <div className="mb-3 grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-[136px_1fr]">
      {model.caseGroups.map(group => (
        <div key={group} className="contents">
          <div className="pt-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{group}</div>
          <div className="flex flex-wrap gap-1.5">
            {model.spec.cases.filter(flowCase => flowCase.group === group).map(flowCase => (
              <button
                key={flowCase.id}
                type="button"
                data-case-id={flowCase.id}
                aria-pressed={flowCase.id === caseId}
                onClick={() => onPick(flowCase.id)}
                onPointerEnter={() => onPreview(flowCase.id)}
                onFocus={() => onPreview(flowCase.id)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  flowCase.id === caseId ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
                }`}
              >
                {flowCase.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// Every case's card sits in the same grid cell, so the cell is as tall as the longest and switching never moves the chart.
const CaseCard = memo(function CaseCard({ caseId }: { caseId: string }) {
  const model = useModel()
  if (!model.spec.cases.some(flowCase => flowCase.notes?.length)) return null
  return (
    <div className="mb-3 grid">
      {model.spec.cases.map(candidate => (
        <div
          key={candidate.id}
          aria-hidden={candidate.id !== caseId}
          style={{ gridArea: '1 / 1', visibility: candidate.id === caseId ? 'visible' : 'hidden' }}
          className="grid"
        >
          <div className="grid gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 md:grid-flow-col md:auto-cols-fr">
            {candidate.notes?.map(note => (
              <div key={note.title} className="min-w-0">
                <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{note.title}</div>
                <div className="text-[12.5px] leading-snug text-slate-800">{note.body}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})

/* ---------- case video ----------------------------------------------------------------------- */

const formatSeconds = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`

function VideoLoadState({ source, onRetry }: { source: VideoSource; onRetry: () => void }) {
  if (source.status === 'failed') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-slate-600">
        <span>The recording didn’t load ({source.message}).</span>
        <button type="button" onClick={onRetry} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-semibold text-slate-700 hover:border-blue-400">
          Try again
        </button>
      </div>
    )
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-slate-500" role="status">
      <span className="size-5 rounded-full border-2 border-slate-300 border-t-blue-600 motion-safe:animate-spin" aria-hidden />
      Loading the recording…
    </div>
  )
}

function CaseVideo({ player, flowCase }: { player: Player; flowCase: FlowCase }) {
  const model = useModel()
  const toMarkTitle = (boxId: string) => model.boxById.get(boxId)?.after?.title ?? 'Not on the chart'
  const { recording, markIndex, source, isReady } = player
  if (!recording) {
    return (
      <div className="flex aspect-[390/844] w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[12px] text-slate-500">
        No recording for this case yet.
      </div>
    )
  }
  const mark = markIndex === null ? null : recording.marks[markIndex]
  const lastIndex = recording.marks.length - 1
  const controlClass =
    'flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[12px] font-semibold text-slate-700 hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-40'
  return (
    <div className="flex flex-col gap-2">
      <div className="relative aspect-[390/844] w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
        {source.status === 'ready' && (
          <video
            key={flowCase.id}
            ref={player.videoRef}
            src={source.objectUrl}
            controls
            muted
            playsInline
            preload="auto"
            aria-label={`Recording: ${flowCase.label}`}
            onLoadedData={player.handleLoadedData}
            onSeeked={player.syncToTime}
            onTimeUpdate={player.syncToTime}
            className="absolute inset-0 h-full w-full"
          />
        )}
        {!isReady && <VideoLoadState source={source} onRetry={player.retryLoad} />}
      </div>
      <div className="flex gap-2">
        <button type="button" className={controlClass} disabled={!isReady || markIndex === null || markIndex === 0} onClick={() => player.stepMark(-1)}>
          ← Back
        </button>
        <button type="button" className={controlClass} disabled={!isReady || lastIndex < 0 || markIndex === lastIndex} onClick={() => player.stepMark(1)}>
          Next →
        </button>
      </div>
      <div className="h-16 overflow-y-auto text-[11.5px] leading-snug text-slate-600" aria-live="polite">
        {mark === null ? (
          <span>{recording.marks.length} marks · Next steps through them; ← and → work too.</span>
        ) : (
          <>
            <span className="font-semibold text-slate-800">
              {(markIndex ?? 0) + 1}/{recording.marks.length} · <span className="font-mono">{mark.box}</span> {toMarkTitle(mark.box)}
            </span>
            {mark.note && <span className="block">{mark.note}</span>}
          </>
        )}
      </div>
      <ol className="m-0 max-h-48 list-none overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 text-[11px]">
        {recording.marks.map((item, index) => (
          <li key={index}>
            <button
              type="button"
              aria-current={index === markIndex ? 'step' : undefined}
              onClick={() => player.jumpToMark(index)}
              className={`flex w-full items-baseline gap-1.5 rounded px-1.5 py-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600 ${index === markIndex ? 'bg-blue-50 text-blue-950' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="w-8 shrink-0 font-mono text-slate-400">{formatSeconds(item.tMs)}</span>
              <span className="w-7 shrink-0 font-mono font-semibold">{item.box}</span>
              <span className="truncate">{toMarkTitle(item.box)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ---------- detail panel --------------------------------------------------------------------- */

const CHANGE_PILL: Record<ChangeTag, { tone: 'neutral' | 'warn' | 'primary' | 'bad'; label: string }> = {
  unchanged: { tone: 'neutral', label: 'unchanged' },
  new: { tone: 'primary', label: 'new' },
  reworded: { tone: 'warn', label: 'reworded' },
  notAsked: { tone: 'bad', label: 'not asked now' },
}

const SHOT_WIDTH_PX = 150

function ShotFigure({ box, version, flowCase }: { box: FlowBox; version: Version; flowCase: FlowCase }) {
  const model = useModel()
  const screen = model.spec.screen?.(box, version, flowCase) ?? null
  return (
    <figure className="m-0 shrink-0" style={{ width: SHOT_WIDTH_PX }}>
      {screen ?? (
        <div className="flex aspect-[390/844] w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-[11.5px] text-slate-500">
          {box[version]?.isLogic ? 'Not a screen.' : 'No screenshot yet.'}
        </div>
      )}
    </figure>
  )
}

function SideDetail({ box, version, flowCase, view, onSelect }: { box: FlowBox; version: Version; flowCase: FlowCase; view: PathView; onSelect: (id: string) => void }) {
  const model = useModel()
  const side = box[version]
  const heading = model.spec.headings[version].title
  if (!side) {
    return (
      <div className="min-w-0">
        <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{heading}</div>
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-[13px] text-slate-500">{version === 'before' ? 'Not in the old flow.' : 'Not asked any more.'}</div>
      </div>
    )
  }
  const visit = view.visits.get(box.id)
  const position = (visit?.orders.length ?? 0) > 0 ? `step ${visit?.orders.join(' and ')}` : visit?.notAsked ? `not asked (${visit.notAsked})` : 'not on this path'
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{heading}</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <ShotFigure box={box} version={version} flowCase={flowCase} />
        <div className="min-w-0 text-[12.5px] leading-relaxed">
          <div className="text-[14px] font-semibold text-slate-900">{side.title}</div>
          <div className={`mb-1.5 ${(visit?.orders.length ?? 0) > 0 ? 'font-medium text-blue-700' : 'text-slate-500'}`}>
            {flowCase.label}: {position}
          </div>
          <div className="mb-1.5 text-slate-600">{side.shownWhen}</div>
          <ul className="mb-1.5 list-disc space-y-0.5 pl-4 text-slate-800">
            {side.shows.map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Ways out</div>
          <ul className="m-0 list-none p-0">
            {side.exits.map(exit => (
              <li key={exit.label} className="border-t border-slate-100 py-1 first:border-t-0">
                <span className="text-slate-700">{exit.label}</span>
                <span className="ml-1 inline-flex flex-wrap gap-1">
                  {exit.to.length === 0 && <span className="text-[11px] text-slate-400">leaves the map</span>}
                  {exit.to.map(target => (
                    <button
                      key={target}
                      type="button"
                      onClick={() => onSelect(target)}
                      className="rounded border border-blue-200 bg-blue-50 px-1 py-px text-[10.5px] font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      → <span className="font-mono">{target}</span> {model.boxById.get(target)?.[version]?.title}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

// The panel keeps the tallest height it has had at this width, so a shorter box never pulls the page up under the reader.
function useTallestHeight(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const node = ref.current
    if (!node) return
    let widthPx = node.clientWidth
    let tallestPx = 0
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== widthPx) {
        widthPx = node.clientWidth
        tallestPx = 0
        node.style.minHeight = ''
      }
      tallestPx = Math.max(tallestPx, node.offsetHeight)
      node.style.minHeight = `${tallestPx}px`
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
}

function BoxDetail({ box, flowCase, views, onSelect }: { box: FlowBox; flowCase: FlowCase; views: Record<Version, PathView>; onSelect: (id: string) => void }) {
  const change = getChange(box, views)
  const panelRef = useRef<HTMLDivElement>(null)
  useTallestHeight(panelRef)
  return (
    <div ref={panelRef} className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-900 px-1.5 py-px font-mono text-[11px] font-semibold text-white">{box.id}</span>
        <span className="text-[16px] font-semibold text-slate-900">{(box.after ?? box.before)?.title}</span>
        <Pill tone={CHANGE_PILL[change.tag].tone}>{CHANGE_PILL[change.tag].label}</Pill>
        <span className="text-[13px] text-slate-600">{change.reason}</span>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <SideDetail box={box} version="before" flowCase={flowCase} view={views.before} onSelect={onSelect} />
        <SideDetail box={box} version="after" flowCase={flowCase} view={views.after} onSelect={onSelect} />
      </div>
    </div>
  )
}

/* ---------- explorer ------------------------------------------------------------------------- */

function Legend({ hasRecordings }: { hasRecordings: boolean }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded border border-blue-600 bg-blue-50" /> this case’s path; the number is the order they meet it
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded border border-dashed border-amber-500 bg-amber-50" /> on the path but not asked
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded border border-slate-200 bg-white" /> not on this path
      </span>
      {hasRecordings && (
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded ring-2 ring-blue-500 ring-offset-1" /> where the video is
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 bg-slate-500" /> the selected box’s ways out
      </span>
      <span>Click a box for its ways out and screens{hasRecordings ? '; a box on the path also moves the video there' : ''}.</span>
    </div>
  )
}

// Clicking a box the video passes through again moves on to its next visit.
function findBoxMarkIndex(recording: Recording | null, boxId: string, currentIndex: number | null) {
  if (!recording) return null
  const indices = recording.marks.flatMap((mark, index) => (mark.box === boxId ? [index] : []))
  if (indices.length === 0) return null
  if (currentIndex === null || !indices.includes(currentIndex)) return indices[0]
  return indices.find(index => index > currentIndex) ?? indices[0]
}

const isTypingTarget = (target: EventTarget) => target instanceof HTMLElement && (target.tagName === 'VIDEO' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

export function ScreenFlow({ spec }: { spec: FlowSpec }) {
  const model = useMemo(() => toModel(spec), [spec])
  const [caseId, setCaseId] = useState(spec.cases[0].id)
  const [selectedId, setSelectedId] = useState(spec.initialBox ?? spec.boxes[0].id)
  const flowCase = spec.cases.find(candidate => candidate.id === caseId) ?? spec.cases[0]
  // A mark on a box the chart doesn't have keeps the current selection rather than falling back to the first box.
  const selectMarkBox = (id: string) => {
    if (model.boxById.has(id)) setSelectedId(id)
  }
  const player = useCasePlayer({ recording: model.recordings[flowCase.id] ?? null, caseId: flowCase.id, onMarkBox: selectMarkBox })
  const views = useMemo<Record<Version, PathView>>(
    () => ({ before: toPathView(model, flowCase.paths.before, 'before'), after: toPathView(model, flowCase.paths.after, 'after') }),
    [model, flowCase],
  )
  const missingEdges = [...views.before.missingEdges.map(key => `before ${key}`), ...views.after.missingEdges.map(key => `after ${key}`)]
  const selected = model.boxById.get(selectedId) ?? spec.boxes[0]
  const mark = player.markIndex === null ? null : (player.recording?.marks[player.markIndex] ?? null)
  const selectBox = (id: string) => {
    const index = findBoxMarkIndex(player.recording, id, player.markIndex)
    if (index === null) {
      setSelectedId(id)
      return
    }
    player.jumpToMark(index)
  }
  const latestSelectBox = useRef(selectBox)
  latestSelectBox.current = selectBox
  const onSelect = useCallback((id: string) => latestSelectBox.current(id), [])
  const pickCase = (id: string) => {
    setCaseId(id)
    const firstBox = model.recordings[id]?.marks[0]?.box
    if (firstBox) selectMarkBox(firstBox)
  }
  const previewCase = (id: string) => {
    const recording = model.recordings[id]
    // A failed preview is dropped from the cache and retried, with its error shown, once the case is picked.
    if (recording) loadVideoObjectUrl(recording.video).catch(() => {})
  }
  const hasRecordings = Object.keys(model.recordings).length > 0
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!player.recording || isTypingTarget(event.target)) return
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        player.stepMark(1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        player.stepMark(-1)
        return
    }
  }
  return (
    <ModelContext.Provider value={model}>
      <div onKeyDown={handleKeyDown} data-flow-explorer="">
        <CasePicker caseId={flowCase.id} onPick={pickCase} onPreview={previewCase} />
        <CaseCard caseId={flowCase.id} />
        <Legend hasRecordings={hasRecordings} />
        <div className={`grid gap-4 ${hasRecordings ? 'lg:grid-cols-[minmax(0,1fr)_248px]' : ''}`}>
          <div className="min-w-0">
            <Diagram version="before" view={views.before} selectedId={selected.id} playingId={null} onSelect={onSelect} isVideoPlaying={player.isVideoPlaying} />
            <Diagram version="after" view={views.after} selectedId={selected.id} playingId={mark?.box ?? null} onSelect={onSelect} isVideoPlaying={player.isVideoPlaying} />
            {missingEdges.length > 0 && <div className="mb-2 text-[12px] font-medium text-red-700">Path moves with no matching way out: {missingEdges.join(', ')}</div>}
          </div>
          {hasRecordings && (
            <div className="mx-auto w-full max-w-[280px] lg:sticky lg:top-4 lg:mx-0 lg:self-start">
              <div className="mb-1 text-[12px] font-bold uppercase tracking-wider text-slate-700">This case, recorded</div>
              <CaseVideo player={player} flowCase={flowCase} />
            </div>
          )}
        </div>
        <BoxDetail box={selected} flowCase={flowCase} views={views} onSelect={selectBox} />
      </div>
    </ModelContext.Provider>
  )
}
