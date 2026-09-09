"use client"

import { cn } from "@/lib/utils"
import { useCountUp } from "@/hooks/use-count-up"

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon?: React.ReactNode
  trend?: "up" | "down" | "neutral"
  className?: string
  accentColor?: "blue" | "green" | "red" | "amber" | "violet" | "indigo" | "orange" | "teal" | "navy"
}

const ACCENT_HEX: Record<string, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  red: "#ef4444",
  amber: "#f59e0b",
  violet: "#8b5cf6",
  indigo: "#6366f1",
  orange: "#f97316",
  teal: "#EA580C",
  navy: "#001E3C",
}

const ACCENT_ICON_BG: Record<string, string> = {
  blue: "bg-orange-500/10 text-orange-500",
  green: "bg-emerald-500/10 text-emerald-500",
  red: "bg-red-500/10 text-red-500",
  amber: "bg-amber-500/10 text-amber-500",
  violet: "bg-violet-500/10 text-violet-500",
  indigo: "bg-orange-500/10 text-orange-500",
  orange: "bg-orange-500/10 text-orange-500",
  teal: "bg-primary/10 text-primary",
  navy: "bg-[#001E3C]/10 text-[#001E3C]",
}

const TREND_ICONS: Record<string, string> = {
  up: "↑",
  down: "↓",
}

function AnimatedValue({ value }: { value: string | number }) {
  const numericValue = typeof value === "string" ? parseFloat(value.replace(/[^0-9.-]/g, "")) : value
  const suffix = typeof value === "string" ? value.replace(/[0-9.,\-\s]/g, "").trim() : ""
  const isNumeric = !isNaN(numericValue) && isFinite(numericValue)

  const animated = useCountUp({
    end: isNumeric ? numericValue : 0,
    duration: 1200,
    decimals: typeof value === "string" && value.includes(".") ? 1 : 0,
  })

  if (!isNumeric) return <>{value}</>
  return <>{animated}{suffix ? ` ${suffix}` : ""}</>
}

export function StatCard({ title, value, description, icon, trend, className, accentColor }: StatCardProps) {
  const glowColor = accentColor ? ACCENT_HEX[accentColor] : "#EA580C"
  const iconBg = accentColor ? ACCENT_ICON_BG[accentColor] : "bg-primary/10 text-primary"

  return (
    <div className={cn(
      "relative overflow-hidden rounded-xl",
      "bg-white/60 dark:bg-white/[0.08]",
      "backdrop-blur-[12px]",
      "border border-white/30 dark:border-white/[0.12]",
      "shadow-lg shadow-black/[0.03]",
      "hover:shadow-xl hover:shadow-black/[0.06]",
      "transition-all duration-300",
      className,
    )}>
      {/* Glow effect underneath */}
      <div
        className="absolute -bottom-3 left-6 right-6 h-6 rounded-full blur-xl opacity-30"
        style={{ backgroundColor: glowColor }}
      />

      <div className="relative flex flex-row items-center justify-between pb-1 pt-4 px-5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        {icon && (
          <div className={cn("rounded-full p-2", iconBg)}>
            {icon}
          </div>
        )}
      </div>
      <div className="relative px-5 pb-4">
        <div className="text-2xl font-bold tracking-tight">
          <AnimatedValue value={value} />
        </div>
        {(description || trend) && (
          <p className={cn(
            "mt-1 text-xs font-medium",
            trend === "up" ? "text-green-600" : trend === "down" ? "text-red-600" : "text-muted-foreground"
          )}>
            {trend && TREND_ICONS[trend] && <span className="mr-0.5">{TREND_ICONS[trend]}</span>}
            {description}
          </p>
        )}
      </div>
    </div>
  )
}
