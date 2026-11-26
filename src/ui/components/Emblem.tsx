/** Emblema padrão Manu Team (preto, cinza e vermelho) — usado enquanto não há logo enviada. */
export function Emblem({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Manu Team">
      <rect width="100" height="100" rx="22" fill="#111111" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="#e10600" strokeWidth="7" />
      <text x="50" y="60" textAnchor="middle" fontFamily="Helvetica, Arial, sans-serif" fontWeight="800" fontSize="34" fill="#ffffff">MG</text>
      <rect x="30" y="74" width="40" height="5" fill="#a1a1aa" />
    </svg>
  )
}
