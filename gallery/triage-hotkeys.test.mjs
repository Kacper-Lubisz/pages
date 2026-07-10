/* Tests for the pure triage keyboard logic. Run: node --test notes/pages/triage-hotkeys.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAction, nextUndecided, neighbor, SCHEMES, SCHEME_IDS } from './triage-hotkeys.mjs'

test('schemes are well-formed', () => {
  assert.equal(SCHEMES.length, 3)
  assert.deepEqual(SCHEME_IDS, ['vim', 'field', 'number'])
  for (const s of SCHEMES) {
    assert.ok(s.id && s.name && s.blurb, `${s.id} has id/name/blurb`)
    assert.ok(Array.isArray(s.keys) && s.keys.length, `${s.id} lists keys`)
  }
})

test('vim: g/d/x decide from the board', () => {
  assert.deepEqual(resolveAction('vim', { key: 'g' }), { kind: 'decide', decision: 'go' })
  assert.deepEqual(resolveAction('vim', { key: 'd' }), { kind: 'decide', decision: 'defer' })
  assert.deepEqual(resolveAction('vim', { key: 'x' }), { kind: 'decide', decision: 'nogo' })
  assert.deepEqual(resolveAction('vim', { key: 'j' }), { kind: 'move', dir: 1 })
  assert.deepEqual(resolveAction('vim', { key: 'k' }), { kind: 'move', dir: -1 })
  assert.deepEqual(resolveAction('vim', { key: 'e' }), { kind: 'focus' })
  assert.deepEqual(resolveAction('vim', { key: 'a' }), { kind: 'acceptAll' })
})

test('vim: single letters do NOTHING while typing in the comment box', () => {
  assert.equal(resolveAction('vim', { key: 'g', inField: true }), null)
  assert.equal(resolveAction('vim', { key: 'x', inField: true }), null)
  // …but ⌘/Ctrl+Enter still commits + advances from inside the box
  assert.deepEqual(resolveAction('vim', { key: 'Enter', meta: true, inField: true }), { kind: 'commitAdvance' })
})

test('number: 1/2/3 decide, Space accepts the recommendation, Enter focuses the box', () => {
  assert.deepEqual(resolveAction('number', { key: '1' }), { kind: 'decide', decision: 'go' })
  assert.deepEqual(resolveAction('number', { key: '2' }), { kind: 'decide', decision: 'defer' })
  assert.deepEqual(resolveAction('number', { key: '3' }), { kind: 'decide', decision: 'nogo' })
  assert.deepEqual(resolveAction('number', { key: ' ' }), { kind: 'accept' })
  assert.deepEqual(resolveAction('number', { key: 'Enter' }), { kind: 'focus' })
  assert.equal(resolveAction('number', { key: '1', inField: true }), null)
})

test('field: you decide from INSIDE the box with modifier+Enter', () => {
  const inField = true
  assert.deepEqual(resolveAction('field', { key: 'Enter', meta: true, inField }), { kind: 'decide', decision: 'go' })
  assert.deepEqual(resolveAction('field', { key: 'Enter', ctrl: true, inField }), { kind: 'decide', decision: 'go' })
  assert.deepEqual(resolveAction('field', { key: 'Enter', meta: true, shift: true, inField }), { kind: 'decide', decision: 'nogo' })
  assert.deepEqual(resolveAction('field', { key: 'Enter', alt: true, inField }), { kind: 'decide', decision: 'defer' })
  // a bare Enter in the box is a newline, not a decision
  assert.equal(resolveAction('field', { key: 'Enter', inField }), null)
  // move without deciding
  assert.deepEqual(resolveAction('field', { key: 'ArrowDown', meta: true, inField }), { kind: 'move', dir: 1 })
})

test('Escape leaves the field in every scheme', () => {
  for (const id of SCHEME_IDS) {
    assert.deepEqual(resolveAction(id, { key: 'Escape', inField: true }), { kind: 'blur' })
    assert.equal(resolveAction(id, { key: 'Escape', inField: false }), null)
  }
})

test('arrow keys move focus on the board in the board schemes', () => {
  for (const id of ['vim', 'number']) {
    assert.deepEqual(resolveAction(id, { key: 'ArrowDown' }), { kind: 'move', dir: 1 })
    assert.deepEqual(resolveAction(id, { key: 'ArrowUp' }), { kind: 'move', dir: -1 })
    // …but arrows while typing belong to the textarea cursor, not the board
    assert.equal(resolveAction(id, { key: 'ArrowDown', inField: true }), null)
    assert.equal(resolveAction(id, { key: 'ArrowUp', inField: true }), null)
  }
})

test('nextUndecided skips decided items and returns null when all are decided', () => {
  const ids = ['e1', 'e2', 'e3', 'e4']
  // from e1, e2 decided → next undecided is e3
  assert.equal(nextUndecided(ids, { e2: 'go' }, 'e1'), 'e3')
  // wraps: from e4, only e1 undecided
  assert.equal(nextUndecided(ids, { e2: 'go', e3: 'go', e4: 'go' }, 'e4'), 'e1')
  // all decided → null (stop)
  assert.equal(nextUndecided(ids, { e1: 'go', e2: 'go', e3: 'go', e4: 'go' }, 'e2'), null)
  // nothing focused yet → first undecided
  assert.equal(nextUndecided(ids, { e1: 'go' }, null), 'e2')
})

test('nextUndecided never returns the current item', () => {
  const ids = ['a', 'b', 'c']
  // b is the only undecided and it's current → null, don't loop back onto itself
  assert.equal(nextUndecided(ids, { a: 'go', c: 'go' }, 'b'), null)
})

test('neighbor clamps at the ends (no wrap)', () => {
  const ids = ['a', 'b', 'c']
  assert.equal(neighbor(ids, 'a', -1), 'a') // already at top
  assert.equal(neighbor(ids, 'a', 1), 'b')
  assert.equal(neighbor(ids, 'c', 1), 'c') // already at bottom
  assert.equal(neighbor(ids, null, 1), 'a') // fresh → first
  assert.equal(neighbor(ids, null, -1), 'c') // fresh, upward → last
})
