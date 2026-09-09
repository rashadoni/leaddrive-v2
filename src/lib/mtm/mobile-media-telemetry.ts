import { hmacToken } from "@/lib/secure-token"

export type MtmMobileMediaResultClass = "ok" | "forbidden" | "invalid_request" | "conflict" | "rate_limited" | "unavailable" | "failed"

function safeApkVersion(value: string | null): string {
  return value && /^[A-Za-z0-9._+-]{1,64}$/.test(value) ? value : "unknown"
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
      endpoint: input.endpoint,
      contractVersion: input.contractVersion,
      apkVersion: safeApkVersion(input.apkVersion),
      result: input.result,
      byteBucket: byteBucket(input.bytes),
      durationMs: Math.max(0, Math.round(input.durationMs)),
    }))
  } catch {
    // Observability must never alter upload durability or a retry decision.
  }
}
