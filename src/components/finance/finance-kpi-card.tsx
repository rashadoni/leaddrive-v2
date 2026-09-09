"use client"

import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { DEFAULT_CURRENCY } from "@/lib/constants"

interface FinanceKpiCardProps {
  title: string
  value: number
  plan?: number
  planLabel?: string
  sub?: string
  icon: React.ReactNode
  color: string
  variance?: number
  variancePct?: number
  currency?: string
  invertVariance?: boolean // true for expenses: over plan = bad
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

export function FinanceKpiCard({ title, value, plan, planLabel, sub, icon, color, variance, variancePct, currency = DEFAULT_CURRENCY, invertVariance }: FinanceKpiCardProps) {
  const isPositive = invertVariance ? (variancePct ?? 0) <= 0 : (variancePct ?? 0) >= 0
  const varianceColor = variancePct === 0 || variancePct === undefined ? "text-muted-foreground" : isPositive ? "text-green-600" : "text-red-600"
  const VarianceIcon = variancePct === 0 || variancePct === undefined ? Minus : isPositive ? TrendingUp : TrendingDown

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm hover:shadow-md transition-all duration-300"
      style={{
        background: `linear-gradient(135deg, ${color}08 0%, ${color}18 100%)`,
        borderColor: `${color}20`,
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ backgroundColor: color }} />
      <div className="relative p-4 pt-5">
        <div className="flex justify-between items-start">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide leading-tight">{title}</p>
            <p className="text-2xl font-bold mt-1 tabular-nums tracking-tight leading-none">
              {fmt(value)} <span className="text-xs font-normal text-muted-foreground">{currency}</span>
            </p>
            {plan !== undefined && plan > 0 && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[10px] text-muted-foreground">{planLabel || "Plan"}: {fmt(plan)}</span>
                {variancePct !== undefined && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium ${varianceColor}`}>
                    <VarianceIcon className="w-3 h-3" />
                    {variancePct > 0 ? "+" : ""}{variancePct}%
                  </span>
                )}
              </div>
            )}
            {sub && <p className="text-[11px] text-muted-foreground mt-1 leading-tight">{sub}</p>}
          </div>
          <div className="p-2.5 rounded-xl shrink-0 ml-2" style={{ color, backgroundColor: `${color}12` }}>{icon}</div>
        </div>
      </div>
    </div>
  )
}
