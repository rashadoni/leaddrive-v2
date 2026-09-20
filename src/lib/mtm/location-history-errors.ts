/**
 * Turning a refusal code into something a manager can act on.
 *
 * The history endpoint answers with a code — precise for us, meaningless on
 * screen: `MTM_GPS_INVALID_RANGE` says nothing about the date field that was
 * mistyped. Known codes become sentences. An unknown code is not dressed up
 * as a cause we did not verify: the generic line is kept instead.
 */

const MESSAGE_KEYS: Record<string, string> = {
  MTM_GPS_INVALID_RANGE: "errorInvalidRange",
  MTM_GPS_AGENT_NOT_FOUND: "errorAgentNotFound",
  MTM_GPS_AGENT_OUT_OF_SCOPE: "errorAgentOutOfScope",
  MTM_GPS_TIMEZONE_FIXED: "errorTimezoneFixed",
}

export function historyErrorMessageKey(code: string): string {
  const known = MESSAGE_KEYS[code.trim()]
  if (known) return known
  // Anything shaped like one of our codes is still an internal name.
  return "loadFailed"
}

export function historyErrorMessage(code: string, t: (key: string) => string): string {
  const trimmed = code.trim()
  const known = MESSAGE_KEYS[trimmed]
  if (known) return t(known)
  // A sentence the server already wrote (a proxy, a gateway) is shown as is.
  return trimmed && !/^[A-Z][A-Z0-9_]+$/.test(trimmed) ? trimmed : t("loadFailed")
}
