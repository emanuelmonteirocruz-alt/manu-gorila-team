/** Identidade da marca do treinador (salva localmente; aplicada no painel e nos PDFs). */
import { getKV, setKV } from './db'
// logo oficial embutida no app (data URL): não depende de arquivo externo nem some ao publicar
import OFFICIAL_LOGO from '../assets/logo.jpg?inline'

export { OFFICIAL_LOGO }

export interface Brand {
  name: string
  primary: string // cor principal: botões/realces do painel, faixa do cabeçalho e barras de volume no PDF
  accent: string // cor de destaque: séries pesadas, setas de progressão
  logo: string | null // data URL PNG (redimensionada)
}

// Manu Team: grafite intenso (cabeçalhos, volume) + azul petróleo (destaque)
export const DEFAULT_BRAND: Brand = { name: 'Manu Team', primary: '#18181B', accent: '#0F766E', logo: null }
// paletas padrão de versões anteriores — tratadas como "não personalizado"
const OLD_COLORS = [['#2563eb', '#ea580c'], ['#3f3f46', '#e10600']]

export async function getBrand(): Promise<Brand> {
  const saved = { ...(await getKV<Partial<Brand>>('brand', {})) }
  // nomes antigos guardados no aparelho passam a usar o nome atual da marca
  if (saved.name === 'Emanuel Monteiro' || saved.name === 'Manu Gorila Team') delete saved.name
  if (OLD_COLORS.some(([p, a]) => saved.primary === p && saved.accent === a)) {
    delete saved.primary
    delete saved.accent
  }
  const b = { ...DEFAULT_BRAND, ...saved }
  return { ...b, logo: b.logo || OFFICIAL_LOGO } // sem logo própria: logo oficial
}

/** A logo atual é a oficial (não foi trocada nas configurações)? */
export function isOfficialLogo(b: Brand) {
  return !b.logo || b.logo === OFFICIAL_LOGO
}

export async function saveBrand(patch: Partial<Brand>) {
  await setKV('brand', { ...(await getBrand()), ...patch })
}

/** Lê a imagem enviada, recorta em quadrado e reduz para 256 px (PNG). */
export function imageToLogo(file: File, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(img.width, img.height)
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')!
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(img.src)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => reject(new Error('Arquivo de imagem inválido.'))
    img.src = URL.createObjectURL(file)
  })
}
