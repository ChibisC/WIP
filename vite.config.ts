import { defineConfig } from 'vite';

// The same cross-origin isolation headers as the Netlify deploy (public/_headers), so the dev
// server exercises the SharedArrayBuffer path of the simulation worker. Set COI=0 to try the
// transferable fallback that GitHub Pages uses.
const isolation = process.env.COI === '0' ? {} : { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, headers: isolation },
  preview: { headers: isolation },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
});
