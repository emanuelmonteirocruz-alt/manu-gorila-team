import { lazy, Suspense, useEffect, useState } from 'react'
import { Dumbbell, FileText, History as HistoryIcon, LayoutDashboard, MessageSquare, Settings as SettingsIcon, Smartphone, Users, Wifi, WifiOff } from 'lucide-react'
import { NavLink, Route, Routes } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { installAutoSync, type SyncResult } from './data/sync'
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

const NAV = [
  { to: '/', label: 'Painel', icon: LayoutDashboard },
  { to: '/presencial', label: 'Presencial', icon: Dumbbell },
  { to: '/alunos', label: 'Alunos', icon: Users },
  { to: '/consultoria-alunos', label: 'Consultoria', icon: Smartphone },
  { to: '/consultoria', label: 'Colar WhatsApp', icon: MessageSquare },
  { to: '/historico', label: 'Histórico', icon: HistoryIcon },
  { to: '/relatorios', label: 'Relatórios PDF', icon: FileText },
  { to: '/config', label: 'Config.', icon: SettingsIcon },
]

export default function App() {
  const [sync, setSync] = useState<SyncResult | null>(null)
  const [online, setOnline] = useState(navigator.onLine)
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
          <NavLink key={n.to} to={n.to} end={n.to === '/'}>
            <n.icon size={18} strokeWidth={1.8} aria-hidden />
            {n.label}
            {n.to === '/consultoria-alunos' && changeCount > 0 && <span className="badge" title="Trocas de treino pendentes">{changeCount}</span>}
          </NavLink>
        ))}
        <div className="sync">
          <span className="row" style={{ gap: 6 }}>{online ? <Wifi size={13} /> : <WifiOff size={13} />}{online ? 'Online' : 'Offline (salvando local)'}</span>
          <br />
          {sync?.error ?? (sync ? `Sincronizado · ${sync.pushed} enviados · ${sync.pulled} recebidos` : '')}
        </div>
      </nav>
      <main>
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
