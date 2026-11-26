import { useEffect, useState } from 'react'
import { CircleCheck, Download, Share } from 'lucide-react'

interface BIPEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }

/** Instalar como aplicativo (PWA): Android/Chrome/Edge mostram o pedido; iPhone/iPad tem passo a passo. */
export function InstallApp() {
  const [evt, setEvt] = useState<BIPEvent | null>(null)
  const [installed, setInstalled] = useState(() => window.matchMedia?.('(display-mode: standalone)').matches)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent) }
    const done = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', on)
    window.addEventListener('appinstalled', done)
    return () => { window.removeEventListener('beforeinstallprompt', on); window.removeEventListener('appinstalled', done) }
  }, [])
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return (
    <div className="card grid">
      <h2>Instalar como aplicativo</h2>
      {installed ? <div className="alert ok"><CircleCheck size={16} /> App instalado neste aparelho</div> : evt ? (
        <button className="btn primary big" onClick={async () => { await evt.prompt(); await evt.userChoice; setEvt(null) }}><Download size={16} /> Instalar Manu Gorila Team</button>
      ) : ios ? (
        <div className="muted">No iPhone/iPad (Safari): toque em <b>Compartilhar</b> <Share size={13} style={{ verticalAlign: '-2px' }} /> e depois em <b>Adicionar à Tela de Início</b>.</div>
      ) : (
        <div className="muted">No Chrome (tablet/celular Android): menu <b>⋮</b> → <b>Instalar app</b> (ou "Adicionar à tela inicial"). Disponível quando o app está aberto pelo endereço publicado (https).</div>
      )}
      <div className="muted">Instalado, ele abre em tela cheia, gira livre (paisagem no tablet) e funciona sem internet — sincroniza quando a rede voltar.</div>
    </div>
  )
}
