/**
 * Ditado pt-BR com dois motores:
 *  1. `dictation` do visualizador claude.ai (prévia hospedada — o microfone é do Claude);
 *  2. Web Speech API do navegador (app instalado: Chrome/Edge/Android/Safari 17+).
 * A transcrição final é acumulada; a parcial é exibida como provisória.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { claudeUse, type Dictation } from '../artifact/claude'

interface SR {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function getSR(): (new () => SR) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const DICTATION_ERRORS: Record<string, string> = {
  not_granted: 'Microfone não autorizado. Libere em Permissões da página ou use o campo de texto.',
  dismissed: 'Pedido de microfone fechado. Toque no botão de novo para autorizar.',
  unavailable: 'Ditado indisponível nesta conta/navegador — use o campo de texto.',
  rate_limited: 'Ditado ocupado no momento. Tente de novo em alguns segundos.',
  upstream_error: 'Falha no microfone ou no serviço de voz. Tente de novo.',
  time_limit: 'Limite de 60 min de gravação atingido. Toque para continuar.',
}

export function useSpeech() {
  const [recording, setRecording] = useState(false)
  const [finalText, setFinalText] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hostDictation, setHostDictation] = useState(false)
  const rec = useRef<SR | null>(null)
  const dict = useRef<Dictation | null>(null)
  const withLanguage = useRef(true)
  const wanted = useRef(false)

  // Resolve o ditado do Claude uma vez; start() precisa ser chamado sem await no toque.
  useEffect(() => {
    let alive = true
    const offs: (() => void)[] = []
    claudeUse<Dictation>('dictation').then((d) => {
      if (!d || !alive) return
      dict.current = d
      setHostDictation(true)
      offs.push(
        d.onFinal(({ text }) => setFinalText((t) => (t ? t + text : text.trimStart()))),
        d.onPartial(({ text }) => setInterim(text)),
        d.onState(({ state, reason }) => {
          setRecording(state !== 'idle')
          if (state === 'idle') {
            setInterim('')
            if (reason && DICTATION_ERRORS[reason]) setError(DICTATION_ERRORS[reason])
          }
        }),
      )
    })
    return () => {
      alive = false
      offs.forEach((f) => f())
    }
  }, [])

  const start = useCallback(() => {
    setError(null)
    setFinalText('')
    setInterim('')
    const d = dict.current
    if (d) {
      d.start(withLanguage.current ? { language: 'pt-BR' } : undefined).catch((e: { code?: string }) => {
        if (e.code === 'unavailable' && withLanguage.current) {
          withLanguage.current = false // tenta no idioma do usuário no próximo toque
          setError('Toque no microfone de novo para tentar no idioma do seu navegador.')
        } else if (e.code && e.code !== 'stopped') setError(DICTATION_ERRORS[e.code] ?? `Erro no ditado: ${e.code}`)
      })
      return
    }
    const Ctor = getSR()
    if (!Ctor) {
      setError('Reconhecimento de voz indisponível neste navegador — use Chrome/Edge ou digite.')
      return
    }
    const r = new Ctor()
    r.lang = 'pt-BR'
    r.continuous = true
    r.interimResults = true
    r.onresult = (e) => {
      let fin = ''
      let tmp = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) fin += res[0].transcript + '; '
        else tmp += res[0].transcript
      }
      if (fin) setFinalText((t) => t + fin)
      setInterim(tmp)
    }
    r.onerror = (e) => {
      if (e.error !== 'no-speech') setError(`Erro no microfone: ${e.error}`)
    }
    // navegadores encerram após silêncio: reinicia enquanto o treinador não parar
    r.onend = () => {
      if (wanted.current) r.start()
      else setRecording(false)
    }
    rec.current = r
    wanted.current = true
    r.start()
    setRecording(true)
  }, [])

  const stop = useCallback(() => {
    if (dict.current) {
      dict.current.stop().catch(() => undefined) // onState leva a "idle" após as últimas palavras
      return
    }
    wanted.current = false
    rec.current?.stop()
    setInterim('')
  }, [])

  useEffect(() => () => {
    wanted.current = false
    rec.current?.stop()
    dict.current?.stop().catch(() => undefined)
  }, [])

  return { supported: hostDictation || !!getSR(), hostDictation, recording, finalText, interim, error, start, stop, setFinalText }
}
