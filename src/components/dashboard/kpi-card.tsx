"use client"

import { useCountUp } from "@/hooks/use-count-up"

function AnimatedNumber({ value }: { value: string | number }) {
  const num = typeof value === "string" ? parseFloat(value.replace(/[^0-9.-]/g, "")) : value
  const suffix = typeof value === "string" ? value.replace(/[0-9.,\-\s]/g, "").trim() : ""
  const isNum = !isNaN(num) && isFinite(num)
  const animated = useCountUp({ end: isNum ? num : 0, duration: 1400 })
  if (!isNum) return <>{value}</>
  return <>{animated}{suffix ? ` ${suffix}` : ""}</>
}

export function KpiCard({ title, value, sub, icon }: {
  title: string; value: string | number; sub?: string; icon: React.ReactNode; color?: string
}) {
  return (
    <div className="dashboard-kpi-card rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex flex-col gap-2 hover:shadow-md transition-all duration-200">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground truncate">{title}</span>
        <div className="h-7 w-7 rounded-lg flex items-center justify-center bg-muted/50 shrink-0 text-muted-foreground">
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-none tracking-tight"><AnimatedNumber value={value} /></p>
      {sub && <p className="text-[11px] text-muted-foreground leading-tight">{sub}</p>}
    </div>
  )
}
