"use client"

import type { ReactNode } from "react"
import type { ResolvedDashboardWidget } from "@/lib/dashboard/resolve-widgets"
import { cn } from "@/lib/utils"

type DashboardGridProps = {
  widgets: ResolvedDashboardWidget[]
  renderWidget: (widget: ResolvedDashboardWidget) => ReactNode
}

export function DashboardGrid({ widgets, renderWidget }: DashboardGridProps) {
  return (
    <div className="dashboard-bento-flow grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 xl:auto-rows-[128px]">
      {widgets.map((widget) => (
        <div
          key={widget.id}
          data-dashboard-widget={widget.id}
          className={cn(
            "min-w-0",
            widget.size === "full" && "md:col-span-2 xl:col-span-3 xl:row-span-1",
            widget.size === "large" && "md:col-span-2 xl:col-span-2 xl:row-span-2",
            (widget.size === "standard" || widget.size === "medium" || widget.size === "side") && "min-h-[270px] xl:row-span-2 xl:min-h-0",
            widget.size === "compact" && "min-h-[180px] xl:row-span-1 xl:min-h-0"
          )}
        >
          {renderWidget(widget)}
        </div>
      ))}
    </div>
  )
}
