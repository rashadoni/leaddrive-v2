"use client"

import { motion } from "framer-motion"
import { CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { canonicalDealStage } from "@/lib/deal-stage-normalization"

interface Stage {
  key: string
  label: string
  color: string
}

interface StageProgressProps {
  stages: Stage[]
  currentStage: string
  onStageClick?: (stageKey: string) => void
}

export function StageProgress({ stages, currentStage, onStageClick }: StageProgressProps) {
  // По смыслу, а не по написанию: у организации, переименовавшей проигрышную
  // стадию, полоса не переключалась в проигранный вид, а её чеврон продолжал
  // висеть у каждой открытой сделки.
  /*
   * Both sides folded, not just one.
   *
   * The earlier pass canonicalised the "is this lost" test and left the match
   * itself comparing raw strings. On a deal stored as CLOSED_WON against a
   * pipeline whose stages are named WON that match finds nothing: `currentIdx`
   * is -1, so no chevron is current and none is marked done — the owner opened
   * a won deal and saw an entirely blank progress bar.
   */
  const current = canonicalDealStage(currentStage)
  const isLost = current === "LOST"
  const activeStages = isLost ? stages : stages.filter(s => canonicalDealStage(s.key) !== "LOST")
  const currentIdx = activeStages.findIndex(s => canonicalDealStage(s.key) === current)

  return (
    <div className="flex items-center gap-0 w-full overflow-x-auto pb-1">
      {activeStages.map((stage, idx) => {
        const isActive = canonicalDealStage(stage.key) === current
        const isDone = !isLost && idx < currentIdx
        const isClickable = !!onStageClick && !isActive

        return (
          <div key={stage.key} className="flex items-center flex-1 min-w-0">
            <motion.button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStageClick?.(stage.key)}
              whileHover={isClickable ? { scale: 1.02 } : undefined}
              whileTap={isClickable ? { scale: 0.98 } : undefined}
              className={cn(
                "relative flex items-center justify-center h-10 flex-1 min-w-0 px-4",
                "text-xs font-semibold transition-all select-none",
                isActive && "text-white",
                isDone && "text-white/90",
                !isActive && !isDone && "text-muted-foreground bg-muted/40 dark:bg-muted/20",
                isClickable && "cursor-pointer hover:brightness-110",
                !isClickable && !isActive && "cursor-default",
              )}
              style={{
                background: isActive
                  ? stage.color
                  : isDone
                  ? stage.color + "88"
                  : undefined,
                clipPath: idx === 0
                  ? "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)"
                  : idx === activeStages.length - 1
                  ? "polygon(0 0, 100% 0, 100% 100%, 0 100%, 12px 50%)"
                  : "polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)",
              }}
            >
              <span className="truncate">{stage.label}</span>
              {isDone && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="ml-1 flex-shrink-0"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 opacity-80" />
                </motion.span>
              )}
            </motion.button>
          </div>
        )
      })}
    </div>
  )
}
