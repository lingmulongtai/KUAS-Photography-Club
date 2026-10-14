// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Static site on Vercel. Everything is prerendered except the admin API (src/pages/api/admin/),
// which runs as Vercel functions.
export default defineConfig({
  site: 'https://kuas-photography-club.vercel.app',
  adapter: vercel(),
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    build: {
      // three.js is a large single dependency; it is only loaded by pages that use WebGL.
      chunkSizeWarningLimit: 900,
    },
  },
});
