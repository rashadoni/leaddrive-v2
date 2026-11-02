"use client"

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"
import { useCrmAppearance } from "@/components/ui/crm-appearance"

/**
 * KPI chip with the shared neutral workspace surface. Legacy gradients remain
 * available outside the workspace. Labels carry the meaning in either mode.
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
  const workspace = useCrmAppearance()
  return (
    <div
      className={cn(
        "rounded-xl px-4 py-3 shadow-sm min-w-0",
        workspace ? "border border-border bg-card text-card-foreground" : `bg-gradient-to-br text-white ${VARIANTS[variant]}`,
        className,
      )}
    >
      <p className={cn("text-[11px] font-medium truncate", workspace ? "text-muted-foreground" : "text-white/85")}>{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {icon && <span className="opacity-90 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
        <span className="text-xl font-bold leading-none truncate">{value}</span>
      </div>
    </div>
  )
}
