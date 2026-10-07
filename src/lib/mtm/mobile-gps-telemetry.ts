import { hmacToken } from "@/lib/secure-token"

export type MtmMobileGpsResult = "ok" | "invalid_request" | "forbidden" | "conflict" | "rate_limited" | "unavailable" | "failed"
const RESULTS = new Set<string>(["ok", "invalid_request", "forbidden", "conflict", "rate_limited", "unavailable", "failed"])

function safeApkVersion(value: string | null): string {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/.test(value) ? value : "unknown"
}

/** GPS telemetry deliberately contains only aggregates, never coordinates or IDs. */
export function recordMtmMobileGpsTelemetry(input: {
  organizationId: string
  endpoint: "location_batch"
  apkVersion: string | null
  result: MtmMobileGpsResult
  pointCount: number
  durationMs: number
}): void {
  try {
    console.info("[mtm-mobile-gps-telemetry]", JSON.stringify({
      event: "mobile_gps_ingest",
      tenant: hmacToken(input.organizationId, "mtm-mobile-gps-telemetry").slice(0, 16),
      endpoint: input.endpoint === "location_batch" ? input.endpoint : "unknown",
      apkVersion: safeApkVersion(input.apkVersion),
      result: RESULTS.has(input.result) ? input.result : "failed",
      pointCount: Number.isFinite(input.pointCount) ? Math.max(0, Math.min(50, Math.floor(input.pointCount))) : 0,
      durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.min(300_000, Math.round(input.durationMs))) : 0,
    }))
  } catch {
    // Observability cannot alter GPS durability or a retry decision.
  }
}
