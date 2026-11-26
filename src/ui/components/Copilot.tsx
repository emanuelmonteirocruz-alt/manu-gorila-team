import { useState } from 'react'
import { Check, Sparkles } from 'lucide-react'
import { db } from '../../data/db'
import { getWeekContext, profileLookup, studentSessions } from '../../data/repo'
import { getSupabase } from '../../data/sync'
import { formatCycle, generateNextCycle, type IntensityDirective } from '../../copilot/generator'
import { validateRenewal, validateTraining, type RuleViolation } from '../../copilot/rules'
import { MICRO_LABEL, type Microcycle, type Student } from '../../domain/types'
import { addDays, checkPrescriptionLock, weekStart } from '../../engine/metrics'
import { parsePrescriptionBlock } from '../../engine/prescription'
import { withLinks } from '../../links/linkResolver'

interface Block { label: string; text: string; mainGroup: string; names: string[] }

export default function Copilot({ student }: { student: Student }) {
  const [protocol, setProtocol] = useState<Microcycle>('ordinaria')
  const [intensity, setIntensity] = useState<IntensityDirective>('manter')
  const [minutes, setMinutes] = useState<number | ''>('')
  const [command, setCommand] = useState('')
  const [blocks, setBlocks] = useState<Block[]>([])
  const [prev, setPrev] = useState<Block[]>([])
  const [violations, setViolations] = useState<RuleViolation[]>([])
  const [warning, setWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  async function revalidate(bs: Block[], pv = prev) {
    const lookup = await profileLookup()
    const v = bs.flatMap((b) => validateTraining(b.label, b.text, lookup))
    const parsed = bs.map((b) => ({ ...b, names: parsePrescriptionBlock(b.text).exercises.flatMap((e) => e.names) }))
    setViolations([...v, ...validateRenewal(pv, parsed)])
  }

  async function generate(useAI: boolean) {
    setBusy(true)
    try {
      const all = await studentSessions(student)
      if (!all.length) {
        setWarning('Sem histórico — cole os treinos do WhatsApp primeiro.')
        return
      }
      const lastWeekStart = weekStart(all[all.length - 1].date)
      const lastWeek = all.filter((s) => s.date >= lastWeekStart && s.date <= addDays(lastWeekStart, 6))
      const nextWeek = addDays(lastWeekStart, 7)
      const ctx = await getWeekContext(student.id, nextWeek)
      const lock = checkPrescriptionLock(student.sex, ctx, protocol)
      setWarning(lock.warning ?? null)
      const lookup = await profileLookup()
      const catalog = (await db.exerciseCache.toArray()).filter((p) => p.source !== 'heuristic')
      const styleSamples = all.map((s) => s.raw_text).filter(Boolean) as string[]
      const draft = generateNextCycle({
        lastWeek, protocol: lock.allowed, intensity, minutesAvailable: minutes || undefined, catalog, lookup, styleSamples,
      })
      let out: Block[] = formatCycle(draft, styleSamples)
      const pv: Block[] = lastWeek.map((s) => ({
        label: s.label, text: s.raw_text ?? '', names: s.exercises.map((e) => e.display_name),
        mainGroup: mainGroup(s.exercises.map((e) => lookup(e.exercise_key)?.muscle_group)),
      }))
      setPrev(pv)
      if (useAI) {
        const sb = await getSupabase()
        if (!sb) setWarning('IA requer Supabase configurado — exibindo rascunho local.')
        else {
          const { data, error } = await sb.functions.invoke('copilot-draft', {
            body: {
              style_samples: styleSamples, previous_cycle: pv.map((b) => b.text).join('\n---\n'),
              context: { sexo: student.sex, dieta: ctx?.diet, menstrual: !!ctx?.menstrual },
              protocol: lock.allowed, intensity, minutes: minutes || null, command, draft: out.map((b) => b.text).join('\n---\n'),
            },
          })
          if (!error && data?.treinos?.length) {
            out = data.treinos.map((t: { label: string; texto: string }, i: number) => ({ label: t.label || out[i]?.label, text: t.texto, mainGroup: out[i]?.mainGroup ?? '—', names: [] }))
          } else setWarning('IA indisponível agora — exibindo rascunho local.')
        }
      }
      setBlocks(out)
      await revalidate(out, pv)
    } finally {
      setBusy(false)
    }
  }

  async function copy(b: Block, links: boolean) {
    let txt = b.text
    if (links) {
      const r = await withLinks(b.text, { search: true })
      txt = r.text
    }
    try {
      await navigator.clipboard.writeText(txt)
    } catch {
      setWarning('A cópia automática foi bloqueada aqui: selecione o texto do bloco e copie manualmente.')
      return
    }
    setCopied(b.label)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="grid">
      <div className="card grid">
        <h2>Gerador do próximo ciclo</h2>
        <div className="muted">Protocolo</div>
        <div className="chips">
          {(['regenerativa', 'ordinaria', 'choque'] as Microcycle[]).map((m) => (
            <button key={m} className={`chip sm ${protocol === m ? 'on' : ''}`} onClick={() => setProtocol(m)}>Protocolo {MICRO_LABEL[m]}</button>
          ))}
        </div>
        <div className="muted">Intensidade</div>
        <div className="chips">
          {([['diminuir', 'Diminuir intensidade'], ['manter', 'Manter'], ['aumentar', 'Aumentar intensidade']] as const).map(([k, l]) => (
            <button key={k} className={`chip sm ${intensity === k ? 'on' : ''}`} onClick={() => setIntensity(k)}>{l}</button>
          ))}
        </div>
        <div className="grid cols-2">
          <label className="f">Tempo disponível na academia (min)<input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value ? Number(e.target.value) : '')} /></label>
          <label className="f">Comando livre para a IA<input placeholder="ex.: foco em glúteo, sem agachamento livre" value={command} onChange={(e) => setCommand(e.target.value)} /></label>
        </div>
        <div className="row">
          <button className="btn primary big" disabled={busy} onClick={() => generate(false)}>Gerar rascunho (offline)</button>
          <button className="btn big" disabled={busy} onClick={() => generate(true)}><Sparkles size={16} strokeWidth={1.8} /> Gerar com IA no meu estilo</button>
        </div>
        {warning && <div className="alert warn">{warning}</div>}
      </div>
      {violations.length > 0 && (
        <div className="alert danger">
          <b>Travas técnicas</b>
          <ul style={{ margin: '6px 0 0' }}>{violations.map((v, i) => <li key={i}>{v.message}</li>)}</ul>
        </div>
      )}
      {blocks.length > 0 && violations.length === 0 && <div className="alert ok">Rascunho dentro das travas: aquecimento, sem séries picadas em aparelho disputado e renovação real.</div>}
      <div className="grid cols-2">
        {blocks.map((b, i) => (
          <div key={i} className="card grid">
            <div className="row" style={{ justifyContent: 'space-between' }}><b>{b.label}</b><span className="muted">{b.mainGroup}</span></div>
            <textarea className="code" value={b.text} onChange={(e) => {
              const nb = blocks.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
              setBlocks(nb)
              revalidate(nb)
            }} />
            <div className="row">
              <button className="btn ok" onClick={() => copy(b, false)}>{copied === b.label ? <><Check size={16} /> Copiado</> : 'Copiar para WhatsApp'}</button>
              <button className="btn" onClick={() => copy(b, true)}>Copiar com links</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function mainGroup(groups: (string | undefined)[]): string {
  const c = new Map<string, number>()
  for (const g of groups) if (g) c.set(g, (c.get(g) ?? 0) + 1)
  return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
}
