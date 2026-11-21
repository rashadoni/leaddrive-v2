"use client"

/**
 * The stages of a deal as one thin track: passed stages carry a tick, the
 * current one is filled, and «lost» stands apart at the end — it is an
 * outcome, not the step after «won» (owner's prototype, 2026-11-21).
 */
import { Fragment } from "react"
import { Check, ChevronRight, Circle, CircleDot, CircleX, Trophy } from "lucide-react"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { splitStages, stageKind } from "@/lib/deals/deal-overview"

export interface TrackStage {
  name: string
  label: string
  isWon?: boolean | null
  isLost?: boolean | null
}

export function DealStageTrack({ stages, current, busy, ariaLabel, hint, onPick }: {
  stages: TrackStage[]
  current: string
  busy?: boolean
  ariaLabel: string
  /** The sentence under the cursor: what a press on this stage does. */
  hint: (stage: TrackStage, isCurrent: boolean) => string
  onPick: (stage: TrackStage) => void
}) {
  const { track, lost } = splitStages(stages)
  const currentIndex = track.findIndex((stage) => stage.name === current)

  const button = (stage: TrackStage, index: number | null) => {
    const kind = stageKind(stage)
    const isCurrent = stage.name === current
    const done = !isCurrent && index !== null && currentIndex > -1 && index < currentIndex
    const Icon = kind === "lost" ? CircleX : kind === "won" ? Trophy : isCurrent ? CircleDot : done ? Check : Circle
    return (
      <Hint text={hint(stage, isCurrent)}>
        <button
          type="button"
          data-crm-color-role="status"
          data-stage={stage.name}
          aria-label={stage.label}
          aria-current={isCurrent ? "step" : undefined}
          disabled={busy}
          onClick={() => { if (!isCurrent) onPick(stage) }}
          className={cn(
            "flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[13.5px] font-medium transition-colors disabled:opacity-60",
            kind === "lost" ? "flex-none sm:px-3.5" : isCurrent ? "flex-1" : "w-9 flex-none sm:w-auto sm:flex-1",
            isCurrent
              ? cn("font-semibold text-white", kind === "won" ? "bg-emerald-600" : kind === "lost" ? "bg-red-600" : "bg-[hsl(var(--crm-action,0_0%_9%))] text-[hsl(var(--crm-action-foreground,0_0%_100%))]")
              : cn("hover:bg-muted hover:text-foreground", done ? "text-foreground [&_svg]:text-emerald-600" : "text-muted-foreground"),
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden />
          <span className={cn("truncate", !isCurrent && "hidden sm:inline")}>{stage.label}</span>
        </button>
      </Hint>
    )
  }

  return (
    <div role="group" aria-label={ariaLabel} className="flex items-center gap-0.5 rounded-xl border border-border bg-card p-1 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      {track.map((stage, index) => (
        <Fragment key={stage.name}>
          {index > 0 && <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground/50 sm:block" aria-hidden />}
          {button(stage, index)}
        </Fragment>
      ))}
      {lost.length > 0 && track.length > 0 && <span className="mx-1 h-5 w-px shrink-0 bg-border sm:mx-1.5" aria-hidden />}
      {lost.map((stage) => <Fragment key={stage.name}>{button(stage, null)}</Fragment>)}
    </div>
  )
}
