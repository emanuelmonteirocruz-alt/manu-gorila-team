/**
 * Ponte opcional para os recursos do visualizador claude.ai (prévia hospedada).
 * Fora dele `window.claude` não existe e tudo resolve `null` — o app usa as APIs do navegador.
 */
type ClaudeHost = { use: (name: string) => Promise<unknown> }

const cache = new Map<string, Promise<unknown>>()

export function claudeUse<T>(name: string): Promise<T | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude
  if (!host?.use) return Promise.resolve(null)
  if (!cache.has(name)) cache.set(name, host.use(name).catch(() => null))
  return cache.get(name) as Promise<T | null>
}

export interface Dictation {
  start(opts?: { language?: string }): Promise<void>
  stop(): Promise<void>
  onPartial(h: (e: { text: string }) => void): () => void
  onFinal(h: (e: { text: string }) => void): () => void
  onState(h: (e: { state: 'idle' | 'starting' | 'listening' | 'finishing'; reason?: string }) => void): () => void
}

interface Downloads {
  save(req: { filename: string; data: Blob }): Promise<unknown>
}

/**
 * Entrega um arquivo ao usuário: recurso `downloads` do visualizador quando existir,
 * senão download normal do navegador. Retorna false se o usuário recusou.
 */
export async function saveFile(filename: string, blob: Blob): Promise<boolean> {
  const dl = await claudeUse<Downloads>('downloads')
  if (dl) {
    try {
      await dl.save({ filename, data: blob })
      return true
    } catch (e) {
      if ((e as { code?: string }).code === 'declined') return false
      throw new Error('Não foi possível salvar o arquivo nesta visualização.')
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  return true
}
