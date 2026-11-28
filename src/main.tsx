import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { requestPersistentStorage } from './data/storageGuard'
import { ensureExerciseLibrary } from './data/db'

const ARTIFACT = import.meta.env.MODE === 'artifact'
if (!ARTIFACT) registerSW({
  immediate: true,
  // procura versão nova ao voltar para o app e a cada 30 min (a atualização chega sem precisar reinstalar)
  onRegisteredSW(_url, r) {
    if (!r) return
    const check = () => { if (navigator.onLine) void r.update().catch(() => undefined) }
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
    setInterval(check, 30 * 60 * 1000)
  },
})
// guarda os dados do aparelho de forma permanente (o navegador não apaga para liberar espaço)
void requestPersistentStorage()
void ensureExerciseLibrary()
const Router = ARTIFACT ? MemoryRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)

// tira a tela de abertura: fica pelo menos 1,4 s para a cena aparecer (toque para pular)
{
  const sp = document.getElementById('splash')
  if (sp) {
    const hide = () => { sp.style.opacity = '0'; setTimeout(() => sp.remove(), 500) }
    sp.addEventListener('click', hide, { once: true })
    setTimeout(hide, Math.max(0, 1400 - performance.now()))
  }
}
