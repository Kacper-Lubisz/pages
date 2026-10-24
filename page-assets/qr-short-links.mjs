#!/usr/bin/env node
// qr-short-links — short, scannable links for <QrLinks> / <Checklist qr> on a phone.
//
//   node notes/pages/.page-assets/qr-short-links.mjs [--host auto|<lan-ip>] [--port 4327]
//
// page-server.mjs starts and stops this alongside the daemon, so you rarely run it by hand.
//
// 4327 rather than 4318, which the Datadog agent's OTLP receiver often holds.
//
// Serves only:
//   GET /health   → {"ok":true}  (pages probe it to decide between short and full URLs)
//   GET /<code>   → 302 to the URL whose short code is <code>, and records the scan
//
// A code is shortCode(url) (FNV-1a, base36, 6 chars; the same function lives in page-ui.tsx).
// Codes only resolve to URLs already listed in a page's link file, notes/pages/<slug>__<id>.state.json
// ({ "entries": [{ "url", … }] }), so this is not an open redirect. Opening a link sets
// "scannedAt" and bumps "scanCount" on that entry, which pages poll to tick checklist items.
//
// It listens on every interface so it survives a Wi-Fi address change, and advertises the LAN address
// (127.0.0.1 off Wi-Fi, where only the tunnel reaches it). It never exposes the Vite daemon, whose
// fs.allow spans the whole repo, and it runs no commands.
import http from 'node:http'
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // notes/pages/.page-assets
const storeDir = resolve(here, '..') // notes/pages
// Written while running so the page server (/api/short-links) and page-server.mjs can find it.
const STATE_FILE = resolve(here, '.short-links.json')

// The Mac's Wi-Fi/LAN IPv4 address (en0 first), so a phone on the same network can reach it.
function lanAddress() {
  const interfaces = Object.entries(networkInterfaces()).sort(([a], [b]) => (a === 'en0' ? -1 : b === 'en0' ? 1 : 0))
  for (const [, addresses] of interfaces) {
    for (const a of addresses || []) {
      if (a.family === 'IPv4' && !a.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address
    }
  }
  return null
}
const LINK_FILE = /^[a-zA-Z0-9_-]+__[a-zA-Z0-9_-]+\.state\.json$/
const CODE = /^\/([0-9a-z]{6})$/

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const requestedHost = arg('host', 'auto')
const host = requestedHost === 'auto' ? (lanAddress() ?? '127.0.0.1') : requestedHost
const port = Number(arg('port', '4327'))

export function shortCode(url) {
  let hash = 0x811c9dc5
  for (let i = 0; i < url.length; i++) {
    hash ^= url.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(6, '0').slice(-6)
}

function markScanned(code) {
  for (const name of readdirSync(storeDir).filter(n => LINK_FILE.test(n))) {
    const file = resolve(storeDir, name)
    let state
    try {
      state = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    if (!Array.isArray(state?.entries)) continue
    const entry = state.entries.find(e => typeof e?.url === 'string' && shortCode(e.url) === code)
    if (!entry) continue
    entry.scannedAt = new Date().toISOString()
    entry.scanCount = (entry.scanCount || 0) + 1
    writeFileSync(file, JSON.stringify(state, null, 2))
    return entry.url
  }
  return null
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0]
  if (req.method !== 'GET') {
    res.writeHead(405).end()
    return
  }
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' })
    res.end('{"ok":true}')
    return
  }
  const match = path.match(CODE)
  const url = match ? markScanned(match[1]) : null
  if (!url) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Unknown or expired link. Seed again for a fresh code.')
    return
  }
  console.log(`${new Date().toISOString()} ${match[1]} → ${url.slice(0, 80)}`)
  res.writeHead(302, { location: url, 'cache-control': 'no-store' }).end()
})

server.listen(port, '0.0.0.0', () => {
  const base = `http://${host}:${port}`
  writeFileSync(STATE_FILE, JSON.stringify({ base, host, port, pid: process.pid, startedAt: new Date().toISOString() }))
  console.log(`qr-short-links on ${base}`)
})
const stop = () => {
  rmSync(STATE_FILE, { force: true })
  process.exit(0)
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
