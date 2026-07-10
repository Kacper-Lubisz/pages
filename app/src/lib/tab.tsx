/* tab — per-plan browser-tab identity so several open plans are tellable apart.
   Authors may set `meta.icon` (an emoji); otherwise a deterministic colored
   letter-badge is derived from the slug. Both the favicon and the index <Glyph>
   render from the same logic, so the tab and the list agree. */

export function slugHue(slug: string) {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0
  return h % 360
}

function escapeXml(s: string) {
  return s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] as string)
}

function letterOf(title: string | undefined, slug: string) {
  return ((title || slug).trim()[0] || '•').toUpperCase()
}

function faviconDataUri({ icon, title, slug }: { icon?: string; title?: string; slug: string }) {
  const inner = icon
    ? `<text x="32" y="50" font-size="52" text-anchor="middle">${escapeXml(icon)}</text>`
    : `<rect width="64" height="64" rx="14" fill="hsl(${slugHue(slug)} 62% 48%)"/>` +
      `<text x="32" y="45" font-size="38" font-family="system-ui,sans-serif" font-weight="700" fill="#fff" text-anchor="middle">${escapeXml(letterOf(title, slug))}</text>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`
  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

export function setTab({ icon, title, slug }: { icon?: string; title?: string; slug: string }) {
  document.title = title || slug
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = faviconDataUri({ icon, title, slug })
}

/* React badge for the index list — mirrors the favicon visual. */
export function Glyph({ icon, title, slug, size = 30 }: { icon?: string; title?: string; slug: string; size?: number }) {
  if (icon) return <span className="leading-none" style={{ fontSize: size * 0.82 }}>{icon}</span>
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5, background: `hsl(${slugHue(slug)} 62% 48%)` }}
    >
      {letterOf(title, slug)}
    </span>
  )
}
