"use client"

import { cn } from "@/lib/utils"

export function MiniBarChart({ data, color = "bg-violet-400", height = "h-8" }: { data: number[]; color?: string; height?: string }) {
  const max = Math.max(...data, 1)
  return (
    <div className={cn("flex items-end gap-[2px]", height)}>
      {data.map((v, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-t-sm", color)}
          style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  )
}

export function MiniLineChart({ data, color = "stroke-emerald-400" }: { data: number[]; color?: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
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
