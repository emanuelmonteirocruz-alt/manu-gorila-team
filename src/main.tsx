import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, MemoryRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { requestPersistentStorage } from './data/storageGuard'

const ARTIFACT = import.meta.env.MODE === 'artifact'
if (!ARTIFACT) registerSW({ immediate: true })
// guarda os dados do aparelho de forma permanente (o navegador não apaga para liberar espaço)
void requestPersistentStorage()
const Router = ARTIFACT ? MemoryRouter : BrowserRouter

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
)
