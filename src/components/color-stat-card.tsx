"use client"

import { cn } from "@/lib/utils"
import { type ReactNode, useState, useEffect, useRef } from "react"
import { InfoHint } from "@/components/info-hint"


function useCountUp(target: number, duration = 800) {
  const [value, setValue] = useState(0)
  const prevTarget = useRef(target)

  useEffect(() => {
    const from = prevTarget.current !== target ? prevTarget.current : 0
    prevTarget.current = target
    if (target === 0 && from === 0) return

    const startTime = performance.now()
    let raf: number

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (progress < 1) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])

  return value
}

function extractNumber(val: string | number): number | null {
  if (typeof val === "number") return val
  const str = String(val)
  const m = str.match(/([-]?[\d,]+(?:\.\d+)?)\s*([kKMB]?)/)
  if (!m) return null
  const num = parseFloat(m[1].replace(/,/g, ""))
  if (isNaN(num)) return null
  const unit = m[2]
  if (unit === "k" || unit === "K") return num * 1000
  if (unit === "M") return num * 1_000_000
  if (unit === "B") return num * 1_000_000_000
  return num
}

function animateValue(original: string | number, animated: number): string {
  if (typeof original === "number") return String(animated)
  const str = String(original)
  const match = str.match(/^([^0-9-]*)([-]?[\d,]+(?:\.\d+)?)(\s*[kKMB])(.*$)/)
  if (match) {
    const [, prefix, , unitWithSpace, suffix] = match
    const unit = unitWithSpace.trim()
    if (unit === "k" || unit === "K") {
      return prefix + Math.round(animated / 1000).toLocaleString() + unitWithSpace + suffix
    }
    if (unit === "M") {
      return prefix + (animated / 1_000_000).toFixed(1) + unitWithSpace + suffix
    }
    if (unit === "B") {
      return prefix + (animated / 1_000_000_000).toFixed(1) + unitWithSpace + suffix
    }
  }
  const stdMatch = str.match(/^([^0-9-]*)([-]?[\d,]+)(.*$)/)
  if (!stdMatch) return str
  const [, stdPrefix, , stdSuffix] = stdMatch
  return stdPrefix + animated.toLocaleString() + stdSuffix
}

interface ColorStatCardProps {
  label: string
  value: string | number
  icon: ReactNode
  className?: string
  subValue?: string
  lines?: { label: string; value: string }[]
  hint?: string
  animate?: boolean
}

export function ColorStatCard({
  label,
  value,
  icon,
  className,
  subValue,
  lines,
  hint,
  animate = false,
}: ColorStatCardProps) {
  const numericTarget = extractNumber(value)
  const animatedNum = useCountUp(animate && numericTarget !== null ? numericTarget : 0, 900)
  const displayValue = animate && numericTarget !== null ? animateValue(value, animatedNum) : value

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex flex-col gap-2 transition-all duration-200 hover:shadow-md",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground truncate">
            {label}
          </span>
          {hint && <InfoHint text={hint} size={12} />}
        </div>
        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-muted/50 shrink-0 text-muted-foreground">
          {icon}
        </div>
      </div>
      <span className="text-2xl font-semibold leading-tight tracking-tight tabular-nums text-foreground">
        {displayValue}
      </span>
      {subValue && (
        <span className="text-xs text-muted-foreground">{subValue}</span>
      )}
      {lines && lines.length > 0 && (
        <div className="mt-1 space-y-0.5 border-t border-zinc-200 dark:border-zinc-700 pt-1.5">
          {lines.map((line, i) => (
            <div key={i} className="flex justify-between text-xs text-muted-foreground">
              <span>{line.label}</span>
              <span className="font-medium text-foreground">{line.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
