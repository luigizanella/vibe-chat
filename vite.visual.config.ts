import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'

/**
 * Configuração SÓ para inspeção visual local: injeta tests/visual/mock.js no index.html
 * (backend simulado no navegador). Não é usada em build/deploy.
 */
export default mergeConfig(
  base,
  defineConfig({
    server: { port: 5174, strictPort: true },
    // aponta o app para o backend SIMULADO (ignora o .env real)
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://127.0.0.1:54321'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('visual-mock'),
    },
    plugins: [
      {
        name: 'visual-mock',
        transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/tests/visual/mock.js' }, injectTo: 'head-prepend' }],
      },
    ],
  }),
)
