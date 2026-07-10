const { resolve } = require('node:path')
const here = __dirname
const repo = resolve(here, '../../..')

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    resolve(here, 'index.html'),
    resolve(here, 'src/**/*.{ts,tsx}'),
    resolve(here, '../*.page.tsx'),
    resolve(here, '../*.plan.tsx'), // legacy extension
    resolve(here, '../templates/*.page.tsx'), // templates subdir
    // page-adjacent component subdirs (e.g. notes/pages/<feature>-ideas/*.tsx) — pages may
    // import sibling-folder components; without this their Tailwind classes never generate
    resolve(here, '../*/*.{ts,tsx}'),
    // real components plans may import, so their utility classes get generated
    resolve(repo, 'packages/catalyst-ui-kit/src/**/*.{ts,tsx}'),
    resolve(repo, 'apps/web/src/components/**/*.{ts,tsx}'),
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
