#!/usr/bin/env node
// tunnel-proxy — the single origin behind the pages daemon's HTTPS tunnel (app/tunnel-api.mjs
// starts it, then points one Cloudflare quick tunnel at it). Lets a phone use a plain-http LAN dev
// stack over HTTPS without restarting or changing it.
//
//   node .page-assets/tunnel-proxy.mjs '<config json>'
//   config: { primaryPort, ports, shortLinks: { host, port } | null, localHosts, appOrigin }
//
// Routes:  /__svc/<port>/…  → http://127.0.0.1:<port>/…   (only the configured ports)
//          /__qr/…          → the QR short-link server
//          anything else    → the primary port (the app)
//
// Upstreams see Host: localhost:<port> (Vite's host check) and Origin/Referer as the app's own LAN
// origin (CORS and origin checks). Location headers that point at a routed local address are
// rewritten onto this origin, Set-Cookie loses Domain=, and HTML from the primary gets a script,
// first in <head>, that sends the app's absolute local URLs (fetch, XHR, WebSocket, EventSource,
// sendBeacon, iframe/img/script src) through /__svc/<port> instead. Prints {"port":N} once listening.
import http from 'node:http'
import zlib from 'node:zlib'

const config = JSON.parse(process.argv[2] || '{}')
const routes = {}
for (const port of config.ports ?? []) routes[port] = port === config.primaryPort ? '' : `/__svc/${port}`
if (config.shortLinks) routes[config.shortLinks.port] = '/__qr'
const SVC_PATH = /^\/__svc\/(\d+)(.*)$/
const QR_PATH = /^\/__qr(.*)$/

function upstreamFor(url) {
  const svc = url.match(SVC_PATH)
  if (svc) {
    const port = Number(svc[1])
    if (!config.ports.includes(port)) return null
    return { host: '127.0.0.1', port, path: pathFrom(svc[2]), prefix: `/__svc/${port}`, primary: false }
  }
  const qr = url.match(QR_PATH)
  if (qr) {
    if (!config.shortLinks) return null
    return { host: config.shortLinks.host, port: config.shortLinks.port, path: pathFrom(qr[1]), prefix: '/__qr', primary: false }
  }
  if (!config.primaryPort) return null
  return { host: '127.0.0.1', port: config.primaryPort, path: url, prefix: '', primary: true }
}

const pathFrom = rest => (rest === '' ? '/' : rest.startsWith('/') ? rest : `/${rest}`)

function publicOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  return `${proto}://${req.headers.host}`
}

// The local URL's address on this origin, or the URL unchanged when it isn't a routed local one.
function publicUrlFor(target, origin) {
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return target
  }
  if (parsed.protocol !== 'http:' || !config.localHosts.includes(parsed.hostname)) return target
  const prefix = routes[Number(parsed.port || 80)]
  if (prefix === undefined) return target
  return `${origin}${prefix}${parsed.pathname}${parsed.search}${parsed.hash}`
}

function rewriteLocation(location, origin, upstream) {
  if (location.startsWith('/') && !location.startsWith('//')) return `${upstream.prefix}${location}`
  return publicUrlFor(location, origin)
}

function upstreamHeaders(req, upstream, origin) {
  const headers = { ...req.headers, host: `localhost:${upstream.port}` }
  if (config.appOrigin) {
    if (headers.origin === origin) headers.origin = config.appOrigin
    // The app called this service cross-origin, which always sends Origin; through the tunnel it
    // is same-origin and a GET carries none, which origin-checking services reject.
    if (!headers.origin && !upstream.primary && upstream.prefix.startsWith('/__svc/')) headers.origin = config.appOrigin
    if (typeof headers.referer === 'string' && headers.referer.startsWith(origin)) headers.referer = config.appOrigin + headers.referer.slice(origin.length)
  }
  if (upstream.primary) headers['accept-encoding'] = 'identity'
  return headers
}

function responseHeaders(upstreamRes, origin, upstream) {
  const headers = { ...upstreamRes.headers }
  if (headers.location) headers.location = rewriteLocation(headers.location, origin, upstream)
  if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map(cookie => cookie.replace(/;\s*domain=[^;]*/gi, ''))
  return headers
}

const server = http.createServer((req, res) => {
  const upstream = upstreamFor(req.url || '/')
  if (!upstream) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not routed by the tunnel proxy.')
    return
  }
  const origin = publicOrigin(req)
  const proxyReq = http.request(
    { host: upstream.host, port: upstream.port, path: upstream.path, method: req.method, headers: upstreamHeaders(req, upstream, origin) },
    upstreamRes => {
      const headers = responseHeaders(upstreamRes, origin, upstream)
      const isHtml = upstream.primary && /text\/html/i.test(String(headers['content-type'] || ''))
      if (!isHtml) {
        res.writeHead(upstreamRes.statusCode || 502, headers)
        upstreamRes.pipe(res)
        return
      }
      const chunks = []
      upstreamRes.on('data', chunk => chunks.push(chunk))
      upstreamRes.on('end', () => {
        const html = decode(Buffer.concat(chunks), headers['content-encoding']).toString('utf8')
        const body = Buffer.from(injectShim(html))
        delete headers['content-encoding']
        headers['content-length'] = String(body.length)
        res.writeHead(upstreamRes.statusCode || 200, headers)
        res.end(body)
      })
    },
  )
  proxyReq.on('error', error => {
    if (res.headersSent) return res.destroy()
    res.writeHead(502, { 'content-type': 'text/plain' }).end(`Tunnel proxy: port ${upstream.port} is not answering (${error.code}).`)
  })
  req.pipe(proxyReq)
})

server.on('upgrade', (req, socket, head) => {
  const upstream = upstreamFor(req.url || '/')
  if (!upstream) return socket.destroy()
  const origin = publicOrigin(req)
  const proxyReq = http.request({ host: upstream.host, port: upstream.port, path: upstream.path, method: req.method, headers: upstreamHeaders(req, upstream, origin) })
  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`]
    for (let i = 0; i < proxyRes.rawHeaders.length; i += 2) lines.push(`${proxyRes.rawHeaders[i]}: ${proxyRes.rawHeaders[i + 1]}`)
    socket.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (proxyHead.length) socket.write(proxyHead)
    if (head.length) proxySocket.write(head)
    proxySocket.on('error', () => socket.destroy())
    socket.on('error', () => proxySocket.destroy())
    proxySocket.pipe(socket).pipe(proxySocket)
  })
  proxyReq.on('response', proxyRes => {
    socket.end(`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}\r\n\r\n`)
  })
  proxyReq.on('error', () => socket.destroy())
  proxyReq.end()
})

function decode(buffer, encoding) {
  switch (encoding) {
    case 'gzip':
      return zlib.gunzipSync(buffer)
    case 'br':
      return zlib.brotliDecompressSync(buffer)
    case 'deflate':
      return zlib.inflateSync(buffer)
    default:
      return buffer
  }
}

function injectShim(html) {
  const shim = `<script>(${patchLocalUrls.toString()})(${JSON.stringify({ hosts: config.localHosts, routes })})</script>`
  const head = html.match(/<head(\s[^>]*)?>/i)
  if (!head) return shim + html
  const at = head.index + head[0].length
  return html.slice(0, at) + shim + html.slice(at)
}

// Runs in the browser, before any of the app's own scripts.
function patchLocalUrls({ hosts, routes }) {
  const LOCAL_URL = /^(https?|wss?):\/\/([^/:?#]+|\[[^\]]+\]):(\d+)(.*)$/i
  const rewrite = value => {
    if (typeof value !== 'string' && !(value instanceof URL)) return value
    const match = String(value).match(LOCAL_URL)
    if (!match) return value
    const [, scheme, host, port, rest] = match
    const prefix = routes[port]
    if (prefix === undefined || !hosts.includes(host.toLowerCase())) return value
    const origin = /^ws/i.test(scheme) ? location.origin.replace(/^http/, 'ws') : location.origin
    if (prefix === '') return origin + rest
    return origin + prefix + (rest === '' ? '/' : rest.startsWith('/') ? rest : `/${rest}`)
  }
  const nativeFetch = window.fetch
  window.fetch = function (input, init) {
    if (input instanceof Request) {
      const url = rewrite(input.url)
      return nativeFetch.call(this, url === input.url ? input : new Request(url, input), init)
    }
    return nativeFetch.call(this, rewrite(input), init)
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, rewrite(url), ...rest)
  }
  const construct = Native => new Proxy(Native, { construct: (target, [url, ...args]) => new target(rewrite(url), ...args) })
  window.WebSocket = construct(window.WebSocket)
  if (window.EventSource) window.EventSource = construct(window.EventSource)
  if (navigator.sendBeacon) {
    const sendBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = (url, data) => sendBeacon(rewrite(url), data)
  }
  for (const Tag of [window.HTMLIFrameElement, window.HTMLImageElement, window.HTMLScriptElement]) {
    const src = Object.getOwnPropertyDescriptor(Tag.prototype, 'src')
    if (!src?.set) continue
    Object.defineProperty(Tag.prototype, 'src', { ...src, set(value) { src.set.call(this, rewrite(value)) } })
  }
  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    return setAttribute.call(this, name, String(name).toLowerCase() === 'src' ? rewrite(value) : value)
  }
}

server.listen(0, '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port }))
})
const stop = () => process.exit(0)
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
