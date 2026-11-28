// Tipos de domínio — espelham supabase/migrations/0001_init.sql

export type UserRole = 'trainer' | 'student'
export type Modality = 'online' | 'presencial'
export type BioSex = 'F' | 'M'
export type PayStatus = 'em_dia' | 'pendente' | 'atrasado'
export type DietPhase = 'bulking' | 'manutencao' | 'cutting'
export type Microcycle = 'ordinaria' | 'choque' | 'regenerativa'
export type SessionSource = 'whatsapp' | 'presencial' | 'copiloto'
export type Reporter = 'trainer' | 'student'
export type SleepQuality = 'bem' | 'mal' | 'irregular'
export type Mechanic = 'multiarticular' | 'monoarticular'
export type Implement = 'livre' | 'maquina_cabo'

/** Campos de sincronização offline-first (não vão para o Supabase). */
export interface SyncMeta {
  updated_at: string
  _dirty?: 0 | 1
  _deleted?: 0 | 1
}

export interface AppUser {
  id: string
  role: UserRole
  active: boolean // Fase 1: alunos sempre false
  display_name?: string
}

export interface Student extends SyncMeta {
  id: string
  trainer_id: string
  user_id?: string | null // Fase 2
  full_name: string
  sex: BioSex
  phone?: string
  modality: Modality
  plan_name?: string
  weekly_frequency?: number
  due_day?: number // derivado de due_date (compatibilidade)
  due_date?: string | null // data de vencimento do pagamento
  plan_period?: 'mensal' | 'quinzenal' | 'semanal' | null // consultoria: periodicidade do plano
  next_change_date?: string | null // consultoria: data da próxima troca de treino
  emphasis?: string[] | null // ênfase do plano definida pelo treinador (relatórios e montagem automática)
  weight_kg?: number | null // peso (kg) para o gasto calórico do cardio
  training_level?: TrainingLevel | null // consultoria: nível de treino (quanto método/intensidade a montagem usa)
  plan_value?: number
  hourly_rate?: number | null
  hourly_rate_manual: boolean
  payment_status: PayStatus
  archived: boolean
  timeline_reset_at?: string | null
  created_at: string
}

export interface WeekContext extends SyncMeta {
  id: string
  student_id: string
  week_start: string // YYYY-MM-DD (segunda)
  menstrual: boolean
  menstrual_phase?: string
  diet: DietPhase
  planned_microcycle?: Microcycle | null
  final_microcycle?: Microcycle | null
  justification?: string
}

export interface RepRange {
  min: number
  max: number
  /** série "do máximo / até a falha" (conta como série válida de trabalho) */
  failure?: boolean
  /** marcação manual do treinador (vence a regra automática 6–8 / 8 / 8–10) */
  heavy?: boolean
}

export interface SessionExercise {
  id: string
  position: number
  superset_group?: number | null
  exercise_key: string
  display_name: string
  valid_sets: number
  warmup_sets: number
  heavy_sets: number
  reps: RepRange[] // uma entrada por série VÁLIDA
  load_kg?: number | null // carga pico (como ditada; por lado se per_side)
  /** carga de cada série válida, na ordem (como ditada; por lado se per_side) */
  loads?: (number | null)[]
  /** "de cada lado / por lado": tonelagem e kcal multiplicam a carga por 2 */
  per_side?: boolean
  /** séries de aquecimento ditadas (carga e reps), fora do volume válido */
  warmup_detail?: { kg: number | null; reps: RepRange }[]
  drop_set: boolean
  notes?: string
}

export interface Session extends SyncMeta {
  id: string
  student_id: string
  date: string
  label: string
  source: SessionSource
  muscle_groups: string[]
  raw_text?: string
  planned_microcycle?: Microcycle | null
  exercises: SessionExercise[] // embutido localmente; normalizado no Supabase
  created_at: string
}

export interface SessionRating extends SyncMeta {
  id: string
  session_id: string
  pse: number
  reported_by: Reporter
  created_at: string
}

export interface DailyCheckin extends SyncMeta {
  id: string
  student_id: string
  date: string
  sleep: SleepQuality
  reported_by: Reporter
}

/** Anamnese da consultoria: respostas por pergunta do modelo (id da pergunta → resposta). */
export interface Anamnese extends SyncMeta {
  id: string
  student_id: string
  answers: Record<string, string>
  raw_text?: string | null // anamnese colada, como veio
  created_at: string
}

export interface ExerciseProfile {
  key: string
  name: string
  aliases: string[]
  muscle_group: string
  sub_region?: string
  mechanic: Mechanic
  implement: Implement
  disputed: boolean
  source: 'seed' | 'ai' | 'trainer' | 'heuristic'
  updated_at?: string
  _dirty?: 0 | 1
}

export interface ExerciseLink {
  id: string // `${exercise_key}|${provider}`
  exercise_key: string
  provider: string
  url: string
  verified_at: string
  _dirty?: 0 | 1
}

export type TrainingLevel = 'adaptacao' | 'iniciante' | 'intermediario' | 'avancado1' | 'avancado2' | 'atleta'

export const MUSCLE_GROUPS = [
  'Perna - Quadríceps',
  'Perna - Posterior',
  'Glúteo',
  'Adutores',
  'Panturrilha',
  'Ombro',
  'Costas',
  'Peito',
  'Bíceps',
  'Tríceps',
  'Abdômen',
] as const

export const MICRO_LABEL: Record<Microcycle, string> = {
  ordinaria: 'Ordinária',
  choque: 'Choque',
  regenerativa: 'Regenerativa',
}
export const DIET_LABEL: Record<DietPhase, string> = {
  bulking: 'Off / Bulking',
  manutencao: 'Manutenção',
  cutting: 'Cutting',
}
export const SLEEP_LABEL: Record<SleepQuality, string> = {
  bem: 'Dormiu bem',
  mal: 'Dormiu mal',
  irregular: 'Sono irregular',
}

/** Cardio feito pelo aluno (consultoria ou presencial): kcal calculada por MET × peso × tempo. */
export interface CardioEntry extends SyncMeta {
  id: string
  student_id: string
  date: string // YYYY-MM-DD
  kind: 'esteira' | 'bicicleta' | 'escada' | 'eliptico'
  minutes: number
  km?: number | null
  intensity?: 'leve' | 'moderada' | 'intensa' | null
  incline?: number | null
  met?: number | null
  kcal?: number | null
  notes?: string | null
  created_at: string
}

/** Avaliação do nutricionista: arquivo (foto/PDF) + dados lidos e conferidos pelo treinador. */
export interface NutritionEntry extends SyncMeta {
  id: string
  student_id: string
  date: string
  file_path?: string | null // caminho no armazenamento da nuvem (bucket "nutrition")
  file_name?: string | null
  mime?: string | null
  weight_kg?: number | null
  kcal?: number | null // calorias por dia do plano
  phase?: 'deficit' | 'manutencao' | 'superavit' | null
  protein_g?: number | null
  body_fat?: number | null
  height_m?: number | null
  age?: number | null
  lean_mass_kg?: number | null
  notes?: string | null
  raw_text?: string | null
  created_at: string
}

/** Acompanhamento enviado ao aluno (check-in da semana, aluno sumido): sincroniza entre aparelhos. */
export interface FollowUp extends SyncMeta {
  id: string
  student_id: string
  key: string // "f:2026-11-23" (check-in completo da semana), "q:…" (rápido), "missing:2026-11-10" (aluno sumido)
  created_at: string
}
