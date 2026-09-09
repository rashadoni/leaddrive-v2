import { dateInputValueInTimezone, localDateTimeToUtc } from "@/lib/timezone"

/**
 * KPI Arena — shared, prisma-free types + pure helpers for the gamified
 * "Crypto Bubbles"-style agent leaderboard.
 *
 * Design: the API normalises 5 heterogeneous domains (sales / mtm / tickets /
 * projects / tasks) into ONE shape so a single bubble component renders all of
 * them. Per agent: `volume` drives the bubble RADIUS, `attainmentPct` drives the
 * COLOUR + the number printed inside (mirrors Crypto Bubbles: market-cap = size,
 * %-change = colour). Imported by both the API routes and the React UI, so it
 * carries NO server-only or React-only imports.
 */

export type LeaderboardGroup = "sales" | "mtm" | "tickets" | "projects" | "tasks"

/** day = rolling 24h; week = rolling 7d; month/quarter/year = calendar-to-date;
 *  all = lifetime. (No "hour": hourly KPI is noise for these domains.) */
export type LeaderboardPeriod = "day" | "week" | "month" | "quarter" | "year" | "all"

/** 5-state ladder reused from the quota engine vocabulary (collapsed). */
export type AgentStatus = "exceeding" | "on_track" | "behind" | "at_risk" | "critical"

/** How the UI should render a metric value (and the bubble's volume). */
export type ValueFormat = "count" | "currency" | "percent" | "minutes" | "days"

/** One drill-down row shown when an agent bubble is clicked. The UI owns the
 *  display label via i18n key `leaderboard.metrics.<key>`; the server returns
 *  only stable data so the API stays language-agnostic. */
export interface MetricDetail {
  key: string
  value: number
  format: ValueFormat
}

export interface NormalizedAgent {
  id: string
  name: string
  avatar?: string | null
  rank: number
  /** Headline work-output number (shown in the drill-down + legend). */
  volume: number
  volumeFormat: Extract<ValueFormat, "count" | "currency">
  /** Set when volumeFormat === "currency". */
  currency?: string
  /** % of personal KPI target — drives colour + the number inside the bubble.
   *  Can exceed 100 (over-achievement). */
  attainmentPct: number
  status: AgentStatus
  metrics: MetricDetail[]
}

export interface LeaderboardMeta {
  /** i18n keys the UI resolves for the legend / axis labels. */
  volumeLabelKey: string
  attainmentLabelKey: string
  /** Optional caveat key (e.g. sales sub-quarter periods snap to the quarter). */
  noteKey?: string
}

export interface LeaderboardResult {
  group: LeaderboardGroup
  period: LeaderboardPeriod
  agents: NormalizedAgent[]
  meta: LeaderboardMeta
}

export const ALL_GROUPS: LeaderboardGroup[] = ["sales", "mtm", "tickets", "projects", "tasks"]

/** group → ModuleId for the `hasModule` paid-feature gate (see src/lib/modules.ts). */
export const GROUP_TO_MODULE: Record<LeaderboardGroup, string> = {
  sales: "sales",
  mtm: "mtm",
  tickets: "support",
  projects: "crm",
  tasks: "crm",
}

export function isLeaderboardGroup(v: unknown): v is LeaderboardGroup {
  return typeof v === "string" && (ALL_GROUPS as string[]).includes(v)
}

export function isLeaderboardPeriod(v: unknown): v is LeaderboardPeriod {
  return v === "day" || v === "week" || v === "month" || v === "quarter" || v === "year" || v === "all"
}

/** Minimum-attainment-% bands for the 5-state status ladder. Lives here
 *  (prisma-free) so the API, the aggregators, and the config-loader all share
 *  ONE source of truth; the loader merges per-org overrides onto these. */
export interface StatusThresholds {
  exceeding: number
  on_track: number
  behind: number
  at_risk: number
}

/** Default status bands (mirror the quota-engine pacing). */
export const DEFAULT_STATUS_THRESHOLDS: StatusThresholds = Object.freeze({
  exceeding: 110,
  on_track: 90,
  behind: 70,
  at_risk: 50,
})

/** MTM composite-attainment weight keys + defaults. Lives here (prisma-free) so
 *  the config-loader AND the client config UI can both import them — config-loader
 *  pulls in `@/lib/prisma`, so a "use client" page must NOT import from it. */
export type MtmWeightKey = "task" | "photo" | "route"
export const DEFAULT_MTM_WEIGHTS: Readonly<Record<MtmWeightKey, number>> = Object.freeze({
  task: 0.5,
  photo: 0.3,
  route: 0.2,
})

/**
 * Map a KPI-attainment percentage onto the 5-state status ladder. Thresholds
 * default to the quota-engine pacing bands so colours read consistently across
 * groups; the arena route passes the per-org `LeaderboardConfig` bands so an
 * admin can retune what counts as "on track". `attainmentPct` is the same number
 * printed inside the bubble.
 */
export function statusFromAttainment(pct: number, t: StatusThresholds = DEFAULT_STATUS_THRESHOLDS): AgentStatus {
  if (pct >= t.exceeding) return "exceeding"
  if (pct >= t.on_track) return "on_track"
  if (pct >= t.behind) return "behind"
  if (pct >= t.at_risk) return "at_risk"
  return "critical"
}

/**
 * Start of the reporting window for a period (undefined = lifetime / "all").
 * `week` = rolling 7 days; `month`/`quarter` = calendar-to-date. Deterministic
 * given `now` so it's unit-testable.
 */
export function periodStart(period: LeaderboardPeriod, now: Date, timezone?: string): Date | undefined {
  if (period === "day") {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000)
  }
  if (period === "week") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  }
  if (timezone && period !== "all") {
    const localDate = dateInputValueInTimezone(now, timezone)
    if (!localDate) throw new Error("Could not resolve KPI Arena local date")
    const [yearText, monthText] = localDate.split("-")
    const month = Number(monthText)
    const startMonth = period === "month"
      ? month
      : period === "quarter"
        ? Math.floor((month - 1) / 3) * 3 + 1
        : 1
    const key = `${yearText}-${String(startMonth).padStart(2, "0")}-01`
    return localDateTimeToUtc(`${key}T00:00`, timezone)
  }
  if (period === "month") return new Date(now.getFullYear(), now.getMonth(), 1)
  if (period === "quarter") {
    const q = Math.floor(now.getMonth() / 3)
    return new Date(now.getFullYear(), q * 3, 1)
  }
  if (period === "year") return new Date(now.getFullYear(), 0, 1)
  return undefined
}

/** Round to 1 decimal place (shared by the aggregators). */
export function round1(n: number): number {
  return Math.round(n * 10) / 10
}
