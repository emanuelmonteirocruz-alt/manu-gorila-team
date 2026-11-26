/**
 * Proteção dos dados guardados no aparelho (enquanto a nuvem não está ligada, eles só existem aqui).
 * - pede ao navegador armazenamento "persistente" (não é apagado para liberar espaço);
 * - avisa quando o app foi aberto num lugar que apaga tudo ao fechar.
 */
export const APP_URL = 'https://manu-gorila-team.vercel.app'

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

export function storageWarning(): string | null {
  const ua = navigator.userAgent
  // navegador interno de outros apps: apaga os dados quando fecha
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|GSA\/|; wv\)/i.test(ua))
    return `Você abriu o app por dentro de outro aplicativo (WhatsApp, Instagram, Gmail…). Aqui os dados SOMEM ao fechar. Abra ${APP_URL.replace('https://', '')} no Chrome ou no Safari e instale na tela inicial.`
  // endereço de uma versão específica da Vercel: guarda dados separados do endereço oficial
  const host = location.hostname
  if (host.endsWith('.vercel.app') && host !== new URL(APP_URL).hostname)
    return `Este é um endereço de teste da Vercel (${host}). Cada endereço guarda os dados separado. Use sempre ${APP_URL.replace('https://', '')}.`
  return null
}
