/**
 * Page state machine — N2 Phase 6 Block D slice 1.
 *
 * Application-layer transition guards. DB also enforces the enum via
 * CHECK constraint.
 *
 * Pure synchronous.
 */
import {
  PAGE_STATUSES,
  PAGE_TRANSITIONS,
  type PageStatus,
} from "./types"

export function isPageStatus(s: unknown): s is PageStatus {
  return typeof s === "string" && (PAGE_STATUSES as readonly string[]).includes(s)
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

export function canPageTransition(
  from: PageStatus,
  to: PageStatus
): TransitionResult {
  if (!isPageStatus(from)) {
    return { ok: false, error: `page: from "${String(from)}" is not a known status` }
  }
  if (!isPageStatus(to)) {
    return { ok: false, error: `page: to "${String(to)}" is not a known status` }
  }
  if (from === to) {
    return { ok: false, error: `page: cannot transition from "${from}" to itself` }
  }
  const allowed = PAGE_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `page: "${from}" is a terminal status — no transitions allowed (clone-to-new-draft is the slice-2 workflow)`
          : `page: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function pageAllowedNext(from: PageStatus): readonly PageStatus[] {
  return PAGE_TRANSITIONS[from] ?? []
}

export function isPageTerminal(s: PageStatus): boolean {
  return PAGE_TRANSITIONS[s].length === 0
}
