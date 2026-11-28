import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// `vite build --mode artifact` gera um arquivo único para a visualização hospedada (sem service worker).
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact'
  return {
    base: artifact ? './' : '/',
    resolve: artifact ? { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/artifact/pwa-stub.ts', import.meta.url)) } } : {},
    build: artifact ? { outDir: 'dist-artifact', rolldownOptions: { output: { codeSplitting: false } } } : {},
    plugins: [
      react(),
      !artifact && VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'apple-touch-icon.png'],
        manifest: {
          name: 'Manu Team — Consultoria & Presencial',
          short_name: 'Manu Team',
          description: 'Gestão técnica, financeira e analítica — Emanuel Monteiro · Manu Team',
          lang: 'pt-BR',
          theme_color: '#F8FAFC',
          background_color: '#000000', // abertura do Android: fundo preto se funde com o ícone preto (tela cheia da marca)
          display: 'standalone',
          orientation: 'any', // rotação livre; layout otimizado para paisagem (tablet)
          start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        },
        // 2 MB padrão é pouco para o bundle com jsPDF + Supabase
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp}'], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, navigateFallback: '/index.html',
          // fonte guardada no aparelho: abre rápido mesmo sem internet
          runtimeCaching: [
            { urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i, handler: 'StaleWhileRevalidate', options: { cacheName: 'google-fonts-css' } },
            { urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i, handler: 'CacheFirst', options: { cacheName: 'google-fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } } },
          ],
        },
      }),
    ],
    test: { environment: 'node' },
  } as never
})
