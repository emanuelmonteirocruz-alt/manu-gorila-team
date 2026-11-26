import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCopy, Link2 as LinkIcon } from 'lucide-react'
import { useState } from 'react'
import { db, getKV, setKV } from '../../data/db'
import { saveFile } from '../../artifact/claude'
import { InstallApp } from '../components/InstallApp'
import { Emblem } from '../components/Emblem'
import SETUP_SQL from '../../../supabase/setup_completo.sql?raw'
import { DEFAULT_BRAND, getBrand, imageToLogo, isOfficialLogo, saveBrand } from '../../data/brand'
import { getSupabase, resetSupabaseClient, syncNow } from '../../data/sync'
import { saveTrainerProfile } from '../../engine/classifier'
import { MUSCLE_GROUPS, type ExerciseProfile } from '../../domain/types'
import { setTrainerLink } from '../../links/linkResolver'

export default function Settings() {
  const url = useLiveQuery(() => getKV('supabase_url', ''), [])
  const key = useLiveQuery(() => getKV('supabase_key', ''), [])
  const [email, setEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const cache = useLiveQuery(() => db.exerciseCache.toArray(), []) ?? []
  const links = useLiveQuery(() => db.links.toArray(), []) ?? []

  async function login() {
    resetSupabaseClient()
    const sb = await getSupabase()
    if (!sb) return setMsg('Informe URL e anon key.')
    const { error } = await sb.auth.signInWithPassword({ email, password: pwd })
    setMsg(error ? error.message : 'Treinador autenticado. Sincronizando…')
    if (!error) {
      const r = await syncNow()
      setMsg(r.error ?? `Sincronizado: ${r.pushed} enviados, ${r.pulled} recebidos.`)
    }
  }

  async function backup() {
    const data = Object.fromEntries(await Promise.all(db.tables.map(async (t) => [t.name, await t.toArray()])))
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    await saveFile(`em-treino-backup-${new Date().toISOString().slice(0, 10)}.json`, blob)
  }

  const shown = cache.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => (a.source === 'heuristic' ? -1 : 0) - (b.source === 'heuristic' ? -1 : 0) || a.name.localeCompare(b.name))

  return (
    <>
      <div className="page-head"><div><h1>Configurações</h1><div className="muted">Nuvem (Supabase), perfil do treinador e caches</div></div></div>
      <div className="grid cols-2"><BrandSection /><InstallApp /></div>
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card grid">
          <h2>Supabase (sincronização)</h2>
          <div className="muted">Opcional: só é preciso para usar o mesmo banco no tablet, no celular e no computador. Sem isso o app funciona normal neste aparelho.</div>
          <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Crie um projeto grátis em supabase.com (região São Paulo).</li>
            <li>Toque em <b>Copiar SQL de instalação</b> e cole no Supabase em <b>SQL Editor → New query → Run</b>.</li>
            <li>Em Authentication → Users, crie seu e-mail e senha (o 1º usuário vira Treinador).</li>
            <li>Em Project Settings → API, copie a URL e a anon key para os campos abaixo e entre.</li>
          </ol>
          <div className="row">
            <button className="btn" onClick={async () => {
              try { await navigator.clipboard.writeText(SETUP_SQL); setMsg('SQL copiado. Cole no SQL Editor do Supabase e toque em Run.') }
              catch { await saveFile('em-treino-setup-sql.txt', new Blob([SETUP_SQL], { type: 'text/plain' })) ; setMsg('Cópia bloqueada aqui — o arquivo SQL foi oferecido para salvar.') }
            }}><ClipboardCopy size={16} strokeWidth={1.8} /> Copiar SQL de instalação</button>
          </div>
          <label className="f">Project URL<input defaultValue={url} onBlur={(e) => { setKV('supabase_url', e.target.value.trim()); resetSupabaseClient() }} placeholder="https://xxxx.supabase.co" /></label>
          <label className="f">Anon key<input defaultValue={key} onBlur={(e) => { setKV('supabase_key', e.target.value.trim()); resetSupabaseClient() }} /></label>
          <div className="grid cols-2">
            <label className="f">E-mail do treinador<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label className="f">Senha<input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></label>
          </div>
          <div className="row">
            <button className="btn primary" onClick={login}>Entrar como Treinador</button>
            <button className="btn" onClick={async () => { const r = await syncNow(); setMsg(r.error ?? `${r.pushed} enviados · ${r.pulled}↓`) }}>Sincronizar agora</button>
            <button className="btn" onClick={backup}>Backup JSON</button>
          </div>
          {msg && <div className="alert ok">{msg}</div>}
          <div className="muted">Perfil Aluno: modelado no banco e <b>desativado</b> (Fase 2). Sem Supabase o app funciona 100% offline neste dispositivo.</div>
        </div>
        <div className="card grid" style={{ alignContent: 'start' }}>
          <h2>Cache de exercícios ({cache.length})</h2>
          <div className="muted">Itens "heurística" foram classificados offline — revise ou deixe a IA reclassificar quando online.</div>
          <input className="f" style={{ minHeight: 40, background: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 10, padding: '0 10px' }} placeholder="Filtrar…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="t"><tbody>
              {shown.slice(0, 120).map((c) => <CacheRow key={c.key} p={c} link={links.find((l) => l.exercise_key === c.key)?.url} />)}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  )
}

function CacheRow({ p, link }: { p: ExerciseProfile; link?: string }) {
  const [edit, setEdit] = useState(false)
  const [x, setX] = useState(p)
  const [url, setUrl] = useState(link ?? '')
  if (!edit) {
    return (
      <tr className="click" onClick={() => setEdit(true)}>
        <td><b>{p.name}</b>{p.disputed && <span className="tag warn" style={{ marginLeft: 6 }}>disputado</span>}<div className="muted">{p.muscle_group} · {p.sub_region ?? ''}</div></td>
        <td className="muted">{p.mechanic === 'multiarticular' ? 'Multi' : 'Mono'} · {p.implement === 'livre' ? 'Livre' : 'Máq/Cabo'}</td>
        <td><span className={`tag ${p.source === 'heuristic' ? 'warn' : ''}`}>{p.source}</span></td>
        <td className="muted">{link ? <LinkIcon size={15} /> : '[pendente de link]'}</td>
      </tr>
    )
  }
  return (
    <tr><td colSpan={4}>
      <div className="grid cols-2">
        <label className="f">Nome<input value={x.name} onChange={(e) => setX({ ...x, name: e.target.value })} /></label>
        <label className="f">Grupamento<select value={x.muscle_group} onChange={(e) => setX({ ...x, muscle_group: e.target.value })}>{MUSCLE_GROUPS.map((g) => <option key={g}>{g}</option>)}</select></label>
        <label className="f">Mecânica<select value={x.mechanic} onChange={(e) => setX({ ...x, mechanic: e.target.value as ExerciseProfile['mechanic'] })}><option value="multiarticular">Multiarticular</option><option value="monoarticular">Monoarticular</option></select></label>
        <label className="f">Implemento<select value={x.implement} onChange={(e) => setX({ ...x, implement: e.target.value as ExerciseProfile['implement'] })}><option value="livre">Peso livre</option><option value="maquina_cabo">Máquina / Cabo</option></select></label>
        <label className="f">Link verificado (https)<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="[pendente de link]" /></label>
        <label className="row"><input type="checkbox" checked={x.disputed} onChange={(e) => setX({ ...x, disputed: e.target.checked })} /> Aparelho disputado (fila)</label>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={async () => { await saveTrainerProfile(x); if (url && url !== link) await setTrainerLink(x.name, url); setEdit(false) }}>Salvar</button>
        <button className="btn" onClick={() => setEdit(false)}>Cancelar</button>
      </div>
    </td></tr>
  )
}

function BrandSection() {
  const brand = useLiveQuery(getBrand, [])
  const [err, setErr] = useState<string | null>(null)
  if (!brand) return null
  return (
    <div className="card grid">
      <h2>Identidade da marca</h2>
      <div className="brand-edit">
        <label className="logo-drop" htmlFor="brand-logo">
          {brand.logo ? <img src={brand.logo} alt="Logo atual" /> : <span style={{ display: 'grid', placeItems: 'center', gap: 4 }}><Emblem size={56} />enviar logo</span>}
        </label>
        <input id="brand-logo" type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            setErr(null)
            await saveBrand({ logo: await imageToLogo(f) })
          } catch (x) {
            setErr((x as Error).message)
          }
        }} />
        <div className="grid" style={{ flex: 1, minWidth: 0 }}>
          <label className="f">Nome de exibição
            <input id="brand-name" defaultValue={brand.name} placeholder="Manu Gorila Team" onBlur={(e) => saveBrand({ name: e.target.value.trim() || DEFAULT_BRAND.name })} />
          </label>
          <div className="row">
            <label className="f">Cor principal<input id="brand-primary" type="color" value={brand.primary} onChange={(e) => saveBrand({ primary: e.target.value })} /></label>
            <label className="f">Cor de destaque<input id="brand-accent" type="color" value={brand.accent} onChange={(e) => saveBrand({ accent: e.target.value })} /></label>
            {!isOfficialLogo(brand) && <button className="btn" onClick={() => saveBrand({ logo: null })}>Restaurar logo oficial</button>}
            <button className="btn" onClick={() => saveBrand({ primary: DEFAULT_BRAND.primary, accent: DEFAULT_BRAND.accent })}>Cores padrão</button>
          </div>
        </div>
      </div>
      {err && <div className="alert danger">{err}</div>}
      <div className="muted">A logo oficial Manu Gorila Team já vem embutida no app. Toque nela para trocar; ela aparece no menu, no topo dos PDFs e dentro de cada gráfico.</div>
    </div>
  )
}
