import { useLiveQuery } from 'dexie-react-hooks'
import { ClipboardCopy, Link2 as LinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { db, getKV, setKV } from '../../data/db'
import { saveFile } from '../../artifact/claude'
import { InstallApp } from '../components/InstallApp'
import { Emblem } from '../components/Emblem'
import SETUP_SQL from '../../../supabase/setup_completo.sql?raw'
import { DEFAULT_BRAND, getBrand, imageToLogo, isOfficialLogo, saveBrand } from '../../data/brand'
import { cloudConfig, configProblem, currentTrainer, envConfigured, getSupabase, resetSupabaseClient, requestSync, signOut, syncNow } from '../../data/sync'
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

  const [who, setWho] = useState<string | null>(null)
  const [project, setProject] = useState<{ host: string; key: string; problem: string | null } | null>(null)
  useEffect(() => {
    currentTrainer().then(setWho)
    cloudConfig().then(({ url, key }) => setProject(url || key ? { host: url.replace(/^https?:\/\//, ''), key: key ? `${key.slice(0, 16)}…` : '(vazia)', problem: configProblem(url, key) } : null))
  }, [])

  async function login() {
    resetSupabaseClient()
    let sb
    try { sb = await getSupabase() } catch (e) { return setMsg((e as Error).message) }
    if (!sb) return setMsg('Informe a URL e a chave do Supabase.')
    let error: { message: string } | null
    try { ({ error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pwd })) }
    catch (e) { return setMsg(`Não consegui falar com o Supabase (${(e as Error).message}). Confira a URL na Vercel e se o projeto não está pausado.`) }
    if (error) {
      const m = error.message
      if (/not confirmed/i.test(m)) return setMsg('E-mail ainda não confirmado. No Supabase: Authentication → Users → abra o usuário → "Confirm user" (ou rode o SQL de correção de login).')
      if (/invalid login|invalid credentials/i.test(m)) return setMsg('E-mail ou senha não conferem no Supabase. Se o usuário foi criado pelo SQL, crie de novo em Authentication → Users → Add user (com "Auto Confirm"), ou rode o SQL de correção de login.')
      if (/failed to fetch|load failed|networkerror/i.test(m)) return setMsg(`Não consegui falar com o Supabase em ${project?.host ?? 'este endereço'}. Confira se o endereço está certo (toque em "Corrigir endereço") e se há internet.`)
      if (/not found|404/i.test(m)) return setMsg('O Supabase respondeu "não encontrado": confira se a URL na Vercel é só https://xxxx.supabase.co e faça o Redeploy.')
      if (/database error/i.test(m)) return setMsg('Usuário criado de forma incompleta no Supabase. Apague-o em Authentication → Users e crie de novo pelo botão Add user (com "Auto Confirm").')
      return setMsg(m)
    }
    setWho(email.trim())
    setPwd('')
    setMsg('Treinador conectado neste aparelho. Sincronizando…')
    const r = await syncNow()
    requestSync()
    setMsg(r.error ?? `Sincronizado: ${r.pushed} enviados, ${r.pulled} recebidos. Este aparelho não vai pedir login de novo.`)
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
      <WritingGuide />
      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <div className="card grid">
          <h2>Supabase (sincronização)</h2>
          {who ? (
            <div className="alert ok">Conectado como <b>{who}</b>. Tudo que você salva aqui vai para a nuvem e aparece no celular, tablet e PC conectados com o mesmo e-mail.</div>
          ) : (
            <div className="muted">Para sincronizar, entre com o e-mail e a senha do treinador <b>uma vez em cada aparelho</b> (celular, tablet, PC). Depois disso o app abre direto no painel, sem pedir login.</div>
          )}
          {project && <div className="muted">Projeto: <b>{project.host || '(sem URL)'}</b> · chave {project.key}</div>}
          {project?.problem && <div className="alert danger">{project.problem}</div>}
          {envConfigured && <FixUrl current={project?.host ?? ''} onSaved={(host) => { setProject((p) => (p ? { ...p, host } : p)); setMsg('Endereço salvo neste aparelho. Agora entre com o e-mail e a senha.') }} />}
          {!envConfigured && (
            <>
              <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                <li>Crie um projeto grátis em supabase.com (região São Paulo).</li>
                <li>Toque em <b>Copiar SQL de instalação</b> e cole no Supabase em <b>SQL Editor → New query → Run</b>.</li>
                <li>Em Authentication → Users, crie seu e-mail e senha (o 1º usuário vira Treinador).</li>
                <li>Em Project Settings → API, copie a URL e a chave para os campos abaixo e entre.</li>
              </ol>
              <label className="f">Project URL<input defaultValue={url} onBlur={(e) => { setKV('supabase_url', e.target.value.trim()); resetSupabaseClient() }} placeholder="https://xxxx.supabase.co" /></label>
              <label className="f">Chave (anon ou publishable)<input defaultValue={key} onBlur={(e) => { setKV('supabase_key', e.target.value.trim()); resetSupabaseClient() }} /></label>
            </>
          )}
          {!who && (
            <div className="grid cols-2">
              <label className="f">E-mail do treinador<input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
              <label className="f">Senha<input type="password" autoComplete="current-password" value={pwd} onChange={(e) => setPwd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && login()} /></label>
            </div>
          )}
          <div className="row">
            {!who && <button className="btn primary" disabled={!email || !pwd} onClick={login}>Entrar como Treinador</button>}
            {who && <button className="btn primary" onClick={async () => { setMsg('Sincronizando…'); const r = await syncNow(); requestSync(); setMsg(r.error ?? `${r.pushed} enviados · ${r.pulled} recebidos`) }}>Sincronizar agora</button>}
            <button className="btn" onClick={backup}>Backup JSON</button>
            {who && <button className="btn" onClick={async () => { await signOut(); setWho(null); requestSync(); setMsg('Desconectado deste aparelho. Os dados continuam salvos aqui.') }}>Sair deste aparelho</button>}
          </div>
          <div className="row">
            <button className="btn" onClick={async () => {
              try { await navigator.clipboard.writeText(SETUP_SQL); setMsg('SQL copiado. Cole no SQL Editor do Supabase e toque em Run.') }
              catch { await saveFile('em-treino-setup-sql.txt', new Blob([SETUP_SQL], { type: 'text/plain' })) ; setMsg('Cópia bloqueada aqui — o arquivo SQL foi oferecido para salvar.') }
            }}><ClipboardCopy size={16} strokeWidth={1.8} /> Copiar SQL de instalação</button>
          </div>
          {who && <ChangePassword onMsg={setMsg} />}
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

/** Trocar a senha do treinador (ex.: depois de entrar com uma senha provisória). */
function ChangePassword({ onMsg }: { onMsg: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  if (!open) return <div className="row"><button className="btn" onClick={() => setOpen(true)}>Trocar senha</button></div>
  return (
    <div className="grid">
      <div className="grid cols-2">
        <label className="f">Nova senha<input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} /></label>
        <label className="f">Repita a nova senha<input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} /></label>
      </div>
      <div className="row">
        <button className="btn primary" disabled={p1.length < 6 || p1 !== p2} onClick={async () => {
          const sb = await getSupabase()
          const r = await sb?.auth.updateUser({ password: p1 })
          if (r?.error) return onMsg(r.error.message)
          setOpen(false); setP1(''); setP2('')
          onMsg('Senha trocada. Use a nova senha para entrar nos outros aparelhos.')
        }}>Salvar nova senha</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
        {p1 && p1.length < 6 && <span className="muted">mínimo 6 caracteres</span>}
        {p2 && p1 !== p2 && <span className="muted">as senhas não são iguais</span>}
      </div>
    </div>
  )
}

/** Corrige o endereço do Supabase só neste aparelho (vale mais que o da Vercel). */
function FixUrl({ current, onSaved }: { current: string; onSaved: (host: string) => void }) {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState('')
  if (!open) return <div className="row"><button className="btn sm" onClick={() => { setV(current ? `https://${current}` : ''); setOpen(true) }}>Corrigir endereço</button></div>
  return (
    <div className="grid">
      <label className="f">Endereço do Supabase (Project URL)<input value={v} onChange={(e) => setV(e.target.value)} placeholder="https://xxxx.supabase.co" autoCapitalize="off" autoCorrect="off" spellCheck={false} /></label>
      <div className="row">
        <button className="btn primary" disabled={!/^https:\/\/[a-z0-9]+\.supabase\.co\/?$/i.test(v.trim())} onClick={async () => {
          const url = v.trim().replace(/\/+$/, '')
          await setKV('supabase_url', url)
          resetSupabaseClient()
          setOpen(false)
          onSaved(url.replace(/^https?:\/\//, ''))
        }}>Salvar endereço</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancelar</button>
      </div>
    </div>
  )
}

/** Padrão de escrita dos treinos (consultoria): como escrever para o app entender o esforço prescrito. */
function WritingGuide() {
  const [open, setOpen] = useState(false)
  const rows: [string, string, string][] = [
    ['Séries e repetições', '4x10 · 3x8-12 · 3x8 a 10 · 15/12/10/8', 'séries e faixa de reps de cada série'],
    ['Até a falha', '3xMáx · 3x máximo · 3x falha', 'séries "Máx" (contam como esforço alto)'],
    ['Bi-set / tri-set', 'Supino + Crucifixo (ou escreva bi-set)', 'exercícios ligados por + = técnica avançada'],
    ['Drop-set', 'drop · drop set · drop na última', 'técnica avançada'],
    ['Rest-pause', 'rest pause · rest-pause', 'técnica avançada'],
    ['Cluster', 'cluster · cluster na última', 'técnica avançada'],
    ['Pirâmide', 'pirâmide 12/10/8/6 (em linha própria)', 'técnica + reps de cada série'],
    ['FST-7 / excêntrica / isometria', 'FST-7 · excêntrica · negativa · isometria', 'técnica avançada'],
    ['Cadência', 'cadência 3-1-1', 'observação (entra na orientação ao aluno)'],
    ['Aquecimento', '2x15 aquecimento + 3x10 · Aquecimento sem carga', 'fica fora das séries válidas'],
    ['Carga', 'carga alta · 8 reps para cargas pesadas', 'intenção registrada'],
  ]
  return (
    <div className="card grid" style={{ marginTop: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Padrão de escrita dos treinos</h2>
        <button className="btn sm" onClick={() => setOpen((v) => !v)}>{open ? 'Esconder' : 'Ver padrão'}</button>
      </div>
      <div className="muted">Escrevendo assim, o app reconhece o esforço que você prescreveu (Nível do desafio) e monta a orientação de esforço para o aluno. Um exercício por bloco, com uma linha em branco entre exercícios.</div>
      {open && (
        <div className="wguide">
          {rows.map(([what, how, means]) => (
            <div key={what} className="m-item">
              <div className="m-top"><span>{what}</span></div>
              <div><code>{how}</code></div>
              <div className="m-sub">{means}</div>
            </div>
          ))}
          <div className="muted">Faixas de reps no Nível do desafio: até 6 = 3 pontos · 7–10 = 2 · 11–15 = 1 · acima de 15 = 0,5 por série; cada série com técnica avançada soma +1.</div>
        </div>
      )}
    </div>
  )
}
