/**
 * KPI Arena — types for the per-agent "completed work items" drill-down list:
 * the deals / tasks / projects / tickets / completed-MTM-tasks behind an agent's
 * KPI %, shown as a list inside the drawer (the "why this %" evidence).
 *
 * Prisma-free + React-free so BOTH the API route AND the "use client" drawer can
 * import it without dragging `@/lib/prisma` into the client bundle (see the
 * client-build boundary rule). Kept as its OWN file — additive, no edit to the
 * shared `./types.ts` (avoids stepping on parallel work touching that file).
 */
import type { LeaderboardGroup, LeaderboardPeriod, ValueFormat } from "./types"

export interface AgentItem {
  id: string
  /** Row headline: deal name / task title / project name / ticket subject. */
  title: string
  /** Optional numeric value for the row (e.g. a deal's amount). */
  value?: number
  valueFormat?: Extract<ValueFormat, "currency" | "count">
  currency?: string
  /** ISO timestamp the item completed / closed (UI formats per locale). */
  date?: string
  /** Deliverables with a deadline: delivered on time? null = no deadline set. */
  onTime?: boolean | null
}

export interface AgentItemsResult {
  group: LeaderboardGroup
  period: LeaderboardPeriod
  agentId: string
  /** Capped at the fetch limit (see ITEM_LIMIT). */
  items: AgentItem[]
  /** Count returned (≤ limit). */
  total: number
  /** true when more rows exist than were returned (hit the cap). */
  capped: boolean
  /** i18n key for the list heading, e.g. `leaderboard.items.sales`. */
  labelKey: string
}
