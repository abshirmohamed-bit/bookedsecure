// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from '@lovable.dev/mcp-js/stacks/tanstack/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  vite: { plugins: [mcpPlugin(), VitePWA({
    strategies: 'generateSW',
    filename: 'sw.js',
    outDir: 'dist/client',
    registerType: 'autoUpdate',
    injectRegister: null,
    manifest: false,
    devOptions: { enabled: false },
    includeAssets: ['icon-192.png', 'icon-512.png', 'favicon.png'],
    workbox: {
      globDirectory: 'dist/client',
      globPatterns: ['assets/**/*.{js,css,woff2}'],
      additionalManifestEntries: [{ url: '/offline.html', revision: null }],
      cleanupOutdatedCaches: true,
      skipWaiting: true,
      clientsClaim: true,
      navigateFallback: undefined,
      runtimeCaching: [
        {
          urlPattern: ({ request, url }) => request.mode === 'navigate' && url.origin === self.location.origin && !/^\/(?:~oauth|api)(?:\/|$)/.test(url.pathname),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'bookedsecure-navigation',
            // Never persist authenticated HTML or customer data. Only static
            // page code is cached; an explicit offline document is the fallback.
            plugins: [{ cacheWillUpdate: async () => null, handlerDidError: async () => (await caches.match('/offline.html')) ?? Response.error() }],
          },
        },
        {
          urlPattern: ({ url }) => url.origin === self.location.origin && /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(?:js|css|woff2)$/.test(url.pathname),
          handler: 'CacheFirst',
          options: { cacheName: 'bookedsecure-static-assets', expiration: { maxEntries: 150, maxAgeSeconds: 30 * 24 * 60 * 60 }, cacheableResponse: { statuses: [200] } },
        },
      ],
    },
  })] },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
