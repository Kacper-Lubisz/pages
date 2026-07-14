const { resolve } = require('node:path')
const { readFileSync } = require('node:fs')
const here = __dirname

// Central store: JIT must scan the sources of any real project components a bound page imports.
// A single daemon serves pages from many projects, so `content` is the UNION of every registered
// project's Tailwind globs (from .config/projects.json) plus the pages/templates themselves.
// Over-generates slightly across projects; JIT is fast enough and correctness beats minimalism.
const registry = (() => {
  try { return JSON.parse(readFileSync(resolve(here, '../.config/projects.json'), 'utf8')) } catch { return {} }
})()
const projectContent = Object.values(registry).flatMap(p =>
  p && p.root && Array.isArray(p.tailwindContent)
    ? p.tailwindContent.map(g => resolve(p.root, g))
    : [],
)

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    resolve(here, 'index.html'),
    resolve(here, 'src/**/*.{ts,tsx}'),
    resolve(here, '../*.page.tsx'),
    resolve(here, '../*.plan.tsx'), // legacy extension
    resolve(here, '../templates/*.page.tsx'), // templates subdir
    // page-adjacent component subdirs (e.g. notes/pages/<feature>-ideas/*.tsx, and project
    // subdirs' pages) — without this their Tailwind classes never generate
    resolve(here, '../*/*.{ts,tsx}'),
    // union of registered projects' component sources (real components bound pages import)
    ...projectContent,
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
}
