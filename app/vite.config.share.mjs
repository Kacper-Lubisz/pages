import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Static-export build for ONE plan (driven by share.mjs). The root is a generated build dir
// containing index.html (with baked __PAGE_STATE__/__PAGE_GH__/__PAGE_SHARE__ globals) and an
// entry.tsx that imports the single target plan by absolute path — so other plans never ship.
// Mirrors the dev config's aliases; __PAGE_STATIC__ flips page-ui into snapshot mode (no dev
// APIs, no ShareBar). base './' keeps the bundle relocatable under any /<slug>/ subpath.
const here = import.meta.dirname // notes/pages/.app
const repo = resolve(here, '../../..')

const buildDir = process.env.PAGE_BUILD_DIR
const outDir = process.env.PAGE_OUT_DIR
if (!buildDir || !outDir) throw new Error('PAGE_BUILD_DIR and PAGE_OUT_DIR are required (run via share.mjs)')

export default defineConfig({
  root: buildDir,
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  define: { __PAGE_STATIC__: 'true' },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@page': resolve(here, 'src/lib/page-ui.tsx'),
      '@plan': resolve(here, 'src/lib/page-ui.tsx'), // legacy import specifier
      'next/link': resolve(here, 'src/stubs/next-link.tsx'),
      '@': resolve(repo, 'apps/web/src'),
    },
  },
  css: { postcss: here }, // .app's postcss/tailwind config (absolute content globs cover the plans)
  build: {
    outDir,
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
})
