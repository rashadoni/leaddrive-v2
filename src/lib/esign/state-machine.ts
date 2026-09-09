/**
 * Envelope + Signer state machines — M6 Phase 6 Block C slice 1.
 *
 * Application-layer transition guards. DB also enforces the enum
 * via CHECK constraints; the helper is the source of truth for
 * "what transitions are legal from where".
 *
 * Pure synchronous.
 */
import {
  ENVELOPE_STATUSES,
  ENVELOPE_TRANSITIONS,
  SIGNER_STATUSES,
  SIGNER_TRANSITIONS,
  type EnvelopeStatus,
  type SignerStatus,
} from "./types"

export function isEnvelopeStatus(s: unknown): s is EnvelopeStatus {
  return typeof s === "string" && (ENVELOPE_STATUSES as readonly string[]).includes(s)
}

export function isSignerStatus(s: unknown): s is SignerStatus {
  return typeof s === "string" && (SIGNER_STATUSES as readonly string[]).includes(s)
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; error: string }

function checkTransition<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionCheck {
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

export function canEnvelopeTransition(
  from: EnvelopeStatus,
  to: EnvelopeStatus
): TransitionCheck {
  if (!isEnvelopeStatus(from)) {
    return { ok: false, error: `envelope: from "${String(from)}" is not a known status` }
  }
  if (!isEnvelopeStatus(to)) {
    return { ok: false, error: `envelope: to "${String(to)}" is not a known status` }
  }
  return checkTransition(from, to, ENVELOPE_TRANSITIONS, "envelope")
}

export function canSignerTransition(
  from: SignerStatus,
  to: SignerStatus
): TransitionCheck {
  if (!isSignerStatus(from)) {
    return { ok: false, error: `signer: from "${String(from)}" is not a known status` }
  }
  if (!isSignerStatus(to)) {
    return { ok: false, error: `signer: to "${String(to)}" is not a known status` }
  }
  return checkTransition(from, to, SIGNER_TRANSITIONS, "signer")
}

export function envelopeAllowedNext(from: EnvelopeStatus): readonly EnvelopeStatus[] {
  return ENVELOPE_TRANSITIONS[from] ?? []
}

export function signerAllowedNext(from: SignerStatus): readonly SignerStatus[] {
  return SIGNER_TRANSITIONS[from] ?? []
}

export function isEnvelopeTerminal(s: EnvelopeStatus): boolean {
  return ENVELOPE_TRANSITIONS[s].length === 0
}

export function isSignerTerminal(s: SignerStatus): boolean {
  return SIGNER_TRANSITIONS[s].length === 0
}

/* ─── Envelope-completion derivation ──────────────────────────────────── */

export interface SignerSnapshot {
  role: "signer" | "cc" | "copy"
  status: SignerStatus
}

/**
 * Given a snapshot of all signers on an envelope, derive what the
 * envelope's new status SHOULD be. Caller passes the current envelope
 * status; helper returns the suggested target. Used by slice-2 hook
 * that runs after every signer-status change.
 *
 * Rules:
 *   • Any `role=signer` rejected → envelope `declined`.
 *   • All `role=signer` rows signed → envelope `completed`.
 *   • At least one `role=signer` has progressed past `sent` (viewed
 *     or signed) → envelope `in_progress`.
 *   • Otherwise no auto-progression suggestion → return null.
 *
 * Returns `null` if the envelope shouldn't auto-progress. Helper
 * does NOT decide between `voided` / `expired` — those are
 * caller-driven (admin click / cron).
 */
export function deriveEnvelopeStatus(
  currentStatus: EnvelopeStatus,
  signers: readonly SignerSnapshot[]
): EnvelopeStatus | null {
  if (isEnvelopeTerminal(currentStatus)) return null
  // Only `role=signer` rows count toward completion.
  const signerRows = signers.filter((s) => s.role === "signer")
  if (signerRows.length === 0) return null

  // Any declined → declined.
  if (signerRows.some((s) => s.status === "declined")) {
    return canEnvelopeTransition(currentStatus, "declined").ok ? "declined" : null
  }
  // All signed → completed.
  if (signerRows.every((s) => s.status === "signed")) {
    return canEnvelopeTransition(currentStatus, "completed").ok ? "completed" : null
  }
  // Any progressed past 'sent' → in_progress (if not already).
  const anyEngaged = signerRows.some(
    (s) => s.status === "viewed" || s.status === "signed"
  )
  if (anyEngaged && currentStatus !== "in_progress") {
    return canEnvelopeTransition(currentStatus, "in_progress").ok
      ? "in_progress"
      : null
  }
  return null
}
