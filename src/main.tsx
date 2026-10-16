import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App'

// Modo de teste (só em desenvolvimento): /?griddemo=5 mostra a grade da chamada com 5 telas simuladas.
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('griddemo') : null
// Janela secundária do app desktop: /?mini=1
const isMini = new URLSearchParams(location.search).get('mini') === '1'
const Mini = isMini ? (await import('./components/music/MiniPlayer')).MiniPlayer : null
const Demo = demo ? (await import('./dev/GridDemo')).GridDemo : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Mini ? <Mini /> : Demo ? <Demo n={Math.max(1, Math.min(40, Number(demo) || 2))} /> : <App />}
  </StrictMode>,
)
