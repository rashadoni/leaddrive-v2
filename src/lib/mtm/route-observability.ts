import logger from "@/lib/logger"

const OPERATIONS = [
  "TRAVEL_PREVIEW",
  "ROUTE_NOTIFICATION_OUTBOX_DRAIN",
  "MOBILE_SYNC_V2_PULL",
  "UNKNOWN",
] as const

const OUTCOMES = [
  "SUCCESS",
  "STALE_AFTER_CALCULATION",
  "PROTECTION_UNAVAILABLE",
  "IN_FLIGHT",
  "IDEMPOTENCY_REPLAY",
  "IDEMPOTENCY_MISMATCH",
  "DAILY_LIMIT_REACHED",
  "PROVIDER_UNAVAILABLE",
  "DELIVERED",
  "SUPPRESSED",
  "DEFERRED",
  "FAILED",
  "EMPTY",
  "CURSOR_INVALID",
  "RESNAPSHOT_REQUIRED",
  "STREAM_UNAVAILABLE",
  "DEVICE_REVOKED",
  "AGENT_SCOPE_REQUIRED",
  "COHORT_DISABLED",
  "UNKNOWN",
] as const

const STREAMS = ["routes", "routePoints", "visits", "media"] as const
const PROVIDERS = ["google-routes"] as const

export type MtmRouteObservabilityOperation = typeof OPERATIONS[number]
export type MtmRouteObservabilityOutcome = typeof OUTCOMES[number]
export type MtmRouteObservabilityStream = typeof STREAMS[number]
export type MtmRouteObservabilityProvider = typeof PROVIDERS[number]

export type MtmRouteOutboxResultCounts = {
  claimed: number
  delivered: number
  suppressed: number
  deferred: number
  failed: number
}

/**
 * This is deliberately a fixed, PII-safe event shape rather than a generic
 * logging wrapper. Callers cannot accidentally serialize a tenant, user,
 * route, device, cursor, coordinate, request body, credential, or raw error.
 */
export type MtmRouteObservabilityInput = {
  operation: MtmRouteObservabilityOperation
  outcome: MtmRouteObservabilityOutcome
  provider?: MtmRouteObservabilityProvider
  stream?: MtmRouteObservabilityStream
  durationMs?: number
  rowCount?: number
  payloadBytes?: number
  queueAgeMs?: number | null
  outbox?: MtmRouteOutboxResultCounts
}

export type MtmRouteObservabilityEvent = {
  event: "mtm_route_observability"
  module: "route-field"
  operation: MtmRouteObservabilityOperation
  outcome: MtmRouteObservabilityOutcome
  provider?: MtmRouteObservabilityProvider
  stream?: MtmRouteObservabilityStream
  duration_ms?: number
  row_count?: number
  payload_size_bucket?: "0" | "1_4kb" | "4_16kb" | "16_64kb" | "64kb_plus"
  queue_age_bucket?: "none" | "under_1m" | "1_5m" | "5_15m" | "15_60m" | "over_60m"
  outbox?: MtmRouteOutboxResultCounts
}

export type MtmRouteObservabilitySink = {
  info: (event: MtmRouteObservabilityEvent, message: string) => unknown
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined
  return Math.min(86_400_000, Math.floor(value))
}

function allowedValue<Value extends string>(values: readonly Value[], value: unknown): Value | undefined {
  return typeof value === "string" && values.includes(value as Value) ? value as Value : undefined
}

function safeOutboxCounts(value: MtmRouteOutboxResultCounts | undefined): MtmRouteOutboxResultCounts | undefined {
  if (!value) return undefined
  const claimed = nonNegativeInteger(value.claimed)
  const delivered = nonNegativeInteger(value.delivered)
  const suppressed = nonNegativeInteger(value.suppressed)
  const deferred = nonNegativeInteger(value.deferred)
  const failed = nonNegativeInteger(value.failed)
  if (
    claimed === undefined
    || delivered === undefined
    || suppressed === undefined
    || deferred === undefined
    || failed === undefined
  ) return undefined
  return { claimed, delivered, suppressed, deferred, failed }
}

export function mtmRoutePayloadSizeBucket(value: unknown): MtmRouteObservabilityEvent["payload_size_bucket"] | undefined {
  const bytes = nonNegativeInteger(value)
  if (bytes === undefined) return undefined
  if (bytes === 0) return "0"
  if (bytes <= 4 * 1024) return "1_4kb"
  if (bytes <= 16 * 1024) return "4_16kb"
  if (bytes <= 64 * 1024) return "16_64kb"
  return "64kb_plus"
}

export function mtmRouteQueueAgeBucket(value: unknown): MtmRouteObservabilityEvent["queue_age_bucket"] | undefined {
  if (value === null) return "none"
  const milliseconds = nonNegativeInteger(value)
  if (milliseconds === undefined) return undefined
  if (milliseconds < 60_000) return "under_1m"
  if (milliseconds < 5 * 60_000) return "1_5m"
  if (milliseconds < 15 * 60_000) return "5_15m"
  if (milliseconds < 60 * 60_000) return "15_60m"
  return "over_60m"
}

/** Build the allowlisted event before it crosses the structured-log boundary. */
export function buildMtmRouteObservabilityEvent(input: MtmRouteObservabilityInput): MtmRouteObservabilityEvent {
  const operation = allowedValue(OPERATIONS, input.operation) ?? "UNKNOWN"
  const outcome = allowedValue(OUTCOMES, input.outcome) ?? "UNKNOWN"
  const provider = allowedValue(PROVIDERS, input.provider)
  const stream = allowedValue(STREAMS, input.stream)
  const durationMs = nonNegativeInteger(input.durationMs)
  const rowCount = nonNegativeInteger(input.rowCount)
  const payloadSizeBucket = mtmRoutePayloadSizeBucket(input.payloadBytes)
  const queueAgeBucket = mtmRouteQueueAgeBucket(input.queueAgeMs)
  const outbox = safeOutboxCounts(input.outbox)

  return {
    event: "mtm_route_observability",
    module: "route-field",
    operation,
    outcome,
    ...(provider ? { provider } : {}),
    ...(stream ? { stream } : {}),
    ...(durationMs === undefined ? {} : { duration_ms: durationMs }),
    ...(rowCount === undefined ? {} : { row_count: rowCount }),
    ...(payloadSizeBucket ? { payload_size_bucket: payloadSizeBucket } : {}),
    ...(queueAgeBucket ? { queue_age_bucket: queueAgeBucket } : {}),
    ...(outbox ? { outbox } : {}),
  }
}

/**
 * Observability must never turn a completed route mutation, provider fallback,
 * or outbox delivery into a user-visible failure. Pino is the existing sink;
 * a later exporter/alert policy can consume only this stable allowlist.
 */
export function logMtmRouteObservability(
  input: MtmRouteObservabilityInput,
  sink: MtmRouteObservabilitySink = logger,
): MtmRouteObservabilityEvent {
  const event = buildMtmRouteObservabilityEvent(input)
  try {
    sink.info(event, "mtm route observability")
  } catch {
    // Logging is intentionally best effort and must not affect the business path.
  }
  return event
}
