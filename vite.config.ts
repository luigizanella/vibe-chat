import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

const BUILD_TIME = new Date().toISOString()

/** Emite /version.json em cada build: o app web compara com a versão carregada e se atualiza sozinho. */
const versionJson = (): Plugin => ({
  name: 'vibe-version-json',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: pkg.version, build: BUILD_TIME }) })
  },
})

// Tauri espera porta fixa e não limpa a tela do terminal.
export default defineConfig({
  plugins: [react(), tailwindcss(), versionJson()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/livekit-client')) return 'livekit'
          if (id.includes('node_modules/@supabase')) return 'supabase'
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) return 'react'
          return undefined
        },
      },
    },
  },
})
