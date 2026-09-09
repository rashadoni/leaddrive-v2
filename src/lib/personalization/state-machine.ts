/**
 * Experience state machine — C4 slice 1.
 *
 * Application-layer transition guards. DB CHECK enforces enum membership;
 * helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  EXPERIENCE_STATUSES,
  EXPERIENCE_TRANSITIONS,
  type ExperienceStatus,
} from "./types"

export function isExperienceStatus(s: unknown): s is ExperienceStatus {
  return typeof s === "string" && (EXPERIENCE_STATUSES as readonly string[]).includes(s)
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

export function canExperienceTransition(
  from: ExperienceStatus,
  to: ExperienceStatus
): TransitionResult {
  if (!isExperienceStatus(from)) {
    return { ok: false, error: `experience: from "${String(from)}" is not a known status` }
  }
  if (!isExperienceStatus(to)) {
    return { ok: false, error: `experience: to "${String(to)}" is not a known status` }
  }
  if (from === to) {
    return { ok: false, error: `experience: cannot transition from "${from}" to itself` }
  }
  const allowed = EXPERIENCE_TRANSITIONS[from]
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `experience: "${from}" is terminal — no transitions allowed`
          : `experience: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function experienceAllowedNext(s: ExperienceStatus): readonly ExperienceStatus[] {
  return EXPERIENCE_TRANSITIONS[s] ?? []
}

export function isExperienceTerminal(s: ExperienceStatus): boolean {
  return EXPERIENCE_TRANSITIONS[s].length === 0
}
