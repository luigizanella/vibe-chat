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
    plugins: [
      {
        name: 'visual-mock',
        transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/tests/visual/mock.js' }, injectTo: 'head-prepend' }],
      },
    ],
  }),
)
