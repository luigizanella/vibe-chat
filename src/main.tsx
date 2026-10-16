import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/theme.css'
import App from './App'

// Modo de teste (só em desenvolvimento): /?griddemo=5 mostra a grade da chamada com 5 telas simuladas.
const demo = import.meta.env.DEV ? new URLSearchParams(location.search).get('griddemo') : null
const Demo = demo ? (await import('./dev/GridDemo')).GridDemo : null

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Demo ? <Demo n={Math.max(1, Math.min(40, Number(demo) || 2))} /> : <App />}
  </StrictMode>,
)
