"use client"

import { cn } from "@/lib/utils"
import { type ReactNode, useState, useEffect, useRef } from "react"
import { InfoHint } from "@/components/info-hint"

/** The first number in a tile's value as it is written, e.g. "1,234.5" in "₼1,234.5". */
const NUMBER_TOKEN = /[-]?[\d,]+(?:\.\d+)?/

function fractionDigits(val: string | number): number {
  const token = String(val).match(NUMBER_TOKEN)?.[0] ?? ""
  return token.split(".")[1]?.length ?? 0
}

function useCountUp(target: number, duration = 800, decimals = 0) {
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
      // Frames keep the target's own precision and the last one is the target
      // itself. Rounding to whole numbers left the tail behind: «0.5» counted
      // up to 1, kept «.5», and the tile read «1.5».
      setValue(progress < 1 ? Number((from + (target - from) * eased).toFixed(decimals)) : target)
      if (progress < 1) raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, decimals])

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

/** `n` written the way `token` is: same decimals, thousands commas only if it has them. */
function formatLike(n: number, token: string): string {
  const decimals = token.split(".")[1]?.length ?? 0
  return token.includes(",")
    ? n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : n.toFixed(decimals)
}

function animateValue(original: string | number, animated: number): string {
  if (typeof original === "number") return formatLike(animated, String(original))
  const str = String(original)
  const match = str.match(/^([^0-9-]*)([-]?[\d,]+(?:\.\d+)?)(\s*[kKMB])(.*$)/)
  if (match) {
    const [, prefix, token, unitWithSpace, suffix] = match
    const unit = unitWithSpace.trim()
    if (unit === "k" || unit === "K") return prefix + formatLike(animated / 1000, token) + unitWithSpace + suffix
    if (unit === "M") return prefix + formatLike(animated / 1_000_000, token) + unitWithSpace + suffix
    if (unit === "B") return prefix + formatLike(animated / 1_000_000_000, token) + unitWithSpace + suffix
  }
  const stdMatch = str.match(/^([^0-9-]*)([-]?[\d,]+(?:\.\d+)?)(.*$)/)
  if (!stdMatch) return str
  const [, stdPrefix, stdToken, stdSuffix] = stdMatch
  return stdPrefix + formatLike(animated, stdToken) + stdSuffix
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
  /** Let a long label wrap instead of truncating — for tiles that sit two to a row on a phone. */
  wrapLabel?: boolean
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
  wrapLabel = false,
}: ColorStatCardProps) {
  const numericTarget = extractNumber(value)
  const animatedNum = useCountUp(animate && numericTarget !== null ? numericTarget : 0, 900, fractionDigits(value))
  // Once the count-up lands, the tile shows the value exactly as it was given.
  const counting = animate && numericTarget !== null && animatedNum !== numericTarget
  const displayValue = counting ? animateValue(value, animatedNum) : value

  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex flex-col gap-2 transition-all duration-200 hover:shadow-md",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        {/* min-w-0: without it a long label pushes the icon out of the card. */}
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("text-xs font-medium text-muted-foreground", wrapLabel ? "break-words leading-snug" : "truncate")}>
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
