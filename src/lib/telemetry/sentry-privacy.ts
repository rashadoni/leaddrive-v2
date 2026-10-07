import type { Envelope, Event, Integration } from "@sentry/core"
import { boundedNumber, hex, oneOf, own } from "./safe-fields"

const LEVELS = ["fatal", "error", "warning", "log", "info", "debug"] as const
const ERROR_TYPES = ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"] as const
const OPS = ["http.server", "http.client", "db", "db.sql.query", "navigation", "pageload", "ui.action", "unknown"] as const
const STATUSES = ["ok", "unknown_error", "internal_error", "cancelled", "deadline_exceeded", "unavailable", "unauthenticated", "permission_denied", "not_found", "invalid_argument", "resource_exhausted"] as const

function items(value: unknown, maximum: number): unknown[] {
  try {
    if (!Array.isArray(value)) return []
    const length = boundedNumber(own(value, "length"), 1_000_000) ?? 0
    return Array.from({ length: Math.min(length, maximum) }, (_, index) => own(value, String(index)))
  } catch { return [] }
}

function codeArea(value: unknown): string {
  if (typeof value !== "string") return "application"
  if (["application", "workforce", "routes", "support", "database", "auth"].some(area => value === `application:${area}`)) return value.slice("application:".length)
  if (value.includes("/workforce/")) return "workforce"
  if (value.includes("/mtm/")) return "routes"
  if (value.includes("/tickets/") || value.includes("/ticket-macros/")) return "support"
  if (value.endsWith("/prisma.ts") || value.endsWith("/prisma.js")) return "database"
  if (value.endsWith("/auth.ts") || value.endsWith("/api-auth.ts") || value.endsWith("/with-rls.ts")) return "auth"
  return "application"
}

function frame(value: unknown) {
  const line = boundedNumber(own(value, "lineno"), 10_000_000)
  const column = boundedNumber(own(value, "colno"), 10_000_000)
  const inApp = own(value, "in_app")
  return {
    filename: `application:${codeArea(own(value, "filename"))}`,
    ...(line === undefined ? {} : { lineno: Math.floor(line) }),
    ...(column === undefined ? {} : { colno: Math.floor(column) }),
    ...(typeof inApp === "boolean" ? { in_app: inApp } : {}),
  }
}

/** Fixed-shape projection, not key-name redaction. Request bodies/URLs/headers,
 * user identity, free text, stack source snippets, breadcrumbs, custom tags,
 * error causes and arbitrary span attributes never reach the destination.
 * SDK correlation IDs remain pseudonymous; this does not claim anonymity.
 */
export function minimizeSentryEvent<T extends Event>(event: T): T {
  const transaction = own(event, "type") === "transaction"
  const safe: Event = {
    sdk: { settings: { infer_ip: "never" } },
    level: oneOf(own(event, "level"), LEVELS, "error"),
    ...(transaction ? { type: "transaction", transaction: "application.transaction", transaction_info: { source: "custom" } } : { message: "Application error" }),
  }
  const id = hex(own(event, "event_id"), 32)
  if (id) safe.event_id = id
  for (const key of ["timestamp", "start_timestamp"] as const) {
    const number = boundedNumber(own(event, key), 1_000_000_000_000)
    if (number !== undefined) safe[key] = number
  }
  const environment = oneOf(own(event, "environment"), ["production", "development", "test", "unknown"], "unknown")
  safe.environment = environment
  const release = hex(own(event, "release"), 40)
  if (release) safe.release = release
  const trace = own(own(event, "contexts"), "trace")
  const traceId = hex(own(trace, "trace_id"), 32)
  const spanId = hex(own(trace, "span_id"), 16)
  if (traceId && spanId) safe.contexts = { trace: { trace_id: traceId, span_id: spanId, op: oneOf(own(trace, "op"), OPS, "unknown"), status: oneOf(own(trace, "status"), STATUSES, "unknown_error") } }
  const values = items(own(own(event, "exception"), "values"), 5)
  if (values.length) safe.exception = { values: values.map(value => ({
    type: oneOf(own(value, "type"), ERROR_TYPES, "Error"), value: "[redacted]",
    stacktrace: { frames: items(own(own(value, "stacktrace"), "frames"), 50).map(frame) },
  })) }
  if (transaction) safe.spans = items(own(event, "spans"), 1000).flatMap(value => {
    const childTrace = hex(own(value, "trace_id"), 32)
    const childSpan = hex(own(value, "span_id"), 16)
    const start = boundedNumber(own(value, "start_timestamp"), 1_000_000_000_000)
    const end = boundedNumber(own(value, "timestamp"), 1_000_000_000_000)
    if (!childTrace || !childSpan || start === undefined || end === undefined || end < start) return []
    return [{ data: {}, trace_id: childTrace, span_id: childSpan, start_timestamp: start, timestamp: end, op: oneOf(own(value, "op"), OPS, "unknown"), status: oneOf(own(value, "status"), STATUSES, "unknown_error") }]
  })
  return safe as T
}

/** Last SDK boundary before its existing transport. Event hooks do not cover
 * attachments, Replay, sessions, logs or profiles. Keep only minimized event /
 * transaction items and discard dynamic sampling context and item metadata.
 * No destination, authentication, transport or sampling rate is added.
 */
export function minimizeSentryEnvelope(envelope: Envelope): void {
  const mutable = envelope as unknown as [Record<string, unknown>, Array<[Record<string, unknown>, unknown]>]
  const id = hex(own(mutable[0], "event_id"), 32)
  mutable[0] = id ? { event_id: id } : {}
  mutable[1] = items(mutable[1], 1000).flatMap(item => {
    const type = own(own(item, "0"), "type")
    const event = own(item, "1")
    if ((type !== "event" && type !== "transaction") || !event || typeof event !== "object") return []
    const safe = minimizeSentryEvent(event as Event)
    if (type === "transaction") { safe.type = "transaction"; safe.transaction = "application.transaction" }
    return [[{ type }, safe]] as Array<[Record<string, unknown>, unknown]>
  })
}

/** beforeSetup runs before any default integration setupOnce/setup. A hidden
 * browser document can otherwise send its initial session inside init(). */
export function privateSentryIntegrations(defaults: Integration[]): Integration[] {
  return [{
    name: "ApplicationPrivacyBoundary",
    beforeSetup(client) { client.on("beforeEnvelope", minimizeSentryEnvelope) },
  }, ...defaults.filter(integration => integration.name !== "BrowserSession")]
}

export const privateSentryOptions = {
  integrations: privateSentryIntegrations,
  sendDefaultPii: false,
  enableLogs: false,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    queryParams: false,
    genAI: { inputs: false, outputs: false },
    stackFrameVariables: false,
    frameContextLines: 0,
  },
  beforeSend: minimizeSentryEvent,
  beforeSendTransaction: minimizeSentryEvent,
  beforeBreadcrumb: () => null,
  beforeSendLog: () => null,
}
