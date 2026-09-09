/**
 * KpiCard (M2-3) — Mars-style KPI card with target vs actual progress bar.
 *
 * Shows a metric name, current value, optional target, and a colour-coded
 * progress arc/bar.  Used in the MTM analytics page for the 5 Mars KPIs.
 */
import { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type KpiCardColor = "teal" | "green" | "blue" | "amber" | "red" | "violet"

interface KpiCardProps {
  label: string
  value: number
  unit?: string
  /** Target value; when provided shows a progress bar and delta. */
  target?: number
  icon?: React.ReactNode
  color?: KpiCardColor
  /** Small descriptive text below the value */
  description?: string
  className?: string
}

const colorMap: Record<KpiCardColor, { bar: string; text: string; bg: string }> = {
  teal:   { bar: "bg-teal-500",   text: "text-teal-600",   bg: "bg-teal-50" },
  green:  { bar: "bg-green-500",  text: "text-green-600",  bg: "bg-green-50" },
  blue:   { bar: "bg-blue-500",   text: "text-blue-600",   bg: "bg-blue-50" },
  amber:  { bar: "bg-amber-500",  text: "text-amber-600",  bg: "bg-amber-50" },
  red:    { bar: "bg-red-500",    text: "text-red-600",    bg: "bg-red-50" },
  violet: { bar: "bg-violet-500", text: "text-violet-600", bg: "bg-violet-50" },
}

export function KpiCard({
  label,
  value,
  unit,
  target,
  icon,
  color = "teal",
  description,
  className,
}: KpiCardProps) {
  const c = colorMap[color]
  const progress = target && target > 0
    ? Math.min(Math.round((value / target) * 100), 100)
    : null

  // Colour-code progress: green ≥ 90%, amber 70-89%, red < 70%
  const progressColor =
    progress === null ? c.bar :
    progress >= 90 ? "bg-green-500" :
    progress >= 70 ? "bg-amber-500" :
    "bg-red-500"

  return (
    <div className={cn("rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-2", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted-foreground leading-tight">{label}</p>
        {icon && (
          <span className={cn("p-1.5 rounded-md", c.bg, c.text)}>
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-end gap-1">
        <span className={cn("text-2xl font-bold tabular-nums", c.text)}>
          {value.toLocaleString()}
        </span>
        {unit && <span className="text-sm text-muted-foreground mb-0.5">{unit}</span>}
        {target !== undefined && (
          <span className="text-xs text-muted-foreground mb-0.5 ml-1">
            / {target}{unit}
          </span>
        )}
      </div>

      {progress !== null && (
        <div className="space-y-1">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", progressColor)}
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground">{progress}% of target</p>
        </div>
      )}

      {description && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}
    </div>
  )
}
