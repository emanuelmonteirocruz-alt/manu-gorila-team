import { lazy, Suspense, useEffect, useState } from 'react'
import { Dumbbell, FileText, History as HistoryIcon, LayoutDashboard, MessageSquare, Settings as SettingsIcon, Smartphone, Users, Wifi, WifiOff, Cloud, CloudOff, Menu, X } from 'lucide-react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { installAutoSync, type SyncResult } from './data/sync'
import { storageWarning } from './data/storageGuard'
import { getBrand } from './data/brand'
import { Emblem } from './ui/components/Emblem'
import { db } from './data/db'
import { changeStatus } from './domain/plan'
const Dashboard = lazy(() => import('./ui/pages/Dashboard'))
const Students = lazy(() => import('./ui/pages/Students'))
const StudentDetail = lazy(() => import('./ui/pages/StudentDetail'))
const ImportWhatsApp = lazy(() => import('./ui/pages/ImportWhatsApp'))
const InPerson = lazy(() => import('./ui/pages/InPerson'))
const Reports = lazy(() => import('./ui/pages/Reports'))
const History = lazy(() => import('./ui/pages/History'))
const Consultancy = lazy(() => import('./ui/pages/Consultancy'))
const Settings = lazy(() => import('./ui/pages/Settings'))

// main: aparece na barra de baixo do celular; o resto fica em "Mais"
const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard, main: true },
  { to: '/presencial', label: 'Presencial', icon: Dumbbell, main: true },
  { to: '/consultoria-alunos', label: 'Consultoria', icon: Smartphone, main: true },
  { to: '/alunos', label: 'Alunos', icon: Users, main: true },
  { to: '/consultoria', label: 'Colar WhatsApp', icon: MessageSquare },
  { to: '/historico', label: 'Histórico', icon: HistoryIcon },
  { to: '/relatorios', label: 'Relatórios PDF', icon: FileText },
  { to: '/config', label: 'Config.', icon: SettingsIcon },
]

/** Estado REAL da nuvem (o "Online" antigo só dizia que havia internet). */
function CloudStatus({ sync }: { sync: SyncResult | null }) {
  if (!sync) return <span>Nuvem: verificando…</span>
  if (sync.state === 'ok') return <span className="row" style={{ gap: 6 }}><Cloud size={13} /> Nuvem sincronizada {new Date(sync.at!).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
  if (sync.state === 'local') return <span className="row" style={{ gap: 6 }}><CloudOff size={13} /> Só neste aparelho</span>
  if (sync.state === 'offline') return <span className="row" style={{ gap: 6 }}><CloudOff size={13} /> Nuvem: aguardando internet</span>
  return <NavLink to="/config" className="cloud-alert"><CloudOff size={13} /> {sync.state === 'login' ? 'Nuvem desconectada: entrar' : sync.error}</NavLink>
}

export default function App() {
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
  const [moreOpen, setMoreOpen] = useState(false)
  const [storeWarn] = useState(storageWarning)
  const loc = useLocation()
  const brand = useLiveQuery(getBrand, [])
  const changeCount = useLiveQuery(async () => (await db.students.toArray()).filter((s) => !s._deleted && !s.archived && changeStatus(s)).length, []) ?? 0
  // cores da marca nos destaques do painel (o restante da estética fica igual)
  useEffect(() => {
    if (!brand) return
    const r = document.documentElement.style
    // vermelho (destaque) nos botões e ações; grafite (principal) nos detalhes
    r.setProperty('--accent', brand.accent)
    r.setProperty('--heavy', brand.accent)
    r.setProperty('--brand-accent', brand.accent)
    r.setProperty('--brand-primary', brand.primary)
  }, [brand])
  useEffect(() => {
    const on = () => setOnline(navigator.onLine)
    window.addEventListener('online', on)
    window.addEventListener('offline', on)
    const off = installAutoSync(setSync)
    return () => {
      off()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', on)
    }
  }, [])
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          {brand?.logo ? <img src={brand.logo} alt="" /> : <Emblem />}
          <div>{brand?.name || 'Manu Gorila Team'}<small>Consultoria & Presencial</small></div>
        </div>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={n.main ? 'main' : 'extra'}>
            <n.icon size={18} strokeWidth={1.8} aria-hidden />
            {n.label}
            {n.to === '/consultoria-alunos' && changeCount > 0 && <span className="badge" title="Trocas de treino pendentes">{changeCount}</span>}
          </NavLink>
        ))}
        <button className={`nav-more ${moreOpen || NAV.some((n) => !n.main && loc.pathname.startsWith(n.to)) ? 'active' : ''}`} onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen}>
          {moreOpen ? <X size={18} strokeWidth={1.8} aria-hidden /> : <Menu size={18} strokeWidth={1.8} aria-hidden />}Mais
        </button>
        <div className="sync">
          <span className="row" style={{ gap: 6 }}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? 'Internet ok' : 'Offline (salvando local)'}</span>
          <br />
          <CloudStatus sync={sync} />
        </div>
      </nav>
      {moreOpen && (
        <div className="more-sheet" onClick={() => setMoreOpen(false)}>
          <div className="more-panel" onClick={(e) => e.stopPropagation()}>
            {NAV.filter((n) => !n.main).map((n) => (
              <NavLink key={n.to} to={n.to} onClick={() => setMoreOpen(false)}><n.icon size={20} strokeWidth={1.8} aria-hidden />{n.label}</NavLink>
            ))}
            <div className="more-status"><CloudStatus sync={sync} /></div>
          </div>
        </div>
      )}
      <main>
        {storeWarn && <div className="cloud-banner">{storeWarn}</div>}
        {(sync?.state === 'login' || sync?.state === 'error') && (
          loc.pathname.startsWith('/presencial')
            // no meio do treino o aviso não leva para outra tela (nada se perde; o treino fica salvo no aparelho)
            ? <div className="cloud-banner"><CloudOff size={16} strokeWidth={1.8} /> {sync.state === 'login' ? 'Nuvem desconectada — o treino fica salvo no aparelho.' : 'Nuvem com erro — o treino continua salvo no aparelho e sobe depois.'}</div>
            : <NavLink to="/config" className="cloud-banner"><CloudOff size={16} strokeWidth={1.8} /> {sync.state === 'login' ? 'Nuvem desconectada neste aparelho: toque para entrar como treinador (só uma vez).' : `Nuvem com erro: ${sync.error}`}</NavLink>
        )}
        <Suspense fallback={<div className="muted">Carregando…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/alunos" element={<Students />} />
          <Route path="/alunos/:id" element={<StudentDetail />} />
          <Route path="/consultoria" element={<ImportWhatsApp />} />
          <Route path="/presencial" element={<InPerson />} />
          <Route path="/consultoria-alunos" element={<Consultancy />} />
          <Route path="/historico" element={<History />} />
          <Route path="/relatorios" element={<Reports />} />
          <Route path="/config" element={<Settings />} />
        </Routes>
        </Suspense>
      </main>
    </div>
  )
}
