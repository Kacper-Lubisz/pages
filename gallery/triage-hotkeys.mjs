/* Pure, DOM-free keyboard logic for the triage board — kept separate so it can be unit-tested with
   `node --test triage-hotkeys.test.mjs` and imported by triage-obs-jul09.page.tsx. Nothing here
   touches the DOM: the page turns a real KeyboardEvent into a plain `ev` descriptor, calls
   resolveAction(), and performs the returned action (set decision / move focus / focus box).

   Three schemes so the reviewer can try each and pick one:
     • vim    — single letter keys decide from the board (g/d/x), j/k move. Classic.
     • field  — you stay in the comment box; modifier+Enter decides & advances without leaving it.
     • number — 1/2/3 decide, Space accepts the recommendation. One-handed.

   Every "decide" action carries the intent: set the decision, then advance to the next UNDECIDED
   item and focus its comment box (the behaviour the reviewer asked for). */

/** @typedef {'go'|'defer'|'nogo'} Decision */
/** @typedef {{key:string, meta?:boolean, ctrl?:boolean, shift?:boolean, alt?:boolean, inField?:boolean}} Ev */
/** @typedef {{kind:'decide', decision:Decision}
 *          | {kind:'move', dir:1|-1}
 *          | {kind:'focus'}
 *          | {kind:'blur'}
 *          | {kind:'accept'}       // accept the focused item's recommendation, then advance
 *          | {kind:'acceptAll'}
 *          | null} Action */

export const SCHEMES = [
  {
    id: 'vim',
    name: 'Vim keys',
    blurb: 'Single letters decide from the board; j/k move. Fast once learnt, but you decide from outside the comment box.',
    keys: [
      ['g / d / x', 'Go / Defer / No-go — then jump to the next undecided & focus its box'],
      ['j / k · ↓ / ↑', 'move focus down / up'],
      ['e', 'focus the comment box'],
      ['a', 'accept all recommendations'],
      ['⌘/Ctrl+↵ (in box)', 'commit the comment & advance'],
      ['Esc', 'leave the comment box'],
    ],
  },
  {
    id: 'field',
    name: 'Comment-first',
    blurb: 'Stay in the comment box the whole time; modifier+Enter decides and moves you to the next box. Never leave the keyboard.',
    keys: [
      ['⌘/Ctrl+↵', 'Go & next'],
      ['⌘/Ctrl+⇧+↵', 'No-go & next'],
      ['Alt+↵', 'Defer & next'],
      ['⌘/Ctrl+↑ / ↓', 'move without deciding'],
      ['Esc', 'drop out of the box to the board'],
    ],
  },
  {
    id: 'number',
    name: 'Number keys',
    blurb: 'One hand on the number row: 1/2/3 decide, Space takes the recommendation. Decide from the board.',
    keys: [
      ['1 / 2 / 3', 'Go / Defer / No-go — then advance & focus the next box'],
      ['Space', 'accept the recommendation & advance'],
      ['↓ / ↑', 'move focus'],
      ['↵', 'focus the comment box'],
      ['a', 'accept all recommendations'],
    ],
  },
]

export const SCHEME_IDS = SCHEMES.map(s => s.id)
const DECIDE = { g: 'go', d: 'defer', x: 'nogo' }
const NUM = { 1: 'go', 2: 'defer', 3: 'nogo' }

/** Resolve a key event to an action for a given scheme. DOM-free & pure.
 * @param {string} schemeId @param {Ev} ev @returns {Action} */
export function resolveAction(schemeId, ev) {
  const k = (ev.key || '').toLowerCase()
  const mod = !!(ev.meta || ev.ctrl)
  const inField = !!ev.inField

  // Escape always leaves the field (handled the same in every scheme).
  if (ev.key === 'Escape') return inField ? { kind: 'blur' } : null

  if (schemeId === 'field') {
    // Everything is driven from inside the comment box via Enter + modifiers.
    if (ev.key === 'Enter' || k === 'enter') {
      if (mod && ev.shift) return { kind: 'decide', decision: 'nogo' }
      if (mod) return { kind: 'decide', decision: 'go' }
      if (ev.alt) return { kind: 'decide', decision: 'defer' }
      return null // a bare Enter in the box is a newline
    }
    if (mod && (ev.key === 'ArrowDown' || k === 'arrowdown')) return { kind: 'move', dir: 1 }
    if (mod && (ev.key === 'ArrowUp' || k === 'arrowup')) return { kind: 'move', dir: -1 }
    return null
  }

  // vim + number are board-driven. While typing in a field, the ONLY combo that acts is
  // ⌘/Ctrl+Enter (commit the comment + advance) — everything else (arrows, letters) is left to
  // the textarea so the cursor and normal typing work.
  if (inField) {
    if (mod && (ev.key === 'Enter' || k === 'enter')) return { kind: 'commitAdvance' }
    return null
  }

  // Not typing: arrows move focus on the board.
  if (ev.key === 'ArrowDown') return { kind: 'move', dir: 1 }
  if (ev.key === 'ArrowUp') return { kind: 'move', dir: -1 }

  if (mod || ev.alt) return null // leave browser shortcuts alone on the board

  if (schemeId === 'vim') {
    if (k in DECIDE) return { kind: 'decide', decision: DECIDE[k] }
    if (k === 'j') return { kind: 'move', dir: 1 }
    if (k === 'k') return { kind: 'move', dir: -1 }
    if (k === 'e') return { kind: 'focus' }
    if (k === 'a') return { kind: 'acceptAll' }
    return null
  }

  if (schemeId === 'number') {
    if (k in NUM) return { kind: 'decide', decision: NUM[k] }
    if (ev.key === ' ' || k === 'spacebar' || k === ' ') return { kind: 'accept' }
    if (ev.key === 'Enter' || k === 'enter') return { kind: 'focus' }
    if (k === 'a') return { kind: 'acceptAll' }
    return null
  }

  return null
}

/** Next item id AFTER `currentId` that has no decision yet, wrapping once. null if all decided.
 * @param {string[]} ids @param {Record<string,Decision|undefined>} decisions @param {string|null} currentId */
export function nextUndecided(ids, decisions, currentId) {
  if (!ids.length) return null
  const start = currentId == null ? -1 : ids.indexOf(currentId)
  for (let i = 1; i <= ids.length; i++) {
    const id = ids[(((start + i) % ids.length) + ids.length) % ids.length]
    if (id !== currentId && !decisions[id]) return id
  }
  // current might be the only undecided, or everything's decided
  if (currentId != null && !decisions[currentId]) return null
  return null
}

/** Neighbour in visual order, clamped (no wrap) — for plain up/down movement.
 * @param {string[]} ids @param {string|null} currentId @param {1|-1} dir */
export function neighbor(ids, currentId, dir) {
  if (!ids.length) return null
  const cur = currentId == null ? (dir > 0 ? -1 : ids.length) : ids.indexOf(currentId)
  const next = Math.max(0, Math.min(ids.length - 1, cur + dir))
  return ids[next]
}
