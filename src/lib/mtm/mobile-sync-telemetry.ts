import { hmacToken } from "@/lib/secure-token"

export type MtmMobileSyncResultClass =
  | "ok"
  | "forbidden"
  | "cohort_disabled"
  | "invalid_request"
  | "invalid_cursor"
  | "resnapshot_required"
  | "payload_too_large"
  | "rate_limited"
  | "unavailable"

const MOBILE_SYNC_STREAMS = new Set([
  "routes",
  "routePoints",
  "visits",
  "customers",
  "contacts",
  "tasks",
  "notifications",
  "workforce",
])
const MOBILE_SYNC_RESULTS = new Set<MtmMobileSyncResultClass>([
  "ok",
  "forbidden",
  "cohort_disabled",
  "invalid_request",
  "invalid_cursor",
  "resnapshot_required",
  "payload_too_large",
  "rate_limited",
  "unavailable",
])

type MtmMobileApkObservationInput = {
  organizationId: string
  agentId: string
  apkVersion: string | null
  protocolPreferred: 1 | 2
  cohorts: { routes: boolean; visits: boolean; tasks: boolean; workforce: boolean; gps: boolean; media: boolean }
  diagnostics?: MtmMobileClientDiagnosticsInput
}

type MtmMobileV1SyncActivityInput = {
  organizationId: string
  agentId: string
  apkVersion: string | null
  endpoint: "GET /api/v1/mtm/mobile/sync/pull" | "POST /api/v1/mtm/mobile/sync/push"
  diagnostics?: MtmMobileClientDiagnosticsInput
}

type MtmMobileClientDiagnosticsInput = {
  /** Immutable artifact claim only; never a source path, branch or token. */
  buildSha: string | null
  /** Current clients may only identify the platform, never a model/serial. */
  platform: string | null
  /** Coarse screen class, not Android ID, IMEI, manufacturer or model. */
  deviceClass: string | null
}

type PullTelemetryInput = {
  organizationId: string
  stream: string
  endpoint: string
  contractVersion: number
  apkVersion: string | null
  result: MtmMobileSyncResultClass
  durationMs: number
  response: unknown
}

function safeApkVersion(value: string | null): string {
  // This is only a compact, syntactically safe release claim. Accept the
  // canonical mobile shape major.minor.patch[+numericVersionCode], never a
  // generic header string. S7 still maps it through the approved
  // release-artifact ledger, and an unregistered value is treated as unknown.
  if (value && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/.test(value)) return value
  return "unknown"
}

function safePullDimensions(input: Pick<PullTelemetryInput,
  "stream" | "endpoint" | "contractVersion" | "result" | "durationMs">) {
  const stream = MOBILE_SYNC_STREAMS.has(input.stream) ? input.stream : "unknown"
  const expectedEndpoint = stream === "unknown" ? null : `GET /api/v2/mtm/mobile/sync/${stream}`
  return {
    stream,
    endpoint: input.endpoint === expectedEndpoint ? input.endpoint : "unknown",
    contractVersion: input.contractVersion === 1 || input.contractVersion === 2
      ? input.contractVersion
      : 0,
    result: MOBILE_SYNC_RESULTS.has(input.result) ? input.result : "unavailable",
    durationMs: Number.isFinite(input.durationMs)
      ? Math.min(300_000, Math.max(0, Math.round(input.durationMs)))
      : 0,
  }
}

function safeBuildSha(value: string | null): string {
  return value != null && /^[0-9a-f]{40}$/.test(value) ? value : "unknown"
}

function safePlatform(value: string | null): "android" | "unknown" {
  return value === "android" ? value : "unknown"
}

function safeDeviceClass(value: string | null): "phone" | "tablet" | "other" | "unknown" {
  return value === "phone" || value === "tablet" || value === "other" ? value : "unknown"
}

function safeClientDiagnostics(input: MtmMobileClientDiagnosticsInput | undefined) {
  return {
    buildSha: safeBuildSha(input?.buildSha ?? null),
    platform: safePlatform(input?.platform ?? null),
    deviceClass: safeDeviceClass(input?.deviceClass ?? null),
  }
}

function apkCensusIdentity(input: Pick<MtmMobileApkObservationInput, "organizationId" | "agentId">) {
  return {
    tenant: hmacToken(input.organizationId, "mtm-mobile-apk-census:tenant").slice(0, 16),
    principal: hmacToken(input.agentId, "mtm-mobile-apk-census:principal").slice(0, 16),
  }
}

function payloadShape(response: unknown) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return { rows: 0, bytes: 0 }
  }
  const body = response as { items?: unknown; tombstones?: unknown }
  const rows = (Array.isArray(body.items) ? body.items.length : 0)
    + (Array.isArray(body.tombstones) ? body.tombstones.length : 0)
  try {
    return { rows, bytes: Buffer.byteLength(JSON.stringify(response), "utf8") }
  } catch {
    return { rows, bytes: 0 }
  }
}

function successSampleRate(): number {
  const raw = Number(process.env.MOBILE_SYNC_TELEMETRY_SUCCESS_SAMPLE_RATE ?? "0.1")
  return Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.1
}

/**
 * Structured, privacy-safe pull telemetry for a log/metric pipeline.
 *
 * No raw tenant/device/cursor/payload is emitted. Successful high-volume
 * pulls are sampled; all non-success result classes are retained so partial
 * outages, rate limits and resnapshots remain observable.
 */
export function recordMtmMobileSyncPullTelemetry(input: PullTelemetryInput): void {
  try {
    const dimensions = safePullDimensions(input)
    const successRate = successSampleRate()
    if (dimensions.result === "ok" && Math.random() >= successRate) return
    const payload = payloadShape(input.response)
    console.info("[mtm-mobile-sync-telemetry]", JSON.stringify({
      event: "mobile_sync_pull",
      tenant: hmacToken(input.organizationId, "mtm-mobile-sync-telemetry").slice(0, 16),
      stream: dimensions.stream,
      endpoint: dimensions.endpoint,
      contractVersion: dimensions.contractVersion,
      apkVersion: safeApkVersion(input.apkVersion),
      result: dimensions.result,
      rowCount: payload.rows,
      payloadBytes: payload.bytes,
      durationMs: dimensions.durationMs,
      successSampleRate: dimensions.result === "ok" ? successRate : 1,
    }))
  } catch {
    // Observability must never change a sync result or retry decision.
  }
}

/**
 * Records one authenticated bootstrap observation for the supported-APK
 * census. This is deliberately log/metric-only: an observation never blocks a
 * v1 APK, changes a cohort, or becomes a second source of client state.
 *
 * The principal fingerprint lets the metric pipeline deduplicate an active
 * field identity over the compatibility window without receiving a tenant,
 * agent, device ID or any mobile payload.
 */
export function recordMtmMobileApkObservation(input: MtmMobileApkObservationInput): void {
  try {
    const identity = apkCensusIdentity(input)
    console.info("[mtm-mobile-apk-telemetry]", JSON.stringify({
      event: "mobile_apk_observed",
      ...identity,
      endpoint: "GET /api/v1/mtm/mobile/bootstrap",
      apkVersion: safeApkVersion(input.apkVersion),
      protocolPreferred: input.protocolPreferred,
      ...(input.diagnostics ? { diagnostics: safeClientDiagnostics(input.diagnostics) } : {}),
      cohorts: {
        routes: input.cohorts.routes,
        visits: input.cohorts.visits,
        tasks: input.cohorts.tasks,
        workforce: input.cohorts.workforce,
        gps: input.cohorts.gps,
        media: input.cohorts.media,
      },
    }))
  } catch {
    // The census is evidence for a later retirement review, never a bootstrap
    // dependency. Preserve old-APK compatibility when observability is down.
  }
}

/**
 * Unsampled, authenticated v1 activity evidence for the S7 fleet census.
 *
 * This event deliberately says only that an authenticated Field principal
 * reached a legacy sync endpoint. It never includes a cursor, device ID,
 * operation ID, result body or operation count. Header versions remain claims,
 * not authority; the operations query must map them through an approved
 * release-artifact ledger and treat missing/invalid/unregistered values as
 * `unknown`.
 */
export function recordMtmMobileV1SyncActivity(input: MtmMobileV1SyncActivityInput): void {
  try {
    const identity = apkCensusIdentity(input)
    console.info("[mtm-mobile-apk-telemetry]", JSON.stringify({
      event: "mobile_sync_v1_activity",
      ...identity,
      endpoint: input.endpoint,
      apkVersion: safeApkVersion(input.apkVersion),
      protocolVersion: 1,
      ...(input.diagnostics ? { diagnostics: safeClientDiagnostics(input.diagnostics) } : {}),
    }))
  } catch {
    // Census evidence must never affect a v1 response, its idempotency record
    // or an accepted mobile outbox operation.
  }
}
