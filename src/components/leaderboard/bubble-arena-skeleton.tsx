"use client"

/**
 * Loading placeholder for the KPI Arena — a few faint, softly-pulsing orbs so the
 * canvas reads as "filling in" rather than showing a bare spinner / pulsing text.
 * Purely decorative (aria-hidden svg); the visible label carries the status text.
 * Fixed layout (no Math.random) so it's stable and SSR-safe.
 */
const SKELETON_ORBS = [
  { cx: "22%", cy: "44%", r: 70 },
  { cx: "52%", cy: "30%", r: 98 },
  { cx: "40%", cy: "68%", r: 46 },
  { cx: "67%", cy: "57%", r: 58 },
  { cx: "80%", cy: "37%", r: 36 },
  { cx: "33%", cy: "23%", r: 28 },
  { cx: "87%", cy: "66%", r: 24 },
]

export function BubbleArenaSkeleton({ height = 620, label }: { height?: number; label?: string }) {
  return (
    <div className="relative w-full" style={{ height }}>
      <svg width="100%" height={height} className="animate-pulse" aria-hidden>
        {SKELETON_ORBS.map((o, i) => (
          <circle key={i} cx={o.cx} cy={o.cy} r={o.r} fill="rgba(255,255,255,0.045)" stroke="rgba(255,255,255,0.10)" />
        ))}
      </svg>
      {label && (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/55">{label}</span>
      )}
    </div>
  )
}
