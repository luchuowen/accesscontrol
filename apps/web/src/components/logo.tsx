/**
 * Lango mark, "Crossing" (approved 2 Oct 2026): an emerald tile, a navy doorway, and a member (white dot) on the
 * threshold, mid-step. Lango is Swahili for gate.
 */
export function LangoMark({ size = 32, className }: { size?: number; className?: string }) {
  const small = size <= 20;
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx={small ? 14 : 16} fill="#10B981" />
      <path
        d="M18 50V30a14 14 0 0 1 28 0v20"
        fill="none"
        stroke="#0B1629"
        strokeWidth={small ? 9 : 6}
        strokeLinecap="round"
      />
      <circle cx="32" cy="50" r={small ? 8.5 : 7.5} fill="#FFFFFF" stroke="#10B981" strokeWidth="3" />
    </svg>
  );
}
