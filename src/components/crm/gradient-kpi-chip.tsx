"use client"

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Creatio-style gradient KPI chip: saturated gradient card with a small
 * label on top and a big value + icon below. Meaning is carried by the
 * label text, not by the color alone (a11y).
 */
// Hues calibrated against the Creatio 10x reference screenshots
// (opportunity KPI chips): near-flat gradients, deeper teal/indigo.
const VARIANTS = {
  green: "from-green-500 to-green-600",
  teal: "from-teal-500 to-cyan-700",
  magenta: "from-fuchsia-600 to-pink-600",
  indigo: "from-indigo-600 to-violet-700",
  blue: "from-sky-500 to-blue-600",
  navy: "from-blue-700 to-indigo-900",
} as const

export type GradientKpiVariant = keyof typeof VARIANTS

export function GradientKpiChip({
  label,
  value,
  icon,
  variant,
  className,
}: {
  label: string
  value: string | number
  icon?: ReactNode
  variant: GradientKpiVariant
  className?: string
}) {
  return (
    <div
      className={cn(
        "rounded-lg bg-gradient-to-br text-white px-4 py-3 shadow-sm min-w-0",
        VARIANTS[variant],
        className,
      )}
    >
      <p className="text-[11px] font-medium text-white/85 truncate">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {icon && <span className="opacity-90 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <span className="text-xl font-bold leading-none truncate">{value}</span>
      </div>
    </div>
  )
}
