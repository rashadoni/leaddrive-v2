export const GPS_FRESHNESS = {
  onlineSeconds: 5 * 60,
  delayedSeconds: 15 * 60,
} as const

export type GpsFreshness = "ONLINE" | "DELAYED" | "STALE" | "NO_LOCATION"
export type LiveWorkdayState = "ACTIVE" | "PAUSED" | "CLOSED" | "NOT_STARTED"
export type LocationState = "AVAILABLE" | "NO_LOCATION_REPORTED" | "PERMISSION_NOT_GRANTED"

export function classifyGpsFreshness(
  recordedAt: Date | string | null | undefined,
  now: Date = new Date(),
  thresholds: { onlineSeconds: number; delayedSeconds: number } = GPS_FRESHNESS,
): GpsFreshness {
  if (!recordedAt) return "NO_LOCATION"
  const ageSeconds = Math.max(0, (now.getTime() - new Date(recordedAt).getTime()) / 1000)
  if (ageSeconds <= thresholds.onlineSeconds) return "ONLINE"
  if (ageSeconds <= thresholds.delayedSeconds) return "DELAYED"
  return "STALE"
}

export function mapWorkdayState(status: string | null | undefined): LiveWorkdayState {
  if (status === "STARTED") return "ACTIVE"
  if (status === "PAUSED") return "PAUSED"
  if (status === "COMPLETED") return "CLOSED"
  return "NOT_STARTED"
}

export function explainMissingLocation(input: {
  hasLocation: boolean
  lastSeenAt: Date | string | null | undefined
  permissionState?: "GRANTED" | "DENIED" | "UNKNOWN" | null
}): LocationState {
  if (input.hasLocation) return "AVAILABLE"
  // `lastSeenAt` is presence telemetry, not OS permission telemetry. Only an
  // explicit, trusted denial may be described as permission not granted.
  if (input.permissionState === "DENIED") return "PERMISSION_NOT_GRANTED"
  return "NO_LOCATION_REPORTED"
}
