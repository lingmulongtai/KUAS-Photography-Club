// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sitemap from '@astrojs/sitemap';

// Static site on Vercel. Everything is prerendered except the admin API (src/pages/api/admin/),
// which runs as Vercel functions.
export default defineConfig({
  site: 'https://kuas-photography-club.vercel.app',
  adapter: vercel(),
  integrations: [sitemap({
    // Only prerendered public pages; never advertise admin/API/error routes.
    filter: (page) => !/^\/(?:admin(?:\/|$)|api(?:\/|$)|404(?:\.html|\/|$)|admin-build\.json)/.test(new URL(page).pathname),
  })],
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    build: {
      // three.js is a large single dependency; it is only loaded by pages that use WebGL.
      chunkSizeWarningLimit: 900,
    },
  },
});
