import { createHash } from "node:crypto"

export type MtmMobileLocationDigestInput = {
  workdayId: string | null
  latitude: number
  longitude: number
  accuracy: number | null
  speed: number | null
  heading: number | null
  altitude: number | null
  battery: number | null
  recordedAt: Date
}

/**
 * Canonical, privacy-safe input to location idempotency. The digest never
 * enters logs; it lets the v2 batch contract reject one clientLocationId
 * reused for different coordinates or a different workday binding.
 */
export function mtmMobileLocationPayloadSha256(input: MtmMobileLocationDigestInput): string {
  const canonical = JSON.stringify([
    input.workdayId,
    input.latitude,
    input.longitude,
    input.accuracy,
    input.speed,
    input.heading,
    input.altitude,
    input.battery,
    input.recordedAt.toISOString(),
  ])
  return createHash("sha256").update(canonical).digest("hex")
}
