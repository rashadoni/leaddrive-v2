/**
 * Whether a broken AI call earns one automatic callback.
 *
 * This module decides only. It performs no I/O and dials nobody, so every rule
 * below is testable in isolation — which matters more here than usual, because
 * the cost of a wrong "yes" is a real phone ringing in someone's pocket.
 *
 * The inputs come from two different kinds of knowledge, and they are kept
 * apart on purpose:
 *
 *   - What the PBX measured about the media: whether the agent still owed the
 *     caller audio when the line died, and how many provider sessions had to be
 *     rebuilt. The CRM cannot reconstruct either of these afterwards.
 *   - What the conversation meant: whether the agent had actually said goodbye.
 *     The PBX cannot know this; it is read from the transcript.
 *
 * A call is worth continuing when the media evidence says it was cut off and
 * the conversation evidence does not say it was finished.
 */

/** How long after the break a continuation still makes sense. */
export const CALLBACK_FRESHNESS_MS = 10 * 60 * 1000

/**
 * Below this, an "answered" call is someone hanging up on contact rather than a
 * conversation that got interrupted.
 */
export const CALLBACK_MIN_CALL_SECONDS = 5

export type CallbackRefusal =
  | "already_a_callback"
  | "agent_said_goodbye"
  | "no_break_evidence"
  | "call_too_short"
  | "stale_break"
  | "not_an_ai_call"

export type CallbackDecision =
  | { callback: true; reason: "agent_cut_off" | "provider_recovered" }
  | { callback: false; reason: CallbackRefusal }

export type CallbackEvidence = {
  /** True when the agent still had audio owed to the caller as the line died. */
  agentMidUtterance: boolean | null
  /** Provider sessions rebuilt during the call. */
  recoveryAttempts: number | null
  /** Read from the transcript, not from the PBX. */
  agentSaidGoodbye: boolean
  /** Set when this call is itself a callback, which never earns another. */
  continuesCallId: string | null
  callMode: string
  durationSeconds: number
  endedAt: Date
  now: Date
}

export function decideCallback(evidence: CallbackEvidence): CallbackDecision {
  if (evidence.callMode !== "ai") {
    return { callback: false, reason: "not_an_ai_call" }
  }
  // Exactly one retry. Checked before anything else so that no combination of
  // later rules can ever produce a second one.
  if (evidence.continuesCallId !== null) {
    return { callback: false, reason: "already_a_callback" }
  }
  // The owner's rule, and the one users would resent most if broken: a call
  // that reached its natural end must never be dialled again.
  if (evidence.agentSaidGoodbye) {
    return { callback: false, reason: "agent_said_goodbye" }
  }
  if (evidence.durationSeconds < CALLBACK_MIN_CALL_SECONDS) {
    return { callback: false, reason: "call_too_short" }
  }
  // A callback is a continuation, not a follow-up. Once the break is old the
  // customer has moved on, and this is also the guard that stops a stuck queue
  // from dialling someone in the middle of the night.
  if (evidence.now.getTime() - evidence.endedAt.getTime() > CALLBACK_FRESHNESS_MS) {
    return { callback: false, reason: "stale_break" }
  }
  if (evidence.agentMidUtterance === true) {
    return { callback: true, reason: "agent_cut_off" }
  }
  if ((evidence.recoveryAttempts ?? 0) > 0) {
    // The provider dropped at least once. Even if the agent happened to be
    // silent at the very end, the caller sat through a gap, and the recovery
    // telemetry shows a quarter of these never get their audio back at all.
    return { callback: true, reason: "provider_recovered" }
  }
  // Includes every call from a PBX build that predates the evidence fields:
  // nulls mean "not measured", and an unmeasured call is not a broken one.
  return { callback: false, reason: "no_break_evidence" }
}

/**
 * Azerbaijani farewells, matched on the agent's closing turns.
 *
 * This is deliberately a fixed list rather than a model call. It runs on the
 * path that decides whether to dial a customer, so it has to be predictable and
 * free: a model that hallucinates a goodbye suppresses a wanted callback, and
 * one that misses a goodbye dials someone who already said they were done.
 * Matching is accent-insensitive because transcripts vary in their diacritics.
 */
const FAREWELL_MARKERS = [
  "sag olun",
  "sagolun",
  "gorusheriik",
  "gorushek",
  "gorusheruk",
  "hoshcha qalin",
  "hoshca qalin",
  "xosh qalin",
  "ugurlar",
  "gununuz xosh",
  "axshaminiz xeyir",
  "sabahiniz xeyir",
  "yaxshi gunler",
  "elaqe saxlayacagiq",
]

/** Fold Azerbaijani diacritics so transcript spelling variance cannot hide a farewell. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ə/g, "e")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ş/g, "sh")
    .replace(/ç/g, "ch")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Whether the agent signed off. Only the agent's own last turns are considered:
 * a customer saying "sağ olun" before the line dies is exactly the case that
 * should still be called back, because the agent never got to close.
 */
export function agentSaidGoodbye(
  turns: ReadonlyArray<{ role: string; text: string }>,
  lastTurnsConsidered = 2,
): boolean {
  const agentTurns = turns.filter((turn) => turn.role === "agent")
  const closing = agentTurns.slice(-lastTurnsConsidered)
  return closing.some((turn) => {
    const folded = fold(turn.text)
    return FAREWELL_MARKERS.some((marker) => folded.includes(marker))
  })
}
