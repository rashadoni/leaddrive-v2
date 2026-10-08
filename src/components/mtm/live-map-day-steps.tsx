"use client"

import Link from "next/link"
import { useEffect, useRef } from "react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"
import type { LiveMapDayStep, LiveMapDayStepState } from "@/lib/mtm/live-map-day-steps"

const BADGE: Record<LiveMapDayStepState, string> = {
  VISITED: "bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300",
  IN_VISIT: "bg-amber-400 text-amber-950",
  NEXT: "bg-indigo-500 text-white",
  PLANNED: "bg-muted text-muted-foreground",
  SKIPPED: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
}
const STATE_KEY: Record<LiveMapDayStepState, string> = {
  VISITED: "visited", IN_VISIT: "inVisit", NEXT: "next", PLANNED: "pending", SKIPPED: "skipped",
}

/**
 * The selected employee's day, step by step, under his card on the live map.
 * A step is a button: pressing it shows that stop on the map, and a stop
 * pressed on the map lights its step here. A stop without coordinates is
 * listed all the same — it happened or is planned — but cannot be pressed.
 */
export function LiveMapDaySteps({ steps, selectedOrder, onSelect, formatTime }: {
  steps: LiveMapDayStep[]
  selectedOrder: number | null
  onSelect: (orderIndex: number | null) => void
  formatTime: (value: string | null | undefined) => string
}) {
  const tMap = useTranslations("mtmMap")
  const selectedRef = useRef<HTMLLIElement | null>(null)
  // A stop chosen on the map may be below the fold of the list.
  useEffect(() => {
    if (selectedOrder !== null) selectedRef.current?.scrollIntoView?.({ block: "nearest" })
  }, [selectedOrder])

  return (
    <ol className="space-y-0.5" data-testid="live-map-day-steps">
      {steps.map((step) => {
        const selected = selectedOrder === step.orderIndex
        return (
          <li key={step.pointId} ref={selected ? selectedRef : undefined} className="flex items-start gap-1" data-testid={`live-map-day-step-${step.orderIndex}`}>
            <button
              type="button"
              disabled={!step.onMap}
              aria-pressed={selected}
              aria-label={tMap("routeStop.showOnMap", { number: step.sequence })}
              title={step.onMap ? tMap("routeStop.showOnMap", { number: step.sequence }) : tMap("routeStop.noCoordinates")}
              onClick={() => onSelect(selected ? null : step.orderIndex)}
              className={cn(
                "flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-1 text-left transition-colors",
                step.onMap ? "hover:bg-muted/60" : "cursor-default",
                selected && "bg-indigo-50 ring-1 ring-indigo-300 dark:bg-indigo-950/40 dark:ring-indigo-800",
              )}
            >
              <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", BADGE[step.state])}>
                {step.sequence}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground">{step.name || "—"}</span>
                <span className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className={step.state === "IN_VISIT" ? "font-medium text-amber-700 dark:text-amber-300" : undefined} data-state={step.state}>
                    {tMap(`routeStopStatus.${STATE_KEY[step.state]}`)}
                  </span>
                  {step.plannedTime ? <span>{tMap("routeStop.planned", { time: formatTime(step.plannedTime) })}</span> : null}
                  {step.checkInAt ? (
                    <span className="text-foreground">
                      {step.checkOutAt
                        ? tMap("routeStop.fact", { from: formatTime(step.checkInAt), to: formatTime(step.checkOutAt) })
                        : tMap("routeStop.factOpen", { from: formatTime(step.checkInAt) })}
                    </span>
                  ) : null}
                  {step.durationMinutes !== null && step.checkInAt ? <span>{tMap("eta.minutes", { count: step.durationMinutes })}</span> : null}
                  {step.overdueMinutes !== null ? (
                    <span className="font-medium text-red-600 dark:text-red-400" data-cue="overdue">{tMap("routeStop.overdue", { minutes: step.overdueMinutes })}</span>
                  ) : null}
                  {step.startedLateMinutes !== null ? (
                    <span className="text-amber-700 dark:text-amber-300" data-cue="started-late">{tMap("routeStop.startedLate", { minutes: step.startedLateMinutes })}</span>
                  ) : null}
                  {!step.onMap ? <span>{tMap("routeStop.noCoordinates")}</span> : null}
                </span>
              </span>
            </button>
            {step.visitId ? (
              <Link className="mt-1.5 shrink-0 text-primary hover:underline" href={`/mtm/visits?visitId=${encodeURIComponent(step.visitId)}`}>
                {tMap("routeStop.openVisit")}
              </Link>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
