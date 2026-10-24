// HTTPS tunnel for phone links: a local single-origin proxy (page-assets/tunnel-proxy.mjs) in
// front of a project's dev ports and the QR short-link server, published through ONE Cloudflare
// quick tunnel (`cloudflared tunnel --url …`). Mobile browsers only open the camera on a secure
// origin; this gives a plain-http LAN dev stack one, without restarting or changing it. Quick
// tunnels are free and need no account; each start gets a new random https://<words>.trycloudflare.com.
// Testing only: while it runs, those ports are reachable from the internet.
//
//   GET  /api/tunnels[?project=<name>] → { running, startedAt, status, publicUrl, error, localHosts,
//                                         routes: { <port>: <path prefix> }, services, config }
//   POST /api/tunnels/start  { ports?, project? }  ports default to projects.json <project>.tunnel.ports;
//                                                   the first is the app, served at the tunnel root
//   POST /api/tunnels/stop
//
// State is mirrored to .page-assets/.tunnels.json so a restarted daemon can kill the processes an
// earlier daemon left behind.
import { spawn, execFileSync } from 'node:child_process'
import { Resolver } from 'node:dns/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const URL_TIMEOUT_MS = 30_000
const DNS_RETRY_MS = 1_000
const STOP_GRACE_MS = 3_000
const MAX_PORTS = 12
const PUBLIC_RESOLVERS = ['1.1.1.1', '8.8.8.8']
const PUBLIC_URL = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/
const CONNECTED = /Registered tunnel connection/i
const ERROR_LINE = /\sERR\s/
const STOPPED = { running: false, startedAt: null, status: null, publicUrl: null, error: null, project: null, daemonPid: null, localHosts: [], routes: {}, services: [], pids: [] }

// Vite re-evaluates its config (and this module) in-process when the config changes; keeping the
// children on globalThis means a config reload doesn't orphan a running tunnel.
const store = (globalThis.__pagesTunnel ??= { children: [], state: null, exitHooked: false })

export function tunnelApi({ plansDir, daemonPort }) {
  const stateFile = resolve(plansDir, '.page-assets/.tunnels.json')
  const shortLinksFile = resolve(plansDir, '.page-assets/.short-links.json')
  const projectsFile = resolve(plansDir, '.config/projects.json')
  const proxyScript = resolve(plansDir, '.page-assets/tunnel-proxy.mjs')

  const save = () => writeFileSync(stateFile, JSON.stringify(store.state ?? STOPPED, null, 2))
  const projectTunnelConfig = project => {
    if (!project) return null
    const registry = readJson(projectsFile) ?? {}
    return registry[project]?.tunnel ?? null
  }

  killOrphanedProcesses(stateFile)
  if (!store.exitHooked) {
    store.exitHooked = true
    process.on('exit', () => {
      for (const child of store.children) {
        try { child.kill('SIGKILL') } catch {}
      }
      store.state = { ...STOPPED }
      try { save() } catch {}
    })
  }

  const update = (state, changes) => {
    if (store.state !== state) return
    Object.assign(state, changes)
    save()
  }
  const fail = (state, error) => {
    if (store.state !== state || state.status === 'error') return
    update(state, { status: 'error', error })
    stopChildren()
  }

  function startProxy(state, proxyConfig) {
    const child = spawn(process.execPath, [proxyScript, JSON.stringify(proxyConfig)], { stdio: ['ignore', 'pipe', 'pipe'] })
    store.children.push(child)
    state.pids.push(child.pid)
    let output = ''
    child.stdout.on('data', chunk => {
      output += chunk
      const port = output.match(/\{"port":(\d+)\}/)?.[1]
      if (port && !state.proxyPort) {
        update(state, { proxyPort: Number(port) })
        startCloudflared(state)
      }
    })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('exit', code => fail(state, `tunnel proxy exited (code ${code}): ${output.trim().split('\n').pop() ?? ''}`.slice(0, 300)))
  }

  function startCloudflared(state) {
    const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${state.proxyPort}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
    store.children.push(child)
    state.pids.push(child.pid)
    let lastError = null
    let connected = false
    let checkingDns = false
    // A lookup of the new hostname before Cloudflare publishes it gets negative-cached by the Wi-Fi
    // router, breaking it for the phone too; so nothing shows the URL until it resolves publicly.
    const goLiveOnceResolvable = async () => {
      checkingDns = true
      const resolver = new Resolver()
      resolver.setServers(PUBLIC_RESOLVERS)
      const hostname = new URL(state.foundUrl).hostname
      while (store.state === state && state.status === 'starting') {
        try {
          await resolver.resolve4(hostname)
          return update(state, { status: 'live', publicUrl: state.foundUrl, error: null })
        } catch {
          await new Promise(r => setTimeout(r, DNS_RETRY_MS))
        }
      }
    }
    const onOutput = chunk => {
      for (const line of String(chunk).split('\n')) {
        const url = line.match(PUBLIC_URL)?.[0]
        if (url && !state.foundUrl) update(state, { foundUrl: url })
        if (CONNECTED.test(line)) connected = true
        if (ERROR_LINE.test(line)) lastError = line.replace(/^\S+\s+ERR\s+/, '').trim().slice(0, 300)
        if (state.foundUrl && connected && !checkingDns) goLiveOnceResolvable()
      }
    }
    child.stdout.on('data', onOutput)
    child.stderr.on('data', onOutput)
    setTimeout(() => {
      if (store.state !== state || state.status !== 'starting') return
      if (state.foundUrl) return update(state, { status: 'live', publicUrl: state.foundUrl, error: null })
      fail(state, `No tunnel URL within ${URL_TIMEOUT_MS / 1000} s${lastError ? `: ${lastError}` : ''}`)
    }, URL_TIMEOUT_MS)
    child.on('error', error => fail(state, error.code === 'ENOENT' ? 'cloudflared is not installed (brew install cloudflared)' : error.message))
    child.on('exit', code => fail(state, `cloudflared exited (code ${code})${lastError ? `: ${lastError}` : ''}`))
  }

  function startTunnel({ ports, project }) {
    if (store.state?.running && store.state.status !== 'error') return
    const shortLinks = runningShortLinks(shortLinksFile)
    const lanHost = projectTunnelConfig(project)?.lanHost
    const localHosts = localHostsFor(lanHost, shortLinks)
    const primaryPort = ports[0] ?? null
    const appHost = lanHost && lanHost !== 'auto' ? lanHost : (shortLinks?.host ?? lanAddresses()[0] ?? 'localhost')
    const routes = Object.fromEntries(ports.map(port => [port, port === primaryPort ? '' : `/__svc/${port}`]))
    if (shortLinks) routes[shortLinks.port] = '/__qr'
    const services = [
      ...ports.map(port => ({ port, label: port === primaryPort ? 'app' : null, localUrl: `http://localhost:${port}`, path: routes[port] })),
      ...(shortLinks ? [{ port: shortLinks.port, label: 'QR short links', localUrl: `http://127.0.0.1:${shortLinks.port}`, path: '/__qr' }] : []),
    ]
    const state = {
      ...STOPPED,
      running: true,
      startedAt: new Date().toISOString(),
      status: 'starting',
      project,
      daemonPid: process.pid,
      localHosts,
      routes,
      services,
      pids: [],
    }
    store.state = state
    save()
    startProxy(state, {
      primaryPort,
      ports,
      shortLinks: shortLinks ? { host: shortLinks.host, port: shortLinks.port } : null,
      localHosts,
      appOrigin: primaryPort ? `http://${appHost}:${primaryPort}` : null,
    })
  }

  function stopChildren() {
    const children = store.children
    store.children = []
    return Promise.all(children.map(stopChild))
  }

  async function stopTunnel() {
    store.state = { ...STOPPED }
    save()
    await stopChildren()
  }

  return {
    name: 'plan-tunnel-api',
    configureServer(server) {
      server.middlewares.use('/api/tunnels', (req, res, next) => {
        const [path, query] = (req.url || '').replace(/^\//, '').split('?')
        res.setHeader('content-type', 'application/json')
        if (req.method === 'GET' && path === '') {
          const project = new URLSearchParams(query || '').get('project')
          return res.end(JSON.stringify({ ...publicState(store.state ?? STOPPED), config: projectTunnelConfig(project) }))
        }
        if (req.method === 'POST' && path === 'stop') {
          stopTunnel().then(() => res.end(JSON.stringify(publicState(STOPPED))))
          return
        }
        if (req.method === 'POST' && path === 'start') {
          let body = ''
          req.on('data', c => (body += c))
          req.on('end', () => {
            const json = (() => { try { return JSON.parse(body || '{}') } catch { return {} } })()
            const project = typeof json.project === 'string' ? json.project : null
            const ports = Array.isArray(json.ports) ? json.ports : (projectTunnelConfig(project)?.ports ?? [])
            const invalid = ports.length > MAX_PORTS || ports.some(p => !Number.isInteger(p) || p < 1 || p > 65535)
            if (invalid) { res.statusCode = 400; return res.end(JSON.stringify({ error: `ports must be up to ${MAX_PORTS} port numbers` })) }
            // The daemon's fs.allow spans the whole store and every project root; never publish it.
            if (ports.includes(daemonPort)) { res.statusCode = 400; return res.end(JSON.stringify({ error: `port ${daemonPort} is the pages daemon and is never tunnelled` })) }
            startTunnel({ ports: [...new Set(ports)], project })
            res.end(JSON.stringify(publicState(store.state)))
          })
          return
        }
        next()
      })
    },
  }
}

// The short-link server's address through the tunnel while it is live, or null; for /api/short-links.
export function tunnelledShortLinkBase() {
  const state = store.state
  if (!state?.running || state.status !== 'live' || !state.publicUrl) return null
  return Object.values(state.routes).includes('/__qr') ? `${state.publicUrl}/__qr` : null
}

function publicState(state) {
  return {
    running: state.running,
    startedAt: state.startedAt,
    status: state.status,
    publicUrl: state.status === 'live' ? state.publicUrl : null,
    error: state.error,
    localHosts: state.localHosts,
    routes: state.routes,
    services: state.services,
  }
}

function stopChild(child) {
  return new Promise(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    const force = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, STOP_GRACE_MS)
    child.once('exit', () => { clearTimeout(force); done() })
    try { child.kill('SIGTERM') } catch { clearTimeout(force); done() }
  })
}

// A daemon killed with SIGKILL leaves its children running; the next daemon finds them in the
// state file. Only pids still running cloudflared or the tunnel proxy are killed, in case of reuse.
function killOrphanedProcesses(stateFile) {
  if (store.children.length > 0) return
  const previous = readJson(stateFile)
  store.state = null
  for (const pid of previous?.pids ?? []) {
    try {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' })
      if (/cloudflared|tunnel-proxy\.mjs/.test(command)) process.kill(pid, 'SIGKILL')
    } catch {}
  }
  writeFileSync(stateFile, JSON.stringify(STOPPED, null, 2))
}

function runningShortLinks(file) {
  const state = readJson(file)
  if (!state?.base || !state?.pid) return null
  try {
    process.kill(state.pid, 0)
    return { base: state.base, host: state.host, port: Number(state.port) }
  } catch {
    return null
  }
}

// Hosts whose http://<host>:<routed port> URLs go through the tunnel: loopback, this Mac's LAN
// addresses (or the configured lanHost) and the short-link server's host.
function localHostsFor(lanHost, shortLinks) {
  const lan = lanHost && lanHost !== 'auto' ? [lanHost] : lanAddresses()
  return [...new Set(['localhost', '127.0.0.1', '[::1]', ...lan, ...(shortLinks ? [shortLinks.host] : [])])]
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address)
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}
