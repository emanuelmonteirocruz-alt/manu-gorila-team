import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageWarning } from '../data/storageGuard'

const at = (host: string, ua: string) => {
  vi.stubGlobal('location', { hostname: host })
  vi.stubGlobal('navigator', { userAgent: ua })
}
const CHROME = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36'

describe('aviso de onde o app foi aberto', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('endereço oficial no Chrome: sem aviso', () => {
    at('manu-gorila-team.vercel.app', CHROME)
    expect(storageWarning()).toBeNull()
  })
  it('endereço de uma versão da Vercel: avisa', () => {
    at('manu-gorila-team-rglpg78jy-manu-gorila-team.vercel.app', CHROME)
    expect(storageWarning()).toMatch(/endereço de teste/)
  })
  it('navegador interno do Instagram / WebView: avisa', () => {
    at('manu-gorila-team.vercel.app', CHROME + ' Instagram 300.0')
    expect(storageWarning()).toMatch(/SOMEM ao fechar/)
    at('manu-gorila-team.vercel.app', CHROME.replace('SM-S918B)', 'SM-S918B; wv)'))
    expect(storageWarning()).toMatch(/SOMEM ao fechar/)
  })
})
