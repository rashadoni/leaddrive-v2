import { hmacToken } from "@/lib/secure-token"

export type MtmMobileMediaResultClass = "ok" | "forbidden" | "invalid_request" | "conflict" | "rate_limited" | "unavailable" | "failed"
const RESULTS = new Set<string>(["ok", "forbidden", "invalid_request", "conflict", "rate_limited", "unavailable", "failed"])

function safeApkVersion(value: string | null): string {
  return typeof value === "string" && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:\+\d{1,10})?$/.test(value) ? value : "unknown"
}

function byteBucket(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "unknown"
  if (value < 64 * 1024) return "lt_64k"
  if (value < 1_024 * 1_024) return "64k_1m"
  if (value < 5 * 1_024 * 1_024) return "1m_5m"
  if (value < 10 * 1_024 * 1_024) return "5m_10m"
  return "gte_10m"
}

/**
 * Privacy-safe upload telemetry. It intentionally omits media IDs, file
 * names, storage keys, document metadata, exact byte counts and coordinates.
 * Logging is best-effort and cannot influence an upload result.
 */
export function recordMtmMobileMediaTelemetry(input: {
  organizationId: string
  endpoint: "photos" | "documents"
  contractVersion: 1 | 2
  apkVersion: string | null
  result: MtmMobileMediaResultClass
  durationMs: number
  bytes: number | null
}): void {
  try {
    console.info("[mtm-mobile-media-telemetry]", JSON.stringify({
      event: "mobile_media_upload",
      tenant: hmacToken(input.organizationId, "mtm-mobile-media-telemetry").slice(0, 16),
      endpoint: input.endpoint === "photos" || input.endpoint === "documents" ? input.endpoint : "unknown",
      contractVersion: input.contractVersion === 1 || input.contractVersion === 2 ? input.contractVersion : 0,
      apkVersion: safeApkVersion(input.apkVersion),
      result: RESULTS.has(input.result) ? input.result : "failed",
      byteBucket: byteBucket(input.bytes),
      durationMs: Number.isFinite(input.durationMs) ? Math.max(0, Math.min(300_000, Math.round(input.durationMs))) : 0,
    }))
  } catch {
    // Observability must never alter upload durability or a retry decision.
  }
}
