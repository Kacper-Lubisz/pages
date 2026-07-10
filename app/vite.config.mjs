import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve, basename, extname } from 'node:path'
import { readFileSync, writeFileSync, existsSync, statSync, createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'

// Interactive plans (decision boards, reviews) persist state to a JSON file next to the plan
// and can show local image/video attachments. Two dev-server endpoints back that:
//   GET/POST /api/state/<slug>        reads/writes notes/pages/<slug>.state.json
//   GET      /api/asset/<slug>/<file> serves notes/pages/<slug>-assets/<file>
// Both are slug-scoped and path-traversal-safe (slug sanitised, file reduced to basename).
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.m4v': 'video/x-m4v',
}
const cleanSlug = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '')

// .app → plans → notes → repo root
const here = import.meta.dirname
const repo = resolve(here, '../../..')
const plansDir = resolve(here, '..') // notes/pages
const mainFile = resolve(here, 'src/main.tsx')

// Plans live in the parent of the Vite root, which the dev watcher doesn't track — so a
// newly-added *.plan.tsx wouldn't appear without a restart. Watch the plans dir and, on
// add/remove, invalidate main.tsx (the glob owner) + full-reload so the registry re-expands.
function planApi() {
  return {
    name: 'plan-api',
    configureServer(server) {
      server.middlewares.use('/api/state/', (req, res, next) => {
        const slug = cleanSlug(decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]))
        if (!slug) { res.statusCode = 400; return res.end('{"error":"bad slug"}') }
        const file = resolve(plansDir, `${slug}.state.json`)
        if (req.method === 'GET') {
          res.setHeader('content-type', 'application/json')
          return res.end(existsSync(file) ? readFileSync(file, 'utf8') : '{}')
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          let body = ''
          req.on('data', c => (body += c))
          req.on('end', () => {
            try {
              JSON.stringify(JSON.parse(body)) // validate
              writeFileSync(file, body)
              res.setHeader('content-type', 'application/json')
              res.end('{"ok":true}')
            } catch {
              res.statusCode = 400
              res.end('{"ok":false,"error":"invalid json"}')
            }
          })
          return
        }
        next()
      })
      server.middlewares.use('/api/asset/', (req, res, next) => {
        const head = req.method === 'HEAD'
        if (req.method !== 'GET' && !head) return next()
        const parts = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]).split('/')
        const slug = cleanSlug(parts[0])
        const name = basename(parts.slice(1).join('/') || '')
        if (!slug || !name) { res.statusCode = 400; return res.end(head ? undefined : 'bad request') }
        const dir = resolve(plansDir, `${slug}-assets`)
        const file = resolve(dir, name)
        const ok = file.startsWith(dir) && existsSync(file)
        // HEAD is the existence-probe: always 200, presence in a header — so a missing asset
        // doesn't log a console 404. GET serves the bytes (404 only if probed-then-deleted).
        if (head) {
          res.statusCode = 200
          res.setHeader('x-asset-present', ok ? '1' : '0')
          return res.end()
        }
        if (!ok) { res.statusCode = 404; return res.end('not found') }
        res.setHeader('content-type', MIME[extname(name).toLowerCase()] || 'application/octet-stream')
        res.setHeader('cache-control', 'no-cache')
        // Honor HTTP Range — <video> needs 206 partial responses to load/seek (without it
        // Chromium often won't play the file at all, which showed as a white frame).
        const size = statSync(file).size
        res.setHeader('accept-ranges', 'bytes')
        const range = req.headers.range
        const m = typeof range === 'string' && range.match(/^bytes=(\d*)-(\d*)$/)
        if (m && (m[1] || m[2])) {
          let start = m[1] ? parseInt(m[1], 10) : 0
          let end = m[2] ? parseInt(m[2], 10) : size - 1
          if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
            res.statusCode = 416
            res.setHeader('content-range', `bytes */${size}`)
            return res.end()
          }
          end = Math.min(end, size - 1)
          res.statusCode = 206
          res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
          res.setHeader('content-length', end - start + 1)
          return createReadStream(file, { start, end }).pipe(res)
        }
        res.setHeader('content-length', size)
        return createReadStream(file).pipe(res)
      })
    },
  }
}

// Live GitHub PR status for the shared <PrStatus> component:
//   GET /api/gh/pr/<n>   → { ok, number, state, isDraft, merge, checks, url, title }
// Shells out to the repo's `gh` CLI (inherits the user's auth), cwd-pinned to the repo root so
// the PR number resolves against this repo. Results cached ~20s so a page full of <PrStatus> (and
// its poll loop) doesn't spawn a `gh` per render. Strictly read-only (`gh pr view`).
function ghApi() {
  const cache = new Map() // n -> { at, body }
  const TTL = 20_000
  const run = n =>
    new Promise(resolve => {
      execFile(
        'gh',
        ['pr', 'view', String(n), '--json', 'number,state,isDraft,mergeStateStatus,statusCheckRollup,url,title'],
        { cwd: repo, timeout: 12_000, maxBuffer: 4 << 20 },
        (err, stdout) => {
          if (err) return resolve({ ok: false, error: String(err.message || err).split('\n')[0] })
          try {
            const d = JSON.parse(stdout)
            const rollup = Array.isArray(d.statusCheckRollup) ? d.statusCheckRollup : []
            const concl = c => c.conclusion || c.state // checks use conclusion; statuses use state
            const fail = rollup.some(c => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR', 'ACTION_REQUIRED'].includes(concl(c)))
            const pending = rollup.some(c => c.status && c.status !== 'COMPLETED')
            const checks = rollup.length === 0 ? 'none' : fail ? 'fail' : pending ? 'pending' : 'pass'
            resolve({ ok: true, number: d.number, state: d.state, isDraft: !!d.isDraft, merge: d.mergeStateStatus, checks, url: d.url, title: d.title })
          } catch (e) {
            resolve({ ok: false, error: 'parse error' })
          }
        },
      )
    })
  return {
    name: 'plan-gh-api',
    configureServer(server) {
      server.middlewares.use('/api/gh/pr/', async (req, res, next) => {
        if (req.method !== 'GET') return next()
        const n = (decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0]).match(/^\d+$/) || [])[0]
        res.setHeader('content-type', 'application/json')
        if (!n) { res.statusCode = 400; return res.end('{"ok":false,"error":"bad pr number"}') }
        const hit = cache.get(n)
        const fresh = hit && Date.now() - hit.at < TTL
        const body = fresh ? hit.body : await run(n)
        if (!fresh) cache.set(n, { at: Date.now(), body })
        res.end(JSON.stringify(body))
      })
    },
  }
}

// Sharing (backed by .page-assets/share.mjs — export/publish/ngrok/status). The ShareBar in
// every plan header (dev-only) polls GET /api/share/status for the Vercel + ngrok chips and
// POSTs actions here. share.mjs prints one JSON line to stdout; we relay it verbatim, so CLI
// failures (vercel not installed / not authed, ngrok missing) arrive as structured
// { ok:false, reason, hint } instead of 500s.
function shareApi() {
  const script = resolve(plansDir, '.page-assets/share.mjs')
  const ACTIONS = ['publish', 'unpublish', 'export', 'ngrok-up', 'ngrok-down', 'sweep']
  const runShare = args =>
    new Promise(done => {
      execFile(process.execPath, [script, ...args], { cwd: repo, timeout: 360_000, maxBuffer: 16 << 20 }, (err, stdout) => {
        const last = String(stdout || '').trim().split('\n').pop() || ''
        try { done(JSON.parse(last)) } catch { done({ ok: false, error: String(err?.message || 'share.mjs produced no JSON').slice(0, 400) }) }
      })
    })
  let statusCache = null
  return {
    name: 'plan-share-api',
    configureServer(server) {
      server.middlewares.use('/api/share', (req, res, next) => {
        const path = decodeURIComponent((req.url || '').replace(/^\//, '').split('?')[0])
        res.setHeader('content-type', 'application/json')
        if (req.method === 'GET' && (path === '' || path === 'status')) {
          const fresh = statusCache && Date.now() - statusCache.at < 10_000
          const p = fresh ? Promise.resolve(statusCache.body) : runShare(['status']).then(body => {
            statusCache = { at: Date.now(), body }
            return body
          })
          p.then(body => res.end(JSON.stringify(body)))
          return
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', c => (body += c))
          req.on('end', async () => {
            const j = (() => { try { return JSON.parse(body || '{}') } catch { return {} } })()
            const action = ACTIONS.includes(j.action) ? j.action : null
            const slug = cleanSlug(path)
            const needsSlug = action && !['ngrok-up', 'ngrok-down', 'sweep'].includes(action)
            if (!action || (needsSlug && !slug)) { res.statusCode = 400; return res.end('{"ok":false,"error":"bad action or slug"}') }
            const args = needsSlug ? [action, slug] : [action]
            if (Number.isFinite(j.ttl)) args.push('--ttl', String(j.ttl))
            statusCache = null
            res.end(JSON.stringify(await runShare(args)))
          })
          return
        }
        next()
      })
    },
  }
}

function watchPlans() {
  return {
    name: 'watch-plans',
    configureServer(server) {
      server.watcher.add(resolve(plansDir, '*.page.tsx'))
      server.watcher.add(resolve(plansDir, '*.plan.tsx')) // legacy extension
      server.watcher.add(resolve(plansDir, 'templates/*.page.tsx'))
      const onChange = file => {
        if (!file.endsWith('.page.tsx') && !file.endsWith('.plan.tsx')) return
        const mods = server.moduleGraph.getModulesByFile(mainFile)
        mods?.forEach(m => server.moduleGraph.invalidateModule(m))
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', onChange)
      server.watcher.on('unlink', onChange)
    },
  }
}

export default defineConfig({
  root: here,
  plugins: [react(), planApi(), ghApi(), shareApi(), watchPlans()],
  define: { __PAGE_STATIC__: 'false' },
  resolve: {
    alias: {
      // the plan component library
      '@page': resolve(here, 'src/lib/page-ui.tsx'),
      '@plan': resolve(here, 'src/lib/page-ui.tsx'), // legacy import specifier
      // catalyst imports next/link; stub it so real components render without a Next router
      'next/link': resolve(here, 'src/stubs/next-link.tsx'),
      // mirror apps/web's @/ alias so plans can import real web components
      '@': resolve(repo, 'apps/web/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PAGE_PORT) || 4317, // per-project override so two repos can serve at once
    strictPort: true, // stable URL for the always-on daemon
    // allow Vite to read real source from anywhere in the repo
    fs: { allow: [repo] },
  },
})
