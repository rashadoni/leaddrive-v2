/**
 * Platform Events types — N14 Phase 5 slice 1.
 *
 * Salesforce-style event-driven architecture. Tenant defines a named
 * event with a typed field schema; publishers post payloads validated
 * against that schema; subscribers receive them via the pub/sub bus.
 *
 * Slice 1 ships in-memory bus + durable event log. Slice 2 adds:
 *   - Redis Streams for cross-process fan-out
 *   - Prisma CDC middleware (auto-publish on record events)
 *   - WebSocket subscriber endpoint
 *   - DLQ + retry semantics
 */

/** Field types accepted in a PlatformEventDefinition.fields spec. */
export type FieldType = "string" | "number" | "boolean" | "timestamp" | "json"

export interface FieldSpec {
  name: string
  type: FieldType
  required: boolean
  /** Max char length for string fields. Ignored for other types. */
  maxLength?: number
}

/** Origin tag for audit + slice-2 routing. */
export type EventOrigin = "manual" | "cdc" | "apex" | "workflow"

/* ─── In-memory bus shapes ────────────────────────────────────────────── */

/**
 * One delivered event. `id` is the durable PlatformEventLog row id —
 * subscribers use it for resume-from-checkpoint + dedup.
 */
export interface BusEvent {
  id: string
  organizationId: string
  definitionId: string
  eventName: string
  payload: Record<string, unknown>
  origin: EventOrigin
  publishedBy: string | null
  publishedAt: Date
}

export type EventListener = (event: BusEvent) => void | Promise<void>

/**
 * Per-tenant subscription handle returned by `bus.subscribe`. Caller
 * MUST call `unsubscribe()` when done (route close, sandbox teardown)
 * otherwise the bus leaks listener references.
 */
export interface BusSubscription {
  unsubscribe(): void
}

export interface SubscribeOptions {
  organizationId: string
  /** Optional event-name filter. Omit to receive all events for the org. */
  eventName?: string
  listener: EventListener
}

export interface PublishSubscribeBus {
  /**
   * Deliver an event to all matching subscribers in the current
   * process. Slice 2 fans out to other processes via Redis.
   *
   * Implementations MUST NOT throw if a listener throws — they catch
   * and log so one misbehaving subscriber doesn't kill delivery for
   * the rest of the fan-out.
   */
  publish(event: BusEvent): void
  subscribe(opts: SubscribeOptions): BusSubscription
}

/* ─── Validation ──────────────────────────────────────────────────────── */

export interface ValidationOk {
  ok: true
  /** Normalised payload — booleans/numbers/timestamps coerced from strings. */
  payload: Record<string, unknown>
}

export interface ValidationFail {
  ok: false
  errors: string[]
}

export type ValidationResult = ValidationOk | ValidationFail

/** Hard cap on log-row payload size (bytes of JSON). */
export const MAX_PAYLOAD_BYTES = 64 * 1024 // 64 KB
