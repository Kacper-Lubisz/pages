#!/usr/bin/env node
// share.mjs — publish plan pages beyond localhost. Every command prints ONE JSON line to
// stdout (logs go to stderr), so the daemon middleware and the ShareBar UI consume results
// directly. Everything fails gracefully: a missing/unauthed CLI is a structured
// { ok:false, reason, hint } — never a crash.
//
//   node notes/pages/.page-assets/share.mjs <command>        (run from repo root)
//
//   export <slug> [--ttl D]   build the per-page static bundle into .share/<slug>/
//   publish <slug> [--ttl D]  export + assemble the site + deploy to Vercel (production)
//   unpublish <slug>          remove a share and redeploy the site without it
//   sweep                     drop expired shares; redeploy if anything was dropped
//   ngrok-up                  fallback: static file server on :4319 + ngrok tunnel over it
//   ngrok-down                stop the tunnel + static server
//   serve-static              (internal) the static file server ngrok fronts
//   status                    { vercel, ngrok, shares, baseUrl } for the ShareBar chips
//
// Model: ONE Vercel project (turbocharge-pages), ONE production deployment that carries every
// active share under /<slug>/ plus an overview index at /. Production is the only deployment
// class that Vercel leaves unprotected by default (previews sit behind Vercel auth), and a
// single prod deploy gives a stable base URL + free content-addressed upload dedup (videos
// upload once ever). Deploys use --prebuilt (Build Output API) so nothing builds remotely.
import { spawn, spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync,
  writeFileSync, createReadStream,
} from 'node:fs'
import { createServer } from 'node:http'
import { basename, dirname, extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // notes/pages/.page-assets
const plansDir = resolve(here, '..')
const repo = resolve(here, '../../..')
const appDir = resolve(plansDir, '.app')
const SHARE = resolve(plansDir, '.share')
const SITE = resolve(SHARE, 'site')
const OUTPUT = resolve(SITE, '.vercel/output')
const STATIC = resolve(OUTPUT, 'static')
const REGISTRY = resolve(SHARE, 'shares.json')
const PROJECT = process.env.PAGE_SHARE_PROJECT || 'turbocharge-pages'
const STATIC_PORT = 4319
// ngrok's local API defaults to 4040 but auto-increments when the port is taken (any node
// dev server squatting 4040 pushes it to 4041+), so probe a small range and verify the
// responder is actually ngrok (a tunnels array) before trusting it.
const NGROK_API_PORTS = [4040, 4041, 4042, 4043, 4044]
const DEFAULT_TTL_DAYS = 14

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/x-m4v',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

const log = (...a) => console.error('[share]', ...a)
const out = obj => console.log(JSON.stringify(obj))
const cleanSlug = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '')

function readRegistry() {
  try { return JSON.parse(readFileSync(REGISTRY, 'utf8')) } catch { return { shares: {} } }
}
function writeRegistry(reg) {
  mkdirSync(SHARE, { recursive: true })
  writeFileSync(REGISTRY, JSON.stringify(reg, null, 2))
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 120_000, ...opts })
  if (r.error && r.error.code === 'ENOENT') return { notFound: true, code: -1, stdout: '', stderr: '' }
  return { code: r.status ?? -1, stdout: r.stdout || '', stderr: r.stderr || '', timedOut: r.error?.code === 'ETIMEDOUT' }
}
const tail = (s, n = 800) => String(s || '').trim().slice(-n)

/* ---- CLI availability -------------------------------------------------- */
// vercel whoami costs ~1s, so cache the answer briefly — the ShareBar polls status.
function vercelStatus(force = false) {
  const cacheFile = resolve(SHARE, '.vercel-status.json')
  if (!force) {
    try {
      const c = JSON.parse(readFileSync(cacheFile, 'utf8'))
      if (Date.now() - c.at < 60_000) return c.status
    } catch {}
  }
  const status = (() => {
    const r = run('vercel', ['whoami'], { timeout: 15_000 })
    if (r.notFound) return { installed: false, authed: false, hint: 'npm i -g vercel' }
    if (r.code !== 0) return { installed: true, authed: false, hint: 'run: vercel login', error: tail(r.stderr, 200) }
    return { installed: true, authed: true, user: r.stdout.trim().split('\n').pop() }
  })()
  mkdirSync(SHARE, { recursive: true })
  writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), status }))
  return status
}

async function ngrokStatus() {
  const which = run('ngrok', ['version'], { timeout: 5_000 })
  if (which.notFound) return { installed: false, up: false, hint: 'https://ngrok.com/download' }
  for (const port of NGROK_API_PORTS) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/tunnels`, { signal: AbortSignal.timeout(1_000) })
      const j = await r.json()
      if (!Array.isArray(j.tunnels)) continue // something else on this port
      const t = j.tunnels.find(t => String(t.config?.addr || '').endsWith(`:${STATIC_PORT}`))
      if (t) return { installed: true, up: true, url: t.public_url }
    } catch {}
  }
  return { installed: true, up: false }
}

/* ---- export: per-page static bundle ------------------------------------ */
function planTitle(src, slug) {
  const m = src.match(/title:\s*(['"`])([\s\S]*?)\1/)
  return m ? m[2] : slug
}
// Bake live PR statuses referenced by <PrStatus pr={N}> so the static page shows the
// state as of the snapshot instead of a dead fetch.
function bakeGh(src) {
  const prs = [...new Set([...src.matchAll(/PrStatus[^>]*?\bpr=\{(\d+)\}/g)].map(m => m[1]))]
  const baked = {}
  for (const n of prs) {
    const r = run('gh', ['pr', 'view', n, '--json', 'number,state,isDraft,mergeStateStatus,statusCheckRollup,url,title'], { cwd: repo, timeout: 15_000 })
    if (r.notFound || r.code !== 0) continue
    try {
      const d = JSON.parse(r.stdout)
      const rollup = Array.isArray(d.statusCheckRollup) ? d.statusCheckRollup : []
      const concl = c => c.conclusion || c.state
      const fail = rollup.some(c => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR', 'ACTION_REQUIRED'].includes(concl(c)))
      const pending = rollup.some(c => c.status && c.status !== 'COMPLETED')
      baked[n] = {
        ok: true, number: d.number, state: d.state, isDraft: !!d.isDraft, merge: d.mergeStateStatus,
        checks: rollup.length === 0 ? 'none' : fail ? 'fail' : pending ? 'pending' : 'pass',
        url: d.url, title: d.title,
      }
    } catch {}
  }
  return baked
}
const inlineJson = v => JSON.stringify(v ?? null).replace(/</g, '\\u003c')

function exportPlan(slug, { sharedAt, expiresAt }) {
  // .page.tsx is canonical; .plan.tsx is the legacy extension from before the rename
  const planFile = [resolve(plansDir, `${slug}.page.tsx`), resolve(plansDir, `${slug}.plan.tsx`)].find(existsSync)
  if (!planFile) return { ok: false, reason: 'no-such-page', hint: `${slug}.page.tsx not found in notes/pages/` }
  const src = readFileSync(planFile, 'utf8')
  const title = planTitle(src, slug)

  let state = null
  try { state = JSON.parse(readFileSync(resolve(plansDir, `${slug}.state.json`), 'utf8')) } catch {}
  const gh = bakeGh(src)
  const share = { slug, title, sharedAt, expiresAt }

  const buildDir = resolve(SHARE, '.build', slug)
  const outDir = resolve(SHARE, slug)
  rmSync(buildDir, { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  writeFileSync(resolve(buildDir, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title.replace(/</g, '&lt;')}</title>
</head>
<body>
<div id="root"></div>
<script>
window.process = window.process || { env: {} };
window.__PAGE_STATE__ = ${inlineJson(state)};
window.__PAGE_GH__ = ${inlineJson(gh)};
window.__PAGE_SHARE__ = ${inlineJson(share)};
</script>
<script type="module" src="./entry.tsx"></script>
</body>
</html>
`)
  writeFileSync(resolve(buildDir, 'entry.tsx'), `import { createRoot } from 'react-dom/client'
import '${appDir}/src/index.css'
import { setTab } from '${appDir}/src/lib/tab'
import Component, { meta } from '${planFile}'

const m: Record<string, unknown> = meta ?? {}
setTab({
  icon: typeof m.icon === 'string' ? m.icon : undefined,
  title: typeof m.title === 'string' ? m.title : ${JSON.stringify(slug)},
  slug: ${JSON.stringify(slug)},
})
createRoot(document.getElementById('root')!).render(<Component />)
`)

  log(`building ${slug} …`)
  const vite = resolve(repo, 'node_modules/.bin/vite')
  const r = run(vite, ['build', '--config', resolve(appDir, 'vite.config.share.mjs')], {
    cwd: repo, timeout: 180_000,
    env: { ...process.env, PAGE_BUILD_DIR: buildDir, PAGE_OUT_DIR: outDir },
  })
  if (r.notFound) return { ok: false, reason: 'no-vite', hint: 'yarn install in the repo root' }
  if (r.code !== 0) return { ok: false, reason: 'build-failed', log: tail(r.stderr || r.stdout, 1200) }
  return { ok: true, title, dist: outDir }
}

/* ---- site assembly (all active shares + overview) ---------------------- */
function fmtDate(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : null
}
function overviewHtml(reg) {
  const rows = Object.entries(reg.shares)
    .sort(([, a], [, b]) => String(b.sharedAt).localeCompare(String(a.sharedAt)))
    .map(([slug, s]) => `
    <a class="card" href="./${slug}/">
      <div class="title">${String(s.title || slug).replace(/</g, '&lt;')}</div>
      <div class="meta">
        <code>${slug}</code>
        <span>shared ${fmtDate(s.sharedAt)}</span>
        ${s.expiresAt ? `<span class="exp">expires ${fmtDate(s.expiresAt)}</span>` : '<span>no expiry</span>'}
      </div>
    </a>`)
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Shared pages</title>
<style>
  body { font: 15px/1.5 Inter, ui-sans-serif, system-ui, sans-serif; color: #0f172a; background: #fff;
         max-width: 720px; margin: 0 auto; padding: 64px 32px; }
  h1 { font-size: 28px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .sub { color: #64748b; margin-bottom: 28px; }
  .card { display: block; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px;
          margin-bottom: 12px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.08); }
  .title { font-weight: 600; font-size: 16px; }
  .meta { display: flex; gap: 14px; margin-top: 4px; font-size: 12px; color: #94a3b8; }
  .meta code { background: #f1f5f9; border-radius: 4px; padding: 1px 6px; color: #475569; }
  .exp { color: #b45309; }
  .empty { color: #94a3b8; border: 1px dashed #e2e8f0; border-radius: 10px; padding: 24px; text-align: center; }
</style>
</head>
<body>
<h1>Shared pages</h1>
<div class="sub">Static snapshots published from the pages daemon. Links are unlisted — treat them as internal.</div>
${rows || '<div class="empty">Nothing shared right now.</div>'}
</body>
</html>
`
}

function assemble(reg) {
  rmSync(STATIC, { recursive: true, force: true })
  mkdirSync(STATIC, { recursive: true })
  const missing = []
  for (const slug of Object.keys(reg.shares)) {
    const dist = resolve(SHARE, slug)
    if (!existsSync(resolve(dist, 'index.html'))) { missing.push(slug); continue }
    cpSync(dist, resolve(STATIC, slug), { recursive: true })
    // author-written asset URLs are absolute (/api/asset/<slug>/…) — serve them from the
    // site root so they work verbatim under the /<slug>/ subpath
    const assets = resolve(plansDir, `${slug}-assets`)
    if (existsSync(assets)) cpSync(assets, resolve(STATIC, 'api/asset', slug), { recursive: true })
  }
  writeFileSync(resolve(STATIC, 'index.html'), overviewHtml(reg))
  // trailingSlash so /<slug> → /<slug>/ and the bundle's ./assets/… URLs resolve inside it
  writeFileSync(resolve(OUTPUT, 'config.json'), JSON.stringify({ version: 3, trailingSlash: true }))
  return { missing }
}

/* ---- vercel deploy ------------------------------------------------------ */
function ensureLinked() {
  if (existsSync(resolve(SITE, '.vercel/project.json'))) return { ok: true }
  log(`linking ${SITE} → project ${PROJECT} …`)
  let r = run('vercel', ['link', '--yes', '--project', PROJECT], { cwd: SITE, timeout: 60_000 })
  if (r.code !== 0) {
    run('vercel', ['project', 'add', PROJECT], { cwd: SITE, timeout: 60_000 })
    r = run('vercel', ['link', '--yes', '--project', PROJECT], { cwd: SITE, timeout: 60_000 })
  }
  if (r.code !== 0) return { ok: false, reason: 'vercel-link-failed', log: tail(r.stderr, 600) }
  return { ok: true }
}

async function deploy(reg) {
  const t0 = Date.now()
  const r = run('vercel', ['deploy', '--prebuilt', '--prod', '--yes'], { cwd: SITE, timeout: 300_000 })
  if (r.code !== 0) return { ok: false, reason: 'vercel-deploy-failed', log: tail(r.stderr || r.stdout, 1200) }
  const deploymentUrl = ((r.stdout.match(/https:\/\/\S+/g) || []).pop() || '').replace(/\/$/, '')
  // Raw deployment URLs sit behind Vercel Authentication by default ("Standard Protection");
  // only the project's stable production domain is public. The CLI never prints that domain,
  // so probe it — this both discovers the base URL and proves viewers can actually open it.
  const guess = `https://${PROJECT}.vercel.app`
  const isPublic = await (async () => {
    try {
      const p = await fetch(`${guess}/`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      return p.status < 300
    } catch { return false }
  })()
  const baseUrl = isPublic ? guess : deploymentUrl
  if (baseUrl) reg.baseUrl = baseUrl
  // prune old, no-longer-aliased deployments so expired content isn't reachable via stale URLs
  run('vercel', ['remove', PROJECT, '--safe', '--yes'], { cwd: SITE, timeout: 60_000 })
  return {
    ok: true, baseUrl, deploymentUrl, ms: Date.now() - t0,
    ...(isPublic ? {} : { warning: 'stable project domain not reachable — falling back to the deployment URL, which sits behind Vercel auth for outside viewers' }),
  }
}

/* ---- post-deploy asset verification -------------------------------------
   Vercel dedups uploads by content hash ACROSS projects. If a deploy references blobs whose
   owning deployment/project is later pruned, the platform can GC them and the live site 404s
   assets it never re-uploaded (bit us when renaming turbocharge-plans → turbocharge-pages).
   So after every publish: HEAD every shared asset; on misses, redeploy once (the CLI re-uploads
   whatever the server reports missing). */
async function verifyAssets(baseUrl) {
  const root = resolve(STATIC, 'api/asset')
  if (!baseUrl || !existsSync(root)) return { checked: 0, missing: [] }
  const paths = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(d => d.isFile())
    .map(d => resolve(d.parentPath, d.name).slice(STATIC.length).replaceAll('\\', '/'))
    .slice(0, 300)
  const missing = []
  for (let i = 0; i < paths.length; i += 10) {
    await Promise.all(paths.slice(i, i + 10).map(async p => {
      try {
        const r = await fetch(baseUrl + encodeURI(p), { method: 'HEAD', signal: AbortSignal.timeout(10_000) })
        if (r.status !== 200) missing.push(p)
      } catch { missing.push(p) }
    }))
  }
  return { checked: paths.length, missing }
}

/* ---- ttl / sweep --------------------------------------------------------- */
function dropExpired(reg) {
  const now = Date.now()
  const dropped = []
  for (const [slug, s] of Object.entries(reg.shares)) {
    if (s.expiresAt && Date.parse(s.expiresAt) < now) {
      delete reg.shares[slug]
      rmSync(resolve(SHARE, slug), { recursive: true, force: true })
      dropped.push(slug)
    }
  }
  return dropped
}

/* ---- commands ------------------------------------------------------------ */
function parseTtl(args) {
  const i = args.indexOf('--ttl')
  if (i === -1) return DEFAULT_TTL_DAYS
  const v = Number(args[i + 1])
  if (Number.isNaN(v)) return DEFAULT_TTL_DAYS
  return v // 0 → no expiry
}
const expiryFromTtl = ttlDays => (ttlDays > 0 ? new Date(Date.now() + ttlDays * 86_400_000).toISOString() : null)

async function cmdPublish(slug, ttlDays) {
  const reg = readRegistry()
  const droppedNow = dropExpired(reg)
  const sharedAt = new Date().toISOString()
  const expiresAt = expiryFromTtl(ttlDays)
  const exp = exportPlan(slug, { sharedAt, expiresAt })
  if (!exp.ok) return exp
  reg.shares[slug] = { title: exp.title, sharedAt, expiresAt }
  const { missing } = assemble(reg)
  writeRegistry(reg)

  const v = vercelStatus(true)
  if (!v.installed) return { ok: false, reason: 'vercel-not-installed', hint: v.hint, exported: true, fallback: 'ngrok-up serves the exported site locally' }
  if (!v.authed) return { ok: false, reason: 'vercel-not-authed', hint: v.hint, exported: true, fallback: 'ngrok-up serves the exported site locally' }
  const link = ensureLinked()
  if (!link.ok) return { ...link, exported: true, fallback: 'ngrok-up serves the exported site locally' }
  const dep = await deploy(reg)
  if (!dep.ok) return { ...dep, exported: true, fallback: 'ngrok-up serves the exported site locally' }
  writeRegistry(reg)
  let assets = await verifyAssets(reg.baseUrl)
  if (assets.missing.length) {
    log(`${assets.missing.length}/${assets.checked} assets missing on the live site — redeploying once to re-upload`)
    const dep2 = await deploy(reg)
    if (dep2.ok) assets = await verifyAssets(reg.baseUrl)
  }
  return {
    ok: true, url: `${reg.baseUrl}/${slug}/`, overview: reg.baseUrl, expiresAt,
    deployMs: dep.ms, assetsChecked: assets.checked,
    ...(assets.missing.length ? { assetsMissing: assets.missing.slice(0, 10) } : {}),
    ...(droppedNow.length ? { sweptExpired: droppedNow } : {}), ...(missing.length ? { missingDists: missing } : {}),
  }
}

async function cmdUnpublish(slug) {
  const reg = readRegistry()
  if (!reg.shares[slug]) return { ok: false, reason: 'not-shared' }
  delete reg.shares[slug]
  rmSync(resolve(SHARE, slug), { recursive: true, force: true })
  dropExpired(reg)
  assemble(reg)
  writeRegistry(reg)
  const v = vercelStatus()
  if (!v.installed || !v.authed) return { ok: true, note: 'removed locally; vercel unavailable so the old deployment may linger', vercel: v }
  const link = ensureLinked()
  if (!link.ok) return { ok: true, note: 'removed locally; vercel link failed', detail: link }
  const dep = await deploy(reg)
  if (!dep.ok) return { ok: true, note: 'removed locally; redeploy failed', detail: dep }
  writeRegistry(reg)
  return { ok: true, overview: reg.baseUrl }
}

async function cmdSweep() {
  const reg = readRegistry()
  const dropped = dropExpired(reg)
  if (!dropped.length) return { ok: true, dropped: [] }
  assemble(reg)
  writeRegistry(reg)
  const v = vercelStatus()
  if (!v.installed || !v.authed) return { ok: true, dropped, note: 'vercel unavailable — expired shares removed locally, redeploy pending' }
  const link = ensureLinked()
  const dep = link.ok ? await deploy(reg) : link
  writeRegistry(reg)
  return { ok: true, dropped, redeployed: !!dep.ok, ...(dep.ok ? {} : { detail: dep }) }
}

/* ---- ngrok fallback ------------------------------------------------------ */
// The tunnel fronts a tiny static server over the SAME assembled site the Vercel deploy
// ships — never the Vite dev daemon (which can read the whole repo). Static, read-only, safe.
const SERVER_PID = resolve(SHARE, '.static-server.pid')
const NGROK_PID = resolve(SHARE, '.ngrok.pid')
const NGROK_LOG = resolve(SHARE, '.ngrok.log')

async function staticServerUp() {
  try { const r = await fetch(`http://127.0.0.1:${STATIC_PORT}/`, { signal: AbortSignal.timeout(600) }); return r.status < 500 } catch { return false }
}

function serveStatic() {
  const server = createServer((req, res) => {
    const head = req.method === 'HEAD'
    if (req.method !== 'GET' && !head) { res.statusCode = 405; return res.end() }
    let path = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '')
    let file = join(STATIC, path)
    if (!file.startsWith(STATIC)) { res.statusCode = 403; return res.end() }
    if (existsSync(file) && statSync(file).isDirectory()) {
      // mirror Vercel's trailingSlash behaviour so relative asset URLs resolve
      if (!path.endsWith('/')) { res.statusCode = 308; res.setHeader('location', path + '/'); return res.end() }
      file = join(file, 'index.html')
    }
    if (!existsSync(file) || !statSync(file).isFile()) { res.statusCode = 404; return res.end('not found') }
    res.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
    const size = statSync(file).size
    res.setHeader('accept-ranges', 'bytes')
    const m = typeof req.headers.range === 'string' && req.headers.range.match(/^bytes=(\d*)-(\d*)$/)
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : size - 1
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        res.statusCode = 416; res.setHeader('content-range', `bytes */${size}`); return res.end()
      }
      end = Math.min(end, size - 1)
      res.statusCode = 206
      res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
      res.setHeader('content-length', end - start + 1)
      if (head) return res.end()
      return createReadStream(file, { start, end }).pipe(res)
    }
    res.setHeader('content-length', size)
    if (head) return res.end()
    createReadStream(file).pipe(res)
  })
  server.listen(STATIC_PORT, '127.0.0.1', () => log(`static server on :${STATIC_PORT} serving ${STATIC}`))
}

const killPidfile = f => {
  try { process.kill(Number(readFileSync(f, 'utf8').trim())) } catch {}
  rmSync(f, { force: true })
}

async function cmdNgrokUp() {
  const n = await ngrokStatus()
  if (!n.installed) return { ok: false, reason: 'ngrok-not-installed', hint: n.hint }
  if (!existsSync(resolve(STATIC, 'index.html'))) {
    const reg = readRegistry()
    if (!Object.keys(reg.shares).length) return { ok: false, reason: 'nothing-exported', hint: 'publish or export a plan first' }
    assemble(reg)
  }
  if (!(await staticServerUp())) {
    const logFd = openSync(resolve(SHARE, '.static-server.log'), 'a')
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve-static'], { detached: true, stdio: ['ignore', logFd, logFd] })
    writeFileSync(SERVER_PID, String(child.pid))
    child.unref()
    for (let i = 0; i < 20 && !(await staticServerUp()); i++) await new Promise(r => setTimeout(r, 250))
    if (!(await staticServerUp())) return { ok: false, reason: 'static-server-failed', log: tail(readFileSync(resolve(SHARE, '.static-server.log'), 'utf8')) }
  }
  if (n.up) return { ok: true, url: n.url, note: 'tunnel already up' }
  const logFd = openSync(NGROK_LOG, 'w')
  const child = spawn('ngrok', ['http', String(STATIC_PORT), '--log', 'stdout'], { detached: true, stdio: ['ignore', logFd, logFd] })
  writeFileSync(NGROK_PID, String(child.pid))
  child.unref()
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 300))
    const s = await ngrokStatus()
    if (s.up) return { ok: true, url: s.url }
  }
  killPidfile(NGROK_PID)
  const logTail = tail(existsSync(NGROK_LOG) ? readFileSync(NGROK_LOG, 'utf8') : '', 600)
  const authErr = /ERR_NGROK_(4018|107)/.test(logTail)
  const sessionErr = /ERR_NGROK_108|simultaneous/.test(logTail)
  return {
    ok: false,
    reason: authErr ? 'ngrok-not-authed' : sessionErr ? 'ngrok-session-busy' : 'ngrok-failed',
    hint: authErr ? 'ngrok config add-authtoken <token>' : sessionErr ? 'another ngrok agent is running — stop it or upgrade the plan' : undefined,
    log: logTail,
  }
}

async function cmdNgrokDown() {
  killPidfile(NGROK_PID)
  killPidfile(SERVER_PID)
  return { ok: true }
}

/* ---- status --------------------------------------------------------------- */
async function cmdStatus() {
  const reg = readRegistry()
  const v = vercelStatus()
  const n = await ngrokStatus()
  const now = Date.now()
  const shares = {}
  for (const [slug, s] of Object.entries(reg.shares)) {
    shares[slug] = {
      ...s,
      url: reg.baseUrl ? `${reg.baseUrl}/${slug}/` : null,
      ngrokUrl: n.up ? `${n.url}/${slug}/` : null,
      expired: !!(s.expiresAt && Date.parse(s.expiresAt) < now),
    }
  }
  return { ok: true, vercel: v, ngrok: n, shares, baseUrl: reg.baseUrl || null, project: PROJECT }
}

/* ---- main ------------------------------------------------------------------ */
const [cmd, ...rest] = process.argv.slice(2)
const args = rest.filter(a => a !== '--json')
try {
  const result = await (async () => {
    if (cmd === 'export') {
      const slug = cleanSlug(args[0])
      if (!slug) return { ok: false, reason: 'bad-slug' }
      const ttl = parseTtl(args)
      const r = exportPlan(slug, { sharedAt: new Date().toISOString(), expiresAt: expiryFromTtl(ttl) })
      return r
    }
    if (cmd === 'publish') {
      const slug = cleanSlug(args[0])
      if (!slug) return { ok: false, reason: 'bad-slug' }
      return cmdPublish(slug, parseTtl(args))
    }
    if (cmd === 'unpublish') {
      const slug = cleanSlug(args[0])
      if (!slug) return { ok: false, reason: 'bad-slug' }
      return cmdUnpublish(slug)
    }
    if (cmd === 'sweep') return cmdSweep()
    if (cmd === 'ngrok-up') return cmdNgrokUp()
    if (cmd === 'ngrok-down') return cmdNgrokDown()
    if (cmd === 'status') return cmdStatus()
    if (cmd === 'serve-static') { serveStatic(); return null } // long-running, no JSON
    return { ok: false, reason: 'usage', hint: 'share.mjs <export|publish|unpublish|sweep|ngrok-up|ngrok-down|status> [slug] [--ttl days]' }
  })()
  if (result) { out(result); process.exit(result.ok ? 0 : 1) }
} catch (e) {
  out({ ok: false, error: String(e?.stack || e).slice(0, 800) })
  process.exit(1)
}
