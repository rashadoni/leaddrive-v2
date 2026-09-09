"use client"

/**
 * Tiny attainment-over-time sparkline for the Arena drawer. Pure SVG polyline
 * normalised into a small box; stroke greens when the latest point ≥ the first,
 * reds otherwise, with a dot on the last point. Renders nothing for < 2 values
 * (cold-start: the hourly LeaderboardSnapshot cron is sparse early). Prisma-free
 * + decorative (aria-hidden) — the numeric delta beside it carries the meaning.
 */
export function Sparkline({ values, width = 104, height = 30 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const pad = 3
  const innerW = width - pad * 2
  const innerH = height - pad * 2
  const at = (v: number, i: number): readonly [number, number] => [
    pad + (i / (values.length - 1)) * innerW,
    pad + innerH - ((v - min) / range) * innerH,
  ]
  const pts = values.map((v, i) => at(v, i).map((n) => n.toFixed(1)).join(",")).join(" ")
  const up = values[values.length - 1] >= values[0]
  const stroke = up ? "hsl(150 60% 40%)" : "hsl(0 72% 50%)"
  const [lx, ly] = at(values[values.length - 1], values.length - 1)
  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <polyline
        points={pts}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r={2.2} fill={stroke} />
    </svg>
  )
}
