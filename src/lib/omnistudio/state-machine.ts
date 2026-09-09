/**
 * Artifact + Session state machines — N16 Phase 6 Block D slice 2.
 *
 * FlexCard + OmniScript share the same publish lifecycle (draft /
 * published / archived). Session has its own lifecycle (in_progress
 * / completed / abandoned / failed). DB CHECKs enforce enum membership;
 * helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  ARTIFACT_STATUSES,
  ARTIFACT_TRANSITIONS,
  SESSION_STATUSES,
  SESSION_TRANSITIONS,
  type ArtifactStatus,
  type SessionStatus,
} from "./types"

export function isArtifactStatus(s: unknown): s is ArtifactStatus {
  return typeof s === "string" && (ARTIFACT_STATUSES as readonly string[]).includes(s)
}

export function isSessionStatus(s: unknown): s is SessionStatus {
  return typeof s === "string" && (SESSION_STATUSES as readonly string[]).includes(s)
}

export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string }

function check<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionResult {
  if (from === to) {
    return { ok: false, error: `${kind}: cannot transition from "${from}" to itself` }
  }
  const allowed = table[from]
  if (!allowed) {
    return { ok: false, error: `${kind}: unknown from-status "${String(from)}"` }
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canArtifactTransition(
  from: ArtifactStatus,
  to: ArtifactStatus
): TransitionResult {
  if (!isArtifactStatus(from)) {
    return { ok: false, error: `artifact: from "${String(from)}" is not a known status` }
  }
  if (!isArtifactStatus(to)) {
    return { ok: false, error: `artifact: to "${String(to)}" is not a known status` }
  }
  return check(from, to, ARTIFACT_TRANSITIONS, "artifact")
}

export function canSessionTransition(
  from: SessionStatus,
  to: SessionStatus
): TransitionResult {
  if (!isSessionStatus(from)) {
    return { ok: false, error: `session: from "${String(from)}" is not a known status` }
  }
  if (!isSessionStatus(to)) {
    return { ok: false, error: `session: to "${String(to)}" is not a known status` }
  }
  return check(from, to, SESSION_TRANSITIONS, "session")
}

export function artifactAllowedNext(from: ArtifactStatus): readonly ArtifactStatus[] {
  return ARTIFACT_TRANSITIONS[from] ?? []
}

export function sessionAllowedNext(from: SessionStatus): readonly SessionStatus[] {
  return SESSION_TRANSITIONS[from] ?? []
}

export function isArtifactTerminal(s: ArtifactStatus): boolean {
  return ARTIFACT_TRANSITIONS[s].length === 0
}

export function isSessionTerminal(s: SessionStatus): boolean {
  return SESSION_TRANSITIONS[s].length === 0
}
