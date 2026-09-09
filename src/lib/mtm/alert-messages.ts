/**
 * Alert text is assembled where it is read, not where it is written.
 *
 * Field UX audit 2026-09-05, task A4: every `MtmAlert` was stored as an English
 * sentence built at generation time — "Agent is 800m away from planned route
 * (max 500m)". An Azerbaijani rep opening the app, and the manager reading the
 * web list in Russian, both got that English string, because by then the
 * numbers were already baked into it and nothing could be translated.
 *
 * So the generator now also records WHAT happened and WITH WHICH NUMBERS:
 * `messageKey` plus `messageParams` inside `metadata`. Readers translate from
 * those. `title` and `description` stay exactly as they were — they are the
 * fallback for the millions of rows written before this change, and dropping
 * them would blank out every historical alert in the list.
 *
 * Why `metadata` and not two new columns: the params are already there (every
 * generator writes distances, radii and ids into it), the table is large and
 * under RLS, and a migration would buy a schema that says the same thing. If a
 * future reader needs to filter or index by key, that is the moment to promote
 * it to a column, with a backfill that has something to read.
 */

/** The alert sentences this product can produce. One key per real situation. */
export const MTM_ALERT_MESSAGE_KEYS = [
  /** Cron found a visit still open past the auto-checkout threshold. */
  "visitStillOpen",
  /** Same, for a visit whose customer row carries no name. */
  "visitStillOpenUnnamed",
  /** A check-in was attempted outside the customer's geofence and refused. */
  "outOfZoneCheckIn",
  /** A privileged actor forced that same check-in through. */
  "outOfZoneCheckInForced",
  /** A stored visit landed outside the geofence (web write paths). */
  "geofenceViolation",
  /** Same, for a customer row that carries no name. */
  "geofenceViolationUnnamed",
  /** A GPS point put the agent off the planned route corridor. */
  "routeDeviation",
  /** Same event, addressed to the agent's own phone: second person, no name. */
  "agentRouteDeviation",
  /** The agent's own check-in was recorded outside the geofence. */
  "agentOutOfZoneCheckIn",
  /** Same, for a customer row that carries no name. */
  "agentOutOfZoneCheckInUnnamed",
] as const

export type MtmAlertMessageKey = (typeof MTM_ALERT_MESSAGE_KEYS)[number]

/**
 * Parameter names each key expects. Kept next to the keys so a translator and a
 * generator cannot drift apart silently: the test asserts every key's params
 * appear in every locale's string.
 */
export const MTM_ALERT_MESSAGE_PARAMS: Record<MtmAlertMessageKey, readonly string[]> = {
  visitStillOpen: ["customerName", "minutes", "thresholdMinutes"],
  visitStillOpenUnnamed: ["minutes", "thresholdMinutes"],
  outOfZoneCheckIn: ["distanceMeters", "geofenceRadius"],
  outOfZoneCheckInForced: ["distanceMeters", "geofenceRadius"],
  geofenceViolation: ["customerName", "distanceMeters", "geofenceRadius"],
  geofenceViolationUnnamed: ["distanceMeters", "geofenceRadius"],
  routeDeviation: ["deviationMeters", "thresholdMeters"],
  agentRouteDeviation: ["deviationMeters"],
  agentOutOfZoneCheckIn: ["customerName", "distanceMeters", "geofenceRadius"],
  agentOutOfZoneCheckInUnnamed: ["distanceMeters", "geofenceRadius"],
}

export type MtmAlertMessageParams = Record<string, string | number>

/**
 * The pair to spread into an alert's `metadata`. Generators keep writing their
 * own fields alongside it; this only adds the two that make the row readable in
 * a language nobody chose at write time.
 */
export function mtmAlertMessage(
  key: MtmAlertMessageKey,
  params: MtmAlertMessageParams,
): { messageKey: MtmAlertMessageKey; messageParams: MtmAlertMessageParams } {
  return { messageKey: key, messageParams: params }
}

/**
 * Pairs of sentences that differ only by whether a customer name is available.
 *
 * The name comes from a database row, and a row with an empty name is not a
 * theory: the first agent review of #1137 caught this on the cron path, where
 * a nameless customer rendered «Визит в «» открыт уже 40 мин» — a defect the
 * "does this key have all its params?" check cannot see, because an empty
 * string IS a value.
 *
 * Fixing it call site by call site invites the next call site to forget, so the
 * pairing lives here as data and {@link mtmAlertMessageForCustomer} picks the
 * right half.
 */
const UNNAMED_VARIANT: Partial<Record<MtmAlertMessageKey, MtmAlertMessageKey>> = {
  visitStillOpen: "visitStillOpenUnnamed",
  geofenceViolation: "geofenceViolationUnnamed",
  agentOutOfZoneCheckIn: "agentOutOfZoneCheckInUnnamed",
}

/**
 * Like {@link mtmAlertMessage}, but for the sentences that name a customer.
 * A blank name (missing, empty, or whitespace) switches to the paired sentence
 * that does not mention one, instead of rendering a pair of empty quotes.
 */
export function mtmAlertMessageForCustomer(
  key: keyof typeof UNNAMED_VARIANT & MtmAlertMessageKey,
  customerName: string | null | undefined,
  params: MtmAlertMessageParams,
): { messageKey: MtmAlertMessageKey; messageParams: MtmAlertMessageParams } {
  const name = typeof customerName === "string" ? customerName.trim() : ""
  if (name) return mtmAlertMessage(key, { ...params, customerName: name })
  const unnamed = UNNAMED_VARIANT[key]
  // A key with no pair would be a programming error; falling back to the named
  // sentence with an empty name is exactly the render we are avoiding, so use
  // the named key only when there is genuinely nothing else.
  return mtmAlertMessage(unnamed ?? key, unnamed ? params : { ...params, customerName: "" })
}

export type MtmAlertMessage =
  | { kind: "localized"; key: MtmAlertMessageKey; params: MtmAlertMessageParams }
  | { kind: "legacy" }

/**
 * Reads back what a generator stored. Anything unrecognised — an older row, a
 * key this deployment does not know yet, params of the wrong shape — is
 * reported as `legacy` so the caller shows the stored English sentence instead
 * of an empty card. A missing translation must never cost the reader the alert.
 */
export function readMtmAlertMessage(metadata: unknown): MtmAlertMessage {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return { kind: "legacy" }
  const { messageKey, messageParams } = metadata as Record<string, unknown>
  if (typeof messageKey !== "string") return { kind: "legacy" }
  if (!(MTM_ALERT_MESSAGE_KEYS as readonly string[]).includes(messageKey)) return { kind: "legacy" }
  const key = messageKey as MtmAlertMessageKey
  const params: MtmAlertMessageParams = {}
  if (messageParams && typeof messageParams === "object" && !Array.isArray(messageParams)) {
    for (const [name, value] of Object.entries(messageParams as Record<string, unknown>)) {
      if (typeof value === "string" || typeof value === "number") params[name] = value
    }
  }
  // A key whose numbers did not survive would render as "Agent is {deviationMeters} m
  // away" — worse than the English sentence that at least carries the distance.
  for (const name of MTM_ALERT_MESSAGE_PARAMS[key]) {
    if (!(name in params)) return { kind: "legacy" }
  }
  return { kind: "localized", key, params }
}
