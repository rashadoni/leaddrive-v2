/**
 * D1/D2 (Creatio 10X roadmap) — MEDDPICC deal qualification.
 *
 * Deal.meddpicc holds { [blockKey]: { score?: 1-5, note?, next? } }. This
 * module owns the shape: the 8 canonical blocks (order = display order), the
 * parser that tolerates any stored garbage (fail-soft to "unscored"), and the
 * rollup the deal tab and the list column both render. Pure — unit-testable.
 */

export const MEDDPICC_BLOCKS = [
  "metrics",
  "economicBuyer",
  "decisionCriteria",
  "decisionProcess",
  "paperProcess",
  "identifyPain",
  "champion",
  "competition",
] as const

export type MeddpiccBlockKey = (typeof MEDDPICC_BLOCKS)[number]

/** One letter per block for the compact list-column rendering (M E D D P I C C). */
export const MEDDPICC_LETTERS: Record<MeddpiccBlockKey, string> = {
  metrics: "M",
  economicBuyer: "E",
  decisionCriteria: "D",
  decisionProcess: "D",
  paperProcess: "P",
  identifyPain: "I",
  champion: "C",
  competition: "C",
}

export interface MeddpiccBlock {
  /** 1 (missing/at risk) … 5 (nailed down); undefined = not assessed yet. */
  score?: number
  /** Why this score. */
  note?: string
  /** What to do next to improve it. */
  next?: string
}

export type MeddpiccData = Partial<Record<MeddpiccBlockKey, MeddpiccBlock>>

const clampScore = (v: unknown): number | undefined => {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
}

/** Parse whatever is stored on the deal into a well-formed MeddpiccData. */
export function parseMeddpicc(raw: unknown): MeddpiccData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: MeddpiccData = {}
  for (const key of MEDDPICC_BLOCKS) {
    const b = (raw as Record<string, unknown>)[key]
    if (!b || typeof b !== "object" || Array.isArray(b)) continue
    const block = b as Record<string, unknown>
    const score = clampScore(block.score)
    const note = typeof block.note === "string" ? block.note.slice(0, 2000) : undefined
    const next = typeof block.next === "string" ? block.next.slice(0, 2000) : undefined
    if (score !== undefined || note || next) out[key] = { score, note, next }
  }
  return out
}

export type MeddpiccStatus = "unscored" | "red" | "yellow" | "green"

export interface MeddpiccSummary {
  /** Blocks with a score, 0..8. */
  scored: number
  /** Sum of the given scores (unscored blocks contribute 0). */
  totalScore: number
  /** Max possible = 40. */
  maxScore: number
  /** Average over the SCORED blocks only; null when nothing is scored. */
  avgScore: number | null
  /**
   * Rollup for the badge/column sort: unscored → nothing assessed;
   * red avg < 2.5, yellow < 3.5, green ≥ 3.5 — but any unscored block caps
   * the status at yellow (an unqualified dimension IS a risk).
   */
  status: MeddpiccStatus
}

export function summarizeMeddpicc(data: MeddpiccData): MeddpiccSummary {
  let scored = 0
  let total = 0
  for (const key of MEDDPICC_BLOCKS) {
    const s = data[key]?.score
    if (s !== undefined) {
      scored++
      total += s
    }
  }
  const avg = scored > 0 ? total / scored : null
  let status: MeddpiccStatus
  if (avg === null) status = "unscored"
  else if (avg < 2.5) status = "red"
  else if (avg < 3.5 || scored < MEDDPICC_BLOCKS.length) status = "yellow"
  else status = "green"
  return {
    scored,
    totalScore: total,
    maxScore: MEDDPICC_BLOCKS.length * 5,
    avgScore: avg,
    status,
  }
}

/** Per-block color bucket for the letter chips (red 1-2 / yellow 3 / green 4-5). */
export function scoreBucket(score: number | undefined): "none" | "red" | "yellow" | "green" {
  if (score === undefined) return "none"
  if (score <= 2) return "red"
  if (score === 3) return "yellow"
  return "green"
}
