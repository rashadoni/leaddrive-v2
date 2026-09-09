import { hmacToken } from "@/lib/secure-token"

export type MtmMobileGpsResult = "ok" | "invalid_request" | "forbidden" | "conflict" | "rate_limited" | "unavailable" | "failed"

function safeApkVersion(value: string | null): string {
  return value && /^[A-Za-z0-9._+-]{1,64}$/.test(value) ? value : "unknown"
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
      endpoint: input.endpoint,
      apkVersion: safeApkVersion(input.apkVersion),
      result: input.result,
      pointCount: Math.max(0, Math.min(50, Math.floor(input.pointCount))),
      durationMs: Math.max(0, Math.round(input.durationMs)),
    }))
  } catch {
    // Observability cannot alter GPS durability or a retry decision.
  }
}
