/**
 * Status marker = colour + SHAPE. The KPI Arena's red→amber→green scale is hard
 * for the ~8% of (male) users with red-green colour-vision deficiency, so each
 * status also gets a distinct glyph (▲▲ / ✓ / – / ▾ / ✕). Colour + shape = dual
 * channel, so statuses are distinguishable without relying on hue alone.
 *
 * Shared by the legend and the table so both views speak the same visual language.
 */
import { ChevronsUp, Check, Minus, ChevronDown, X, type LucideIcon } from "lucide-react"
import { STATUS_COLOR } from "@/lib/leaderboard/colors"
import type { AgentStatus } from "@/lib/leaderboard/types"

export const STATUS_GLYPH: Record<AgentStatus, LucideIcon> = {
  exceeding: ChevronsUp, // strongly up
  on_track: Check, // good
  behind: Minus, // flat / trailing
  at_risk: ChevronDown, // sliding down
  critical: X, // failing
}

export function StatusMarker({ status, className = "h-3 w-3" }: { status: AgentStatus; className?: string }) {
  const Icon = STATUS_GLYPH[status]
  return <Icon className={`${className} shrink-0`} style={{ color: STATUS_COLOR[status] }} strokeWidth={3} aria-hidden />
}
