import { boundedNumber, hex, oneOf, own } from "./safe-fields"

const SUPPORT_OPERATIONS = ["CATEGORY_LIST", "CATEGORY_CREATE", "CATEGORY_RENAME", "CATEGORY_DELETE"] as const
const SUPPORT_REASONS = ["INVALID_CONTEXT", "ARTIFACT_UNAVAILABLE", "TENANT_KEY_UNAVAILABLE", "CLOCK_UNAVAILABLE", "MODE_INVALID", "RESPONSE_UNAVAILABLE"] as const
const ROUTE_OPERATIONS = ["TRAVEL_PREVIEW", "ROUTE_NOTIFICATION_OUTBOX_DRAIN", "MOBILE_SYNC_V2_PULL", "UNKNOWN"] as const
const ROUTE_OUTCOMES = ["SUCCESS", "STALE_AFTER_CALCULATION", "PROTECTION_UNAVAILABLE", "IN_FLIGHT", "IDEMPOTENCY_REPLAY", "IDEMPOTENCY_MISMATCH", "DAILY_LIMIT_REACHED", "PROVIDER_UNAVAILABLE", "DELIVERED", "SUPPRESSED", "DEFERRED", "FAILED", "EMPTY", "CURSOR_INVALID", "RESNAPSHOT_REQUIRED", "STREAM_UNAVAILABLE", "DEVICE_REVOKED", "AGENT_SCOPE_REQUIRED", "COHORT_DISABLED", "UNKNOWN"] as const

/** Child bindings must not bypass the event projection. Raw organization,
 * principal/request identifiers and free text have no generic log contract.
 */
export function privateLogBindings(value: unknown): Record<string, string> {
  const area = oneOf(own(value, "module"), ["erp-provider", "social-discovery-review-finalize", "route-field", "support", "unknown"], "unknown")
  return area === "unknown" ? {} : { module: area }
}

/** These two existing observation contracts are the only structured events
 * currently produced by shared Pino consumers. Preserve their safe fields and
 * unsampled counts; never spread the input into the serialization destination.
 */
export function privateLogEvent(value: unknown): Record<string, unknown> {
  const event = own(value, "event")
  if (event === "support_ux_observation_unavailable") {
    return { event, schema_version: 1, reason: oneOf(own(value, "reason"), SUPPORT_REASONS, "INVALID_CONTEXT") }
  }
  if (event === "support_ux_observation") {
    const observedAt = own(value, "observed_at_utc")
    const artifact = hex(own(value, "artifact_sha"), 40)
    const tenant = hex(own(value, "tenant_key"), 64)
    const operation = oneOf(own(value, "operation"), [...SUPPORT_OPERATIONS, "unknown"], "unknown")
    const mode = oneOf(own(value, "mode"), ["database", "browser", "unverified", "unknown"], "unknown")
    const outcome = oneOf(own(value, "outcome"), ["success", "client_rejection", "server_error", "thrown", "unknown"], "unknown")
    const status = own(value, "http_status")
    const validStatus = status === null ? outcome === "thrown" : typeof status === "number" && Number.isInteger(status) && ((status >= 200 && status < 300) || (status >= 400 && status < 600))
    const duration = boundedNumber(own(value, "duration_ms"), 600_000)
    if (own(value, "schema_version") !== 1 || !artifact || !tenant || operation === "unknown" || mode === "unknown" || outcome === "unknown" || !validStatus || duration === undefined
      || typeof observedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) {
      return { event: "support_ux_observation_unavailable", schema_version: 1, reason: "INVALID_CONTEXT" }
    }
    return { event, schema_version: 1, observed_at_utc: observedAt, artifact_sha: artifact, tenant_key: tenant, operation, mode, http_status: status, outcome, duration_ms: duration }
  }
  if (event === "mtm_route_observability") {
    const result: Record<string, unknown> = { event, module: "route-field", operation: oneOf(own(value, "operation"), ROUTE_OPERATIONS, "UNKNOWN"), outcome: oneOf(own(value, "outcome"), ROUTE_OUTCOMES, "UNKNOWN") }
    for (const key of ["duration_ms", "row_count"]) {
      const number = boundedNumber(own(value, key), 86_400_000)
      if (number !== undefined) result[key] = Math.floor(number)
    }
    const dimensions = {
      provider: ["google-routes"], stream: ["routes", "routePoints", "visits", "media"],
      payload_size_bucket: ["0", "1_4kb", "4_16kb", "16_64kb", "64kb_plus"],
      queue_age_bucket: ["none", "under_1m", "1_5m", "5_15m", "15_60m", "over_60m"],
    }
    for (const [key, choices] of Object.entries(dimensions)) {
      const dimension = oneOf(own(value, key), [...choices, "unknown"], "unknown")
      if (dimension !== "unknown") result[key] = dimension
    }
    const outbox = own(value, "outbox")
    const counts: Record<string, number> = {}
    for (const key of ["claimed", "delivered", "suppressed", "deferred", "failed"]) {
      const count = boundedNumber(own(outbox, key), 86_400_000)
      if (count !== undefined) counts[key] = Math.floor(count)
    }
    if (Object.keys(counts).length === 5) result.outbox = counts
    return result
  }
  return { event: "application_log" }
}

export function privateLogMessage(event: Record<string, unknown>): string {
  if (event.event === "mtm_route_observability") return "mtm route observability"
  if (event.event === "support_ux_observation" || event.event === "support_ux_observation_unavailable") return "support ux observation"
  return "application log"
}
