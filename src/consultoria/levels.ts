/**
 * NÍVEL DE TREINO DO ALUNO DA CONSULTORIA — quanto método e quanta intensidade cada semana recebe.
 *
 * Princípio: intensidade com MÉTODO, não "salada de métodos".
 *  - Cada variável pertence a uma FAMÍLIA (tensão mecânica, estresse metabólico, posição alongada/tempo,
 *    proximidade da falha, volume). Num mesmo treino não entram duas da mesma família: no atleta, o choque
 *    combina no máximo uma de cada (ex.: cluster no multiarticular + rest-pause no isolado + excêntrica).
 *  - Mais nível = mais variáveis por treino, acesso a métodos mais densos e séries mais perto da falha.
 *  - Regenerativa: iniciante/adaptação aliviam tudo; avançados fazem deload pelo VOLUME e mantêm a faixa de reps.
 *
 * Base científica (resumo do que sustenta as regras):
 *  - Krzysztofik et al., 2019 (IJERPH 16:4897): revisão sistemática de técnicas avançadas (drop set, rest-pause,
 *    cluster, excêntrica, tempo, pré-exaustão…): úteis para treinados quebrarem platô e monotonia, sem superioridade
 *    clara sobre o tradicional → usar com critério, não em todo exercício.
 *  - Sødal et al., 2023 (Sports Medicine – Open): drop set gera hipertrofia semelhante ao tradicional em menos tempo
 *    → bom recurso de densidade no isolado/máquina.
 *  - Robinson et al., 2024 (Sports Medicine 54(9)): hipertrofia melhora quanto mais perto da falha; força depende mais
 *    da carga (%1RM) → níveis altos chegam mais perto da falha; carga alta (6–8) para força.
 *  - Refalo et al., 2023 (Sports Medicine): proximidade da falha × hipertrofia (relação não linear) → falha só
 *    na última série e para quem tem técnica.
 *  - Pedrosa et al., 2022 (Eur J Sport Sci): parciais na posição ALONGADA geram boa hipertrofia → "parciais alongadas".
 *  - Schoenfeld, Ogborn & Krieger, 2017 (J Sports Sci): dose-resposta do volume semanal → +1 série na ênfase.
 *  - Tufano et al., 2017 (Sports Med): cluster sets mantêm velocidade/carga alta → multiarticulares, níveis avançados.
 *  - Bell et al., 2023 (Sports Medicine – Open, Delphi): deload = reduzir o estresse para dissipar fadiga, geralmente
 *    pelo volume → regenerativa dos avançados corta séries e mantém a faixa de repetições.
 * Estas regras são o ponto de partida; vamos calibrando com a sua prática.
 */
import type { TrainingLevel } from '../domain/types'

export type VarFamily = 'tensao' | 'metabolico' | 'alongado' | 'falha' | 'volume'

export interface LevelRule {
  id: TrainingLevel
  label: string
  resumo: string // o que muda na montagem (aparece para você no app)
  choque: [number, number] // variáveis por treino na semana de choque (mín, máx)
  ordinaria: number // chance de 1 variável por treino na ordinária (0 a 1)
  permitidas: string[] // variáveis liberadas (ids de SHOCK_VARIABLES)
  ordinariaPermitidas: string[] // as que podem aparecer na ordinária
  minReps: number // reps mínimas que o ajuste de intensidade aceita
  deloadPorVolume: boolean // regenerativa corta volume e mantém a faixa de reps
}

const ALL = ['drop', 'dropduplo', 'restpause', 'myoreps', 'cluster', 'forca', 'piramide', 'excentrica', 'isometria', 'parciais', 'fst7', 'falha', 'volume']

export const LEVELS: LevelRule[] = [
  {
    id: 'adaptacao', label: 'Adaptação (lesão / fortalecimento)',
    resumo: 'Readaptação, regeneração e fortalecimento: controle de movimento, excêntrica e isometria, 10 reps ou mais, sem falha e no máximo um estímulo novo por treino.',
    choque: [0, 1], ordinaria: 0, permitidas: ['excentrica', 'isometria', 'volume'], ordinariaPermitidas: [], minReps: 10, deloadPorVolume: false,
  },
  {
    id: 'iniciante', label: 'Iniciante / readaptação',
    resumo: 'Treino para (re)adaptar: técnica, excêntrica controlada, isometria e volume. Um estímulo novo por treino no choque.',
    choque: [1, 1], ordinaria: 0, permitidas: ['excentrica', 'isometria', 'volume'], ordinariaPermitidas: [], minReps: 8, deloadPorVolume: false,
  },
  {
    id: 'intermediario', label: 'Intermediário',
    resumo: 'Técnicas pontuais (1 a 2 por treino no choque): drop, rest-pause, pirâmide, carga alta, excêntrica. Sem métodos de alta densidade.',
    choque: [1, 2], ordinaria: 0, permitidas: ['drop', 'restpause', 'piramide', 'forca', 'excentrica', 'isometria', 'parciais', 'falha', 'volume'], ordinariaPermitidas: [], minReps: 6, deloadPorVolume: false,
  },
  {
    id: 'avancado1', label: 'Avançado 1',
    resumo: 'Intensidade: 2 métodos por treino no choque (famílias diferentes), cluster e myo-reps liberados; às vezes um método leve na ordinária.',
    choque: [2, 2], ordinaria: 0.4, permitidas: ALL.filter((x) => x !== 'dropduplo' && x !== 'fst7'), ordinariaPermitidas: ['excentrica', 'isometria', 'parciais', 'piramide'], minReps: 6, deloadPorVolume: false,
  },
  {
    id: 'avancado2', label: 'Avançado 2',
    resumo: 'Mais intensidade: 2 a 3 métodos no choque (famílias diferentes), FST-7 e drop duplo liberados, 1 método na ordinária; regenerativa corta volume e mantém as reps.',
    choque: [2, 3], ordinaria: 0.8, permitidas: ALL, ordinariaPermitidas: ['excentrica', 'isometria', 'parciais', 'piramide', 'restpause', 'forca'], minReps: 5, deloadPorVolume: true,
  },
  {
    id: 'atleta', label: 'Atleta',
    resumo: 'Choque bem intenso e com método: um de cada família por treino (tensão mecânica + estresse metabólico + posição alongada), falha nas últimas séries; ordinária sempre com 1 método; deload por volume.',
    choque: [3, 3], ordinaria: 1, permitidas: ALL, ordinariaPermitidas: ['excentrica', 'parciais', 'piramide', 'restpause', 'forca', 'cluster', 'myoreps'], minReps: 4, deloadPorVolume: true,
  },
]

export const LEVEL_BY_ID = Object.fromEntries(LEVELS.map((l) => [l.id, l])) as Record<TrainingLevel, LevelRule>

/** Nível em uso: o da ficha; sem ele, o da anamnese (experiência); sem nada, intermediário. */
export function levelFor(ficha: TrainingLevel | null | undefined, experiencia?: 'iniciante' | 'intermediario' | 'avancado' | null): LevelRule {
  if (ficha && LEVEL_BY_ID[ficha]) return LEVEL_BY_ID[ficha]
  if (experiencia === 'iniciante') return LEVEL_BY_ID.iniciante
  if (experiencia === 'avancado') return LEVEL_BY_ID.avancado1
  return LEVEL_BY_ID.intermediario
}

export const REFERENCES = [
  'Krzysztofik et al., 2019 — IJERPH 16(24):4897 · técnicas avançadas para hipertrofia (revisão sistemática)',
  'Sødal et al., 2023 — Sports Medicine – Open · drop set × tradicional (meta-análise)',
  'Robinson et al., 2024 — Sports Medicine 54(9) · proximidade da falha × força e hipertrofia (meta-regressões)',
  'Refalo et al., 2023 — Sports Medicine · proximidade da falha e hipertrofia (meta-análise)',
  'Pedrosa et al., 2022 — European Journal of Sport Science · parciais na posição alongada',
  'Schoenfeld, Ogborn & Krieger, 2017 — Journal of Sports Sciences · dose-resposta do volume semanal',
  'Tufano et al., 2017 — Sports Medicine · cluster sets',
  'Bell et al., 2023 — Sports Medicine – Open · deload (consenso Delphi)',
]
