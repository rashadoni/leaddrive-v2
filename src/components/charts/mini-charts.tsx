"use client"

import { cn } from "@/lib/utils"

/**
 * Every bar is drawn at least 4% tall so a small value stays visible — and so,
 * by default, is a zero. `zeroIsEmpty` draws a zero as nothing, so an empty
 * week cannot pass for a week with a little money in it. `titles` labels each
 * bar on hover.
 */
export function MiniBarChart({
  data,
  color = "bg-violet-400",
  height = "h-8",
  zeroIsEmpty = false,
  titles,
}: {
  data: number[]
  color?: string
  height?: string
  zeroIsEmpty?: boolean
  titles?: string[]
}) {
  const max = Math.max(...data, 1)
  return (
    <div className={cn("flex items-end gap-[2px]", height)}>
      {data.map((v, i) => (
        <div
          key={i}
          title={titles?.[i]}
          className={cn("flex-1 rounded-t-sm", color)}
          style={{ height: zeroIsEmpty && !(v > 0) ? "0%" : `${Math.max((v / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  )
}

/**
 * `max` puts several lines on one scale. Without it each line is stretched to
 * its own peak, so 30 opens draw as high as 3,000 sends.
 */
export function MiniLineChart({ data, color = "stroke-emerald-400", max: scaleMax }: { data: number[]; color?: string; max?: number }) {
  if (data.length < 2) return null
  const max = Math.max(...data, scaleMax ?? 0, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const w = 120
  const h = 32
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ")
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <polyline fill="none" className={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  )
}

export function MiniDonut({ segments, size = 48, thickness = 8 }: { segments: { pct?: number; value?: number; color: string }[]; size?: number; thickness?: number }) {
  const r = 18
  const circumference = 2 * Math.PI * r
  // If segments use `value` instead of `pct`, auto-calculate percentages
  const totalValue = segments.reduce((sum, s) => sum + (s.value || 0), 0)
  const resolvedSegments = segments.map(s => ({
    pct: s.pct ?? (totalValue > 0 ? ((s.value || 0) / totalValue) * 100 : 0),
    color: s.color,
  }))
  let offset = 0
  return (
    <svg width={size} height={size} viewBox="0 0 48 48">
      {resolvedSegments.map((s, i) => {
        const dash = (s.pct / 100) * circumference
        const el = (
          <circle
            key={i}
            cx="24" cy="24" r={r}
            fill="none" strokeWidth={thickness}
            stroke={s.color}
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-offset}
            transform="rotate(-90 24 24)"
          />
        )
        offset += dash
        return el
      })}
    </svg>
  )
}
