/**
 * Bubble colour scale for the KPI Arena. Pure + framework-free so it's shared
 * by the React bubbles and unit-tested in isolation.
 *
 * Maps `attainmentPct` (the number printed inside a bubble) onto a red → amber →
 * green gradient, the same metaphor as Crypto Bubbles' %-change colouring:
 * green = beating the KPI target, red = far behind. The pct is clamped to
 * [0, 150] for the gradient so a 400%-overachiever and a 150%-overachiever look
 * equally "max green" (the bubble SIZE, not colour, conveys raw magnitude).
 */
import { type AgentStatus, DEFAULT_STATUS_THRESHOLDS, statusFromAttainment, type StatusThresholds } from "./types"

export interface BubbleColor {
  /** Main fill (translucent in the UI). */
  fill: string
  /** Ring / stroke + label colour (opaque). */
  ring: string
  /** Raw HSL hue (0=red … 150=deep green) — lets the UI build a radial
   *  gradient + glow at varying lightness for the Crypto-Bubbles orb look. */
  hue: number
  status: AgentStatus
}

/**
 * Hue mapped onto the SAME status bands the legend uses, so the orb colour matches
 * the status: critical→red, at_risk→orange, behind→amber, on_track→GREEN,
 * exceeding→deep green. (Bug fix: green used to start only at 110%, so a 91%
 * on-track agent rendered amber while its status dot was green.) `hueFor` accepts
 * the thresholds, but the Arena board's clients call `attainmentColor(pct)` with
 * the DEFAULTS — the API doesn't return per-org thresholds to the client yet — so
 * the BOARD colours by the default bands; only the settings live-preview passes the
 * edited thresholds. Threading per-org colour through to the board is a follow-up
 * (needs the API payload + agent-detail-card/leaderboard-table, currently parked).
 */
function hueFor(pct: number, t: StatusThresholds): number {
  if (pct >= t.exceeding) return Math.min(150, 130 + (pct - t.exceeding) * 0.4) // deep green
  if (pct >= t.on_track) return 100 + ((pct - t.on_track) / Math.max(1, t.exceeding - t.on_track)) * 30 // 100→130 green
  if (pct >= t.behind) return 42 + ((pct - t.behind) / Math.max(1, t.on_track - t.behind)) * 20 // 42→62 amber→yellow
  if (pct >= t.at_risk) return 22 + ((pct - t.at_risk) / Math.max(1, t.behind - t.at_risk)) * 20 // 22→42 orange→amber
  return Math.max(0, (pct / Math.max(1, t.at_risk)) * 22) // 0→22 red→orange
}

export function attainmentColor(pct: number, thresholds: StatusThresholds = DEFAULT_STATUS_THRESHOLDS): BubbleColor {
  // Clamp to [0,150] for the hue (so 150% and 400% read as the same max green);
  // the status uses the raw pct (400% is still "exceeding").
  const hue = Math.round(hueFor(Math.max(0, Math.min(150, pct)), thresholds))
  return {
    fill: `hsl(${hue} 70% 45%)`,
    ring: `hsl(${hue} 75% 60%)`,
    hue,
    status: statusFromAttainment(pct, thresholds),
  }
}

/** Discrete status → token, for legends / badges where a gradient is overkill. */
export const STATUS_COLOR: Record<AgentStatus, string> = {
  exceeding: "hsl(150 75% 45%)",
  on_track: "hsl(110 70% 45%)",
  behind: "hsl(45 80% 50%)",
  at_risk: "hsl(25 85% 52%)",
  critical: "hsl(0 80% 52%)",
}
