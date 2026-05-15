import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'icons/icon-192.svg',
        'icons/icon-512.svg',
        'icons/icon-192.png',
        'icons/icon-512.png',
        'screenshots/dashboard-wide.png',
        'screenshots/findings-mobile.png'
      ],
      manifest: {
        name: 'SignalScope SETI',
        short_name: 'SignalScope',
        id: './',
        description:
          'Citizen-science PWA inspired by SETI@home — donate idle compute to analyze public radio-astronomy datasets.',
        theme_color: '#0b1020',
        background_color: '#05070f',
        display: 'standalone',
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['education', 'science', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          { src: 'icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any' }
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            short_name: 'Dashboard',
            description: 'Start or pause radio-data analysis.',
            url: './#/',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
          },
          {
            name: 'Findings',
            short_name: 'Findings',
            description: 'Review candidate signals and export findings.',
            url: './#/findings',
            icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }]
          }
        ],
        screenshots: [
          {
            src: 'screenshots/dashboard-wide.png',
            sizes: '1280x720',
            type: 'image/png',
            form_factor: 'wide',
            label: 'SignalScope dashboard and analysis waterfall'
          },
          {
            src: 'screenshots/findings-mobile.png',
            sizes: '390x844',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Candidate findings and AI triage view'
          }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === 'document',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'pages',
              networkTimeoutSeconds: 4
            }
          }
        ]
      }
    })
  ],
  worker: {
    format: 'es'
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('node_modules/three')) return 'three-vendor';
          if (normalized.includes('node_modules/@react-three')) return 'r3f-vendor';
          return undefined;
        }
      }
    }
  }
});
