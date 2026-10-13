// @ts-check
import { defineConfig } from 'astro/config';

// Static site. Deploys to Vercel with zero config (framework: Astro, output: dist).
export default defineConfig({
  site: 'https://kuas-photography-club.vercel.app',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  vite: {
    build: {
      // three.js is a large single dependency; it is only loaded by pages that use WebGL.
      chunkSizeWarningLimit: 900,
    },
  },
});
