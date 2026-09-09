/**
 * Human-readable dial-failure diagnostics for PBX (asterisk) calls.
 *
 * The PBX reports the raw Asterisk DIALSTATUS token and the Q.850 clearing
 * cause alongside the collapsed providerOutcome. This module decides when that
 * evidence is worth showing and which localized label it maps to; the actual
 * strings live in messages/*.json under `voip.dialDiagnostics` so all three
 * locales stay in sync via check-translations.
 *
 * Unknown tokens and causes are still rendered — raw — because a code we did
 * not anticipate is exactly the one an operator needs to quote to the trunk
 * provider. The known-sets below only gate the i18n lookup, never visibility.
 */

export type DialDiagnosticSource = {
  provider?: string | null
  providerOutcome?: string | null
  providerDialStatus?: string | null
  providerHangupCause?: string | null
}

export type DialDiagnostic = {
  dialStatus: string | null
  hangupCause: string | null
}

/** DIALSTATUS tokens with a localized label (voip.dialDiagnostics.status.*). */
export const KNOWN_DIAL_STATUSES = new Set([
  "BUSY",
  "NOANSWER",
  "CANCEL",
  "CHANUNAVAIL",
  "CONGESTION",
  "DONTCALL",
  "TORTURE",
  "INVALIDARGS",
])

/** Q.850 causes with a localized label (voip.dialDiagnostics.cause.*). */
export const KNOWN_HANGUP_CAUSES = new Set([
  "1", "16", "17", "18", "19", "21", "22", "27", "28", "29",
  "34", "38", "41", "42", "44", "47", "58", "88", "102", "127",
])

/**
 * Returns the raw dial evidence when it is worth showing to an operator, or
 * null otherwise. A connected call carries no failure to explain, and only
 * asterisk writes these columns, so anything else is noise.
 */
export function dialFailureDiagnostic(call: DialDiagnosticSource): DialDiagnostic | null {
  if (call.provider !== "asterisk") return null
  if (call.providerOutcome === "connected") return null
  const dialStatus = call.providerDialStatus?.trim() || null
  // The cause is stored verbatim; a zero-padded "017" must still find the
  // "17" label, so canonicalize only for display.
  const hangupCause = call.providerHangupCause?.trim().replace(/^0+(?=[0-9])/, "") || null
  if (!dialStatus && !hangupCause) return null
  return { dialStatus, hangupCause }
}

/**
 * One operator-facing line, e.g.
 * "CHANUNAVAIL — Channel unavailable · Q.850 1 — Unallocated number".
 * `t` is a translator scoped to the `voip` namespace.
 */
export function formatDialDiagnostic(
  diagnostic: DialDiagnostic,
  t: (key: string) => string,
): string {
  const parts: string[] = []
  if (diagnostic.dialStatus) {
    parts.push(
      KNOWN_DIAL_STATUSES.has(diagnostic.dialStatus)
        ? `${diagnostic.dialStatus} — ${t(`dialDiagnostics.status.${diagnostic.dialStatus}`)}`
        : diagnostic.dialStatus,
    )
  }
  if (diagnostic.hangupCause) {
    parts.push(
      KNOWN_HANGUP_CAUSES.has(diagnostic.hangupCause)
        ? `Q.850 ${diagnostic.hangupCause} — ${t(`dialDiagnostics.cause.${diagnostic.hangupCause}`)}`
        : `Q.850 ${diagnostic.hangupCause}`,
    )
  }
  return parts.join(" · ")
}
