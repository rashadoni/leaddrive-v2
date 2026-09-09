/**
 * Provider / AudienceSync / Tracking state machines — C3 slice 1.
 *
 * Application-layer transition guards. DB CHECKs enforce enum
 * membership; helper enforces transition allow-list.
 *
 * Pure synchronous.
 */
import {
  AUDIENCE_SYNC_STATUSES,
  AUDIENCE_SYNC_TRANSITIONS,
  PROVIDER_STATUSES,
  PROVIDER_TRANSITIONS,
  TRACKING_STATUSES,
  TRACKING_TRANSITIONS,
  type AudienceSyncStatus,
  type ProviderStatus,
  type TrackingStatus,
  type TransitionResult,
} from "./types"

export function isProviderStatus(s: unknown): s is ProviderStatus {
  return typeof s === "string" && (PROVIDER_STATUSES as readonly string[]).includes(s)
}

export function isAudienceSyncStatus(s: unknown): s is AudienceSyncStatus {
  return (
    typeof s === "string" && (AUDIENCE_SYNC_STATUSES as readonly string[]).includes(s)
  )
}

export function isTrackingStatus(s: unknown): s is TrackingStatus {
  return typeof s === "string" && (TRACKING_STATUSES as readonly string[]).includes(s)
}

function check<T extends string>(
  from: T,
  to: T,
  table: Readonly<Record<T, readonly T[]>>,
  kind: string
): TransitionResult {
  if (from === to) {
    return { ok: false, error: `${kind}: cannot transition from "${from}" to itself` }
  }
  const allowed = table[from]
  if (!allowed) {
    return { ok: false, error: `${kind}: unknown from-status "${String(from)}"` }
  }
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error:
        allowed.length === 0
          ? `${kind}: "${from}" is a terminal status — no transitions allowed`
          : `${kind}: transition "${from}" → "${to}" is not allowed (allowed: ${allowed.join(", ")})`,
    }
  }
  return { ok: true }
}

export function canProviderTransition(
  from: ProviderStatus,
  to: ProviderStatus
): TransitionResult {
  if (!isProviderStatus(from)) {
    return { ok: false, error: `provider: from "${String(from)}" is not a known status` }
  }
  if (!isProviderStatus(to)) {
    return { ok: false, error: `provider: to "${String(to)}" is not a known status` }
  }
  return check(from, to, PROVIDER_TRANSITIONS, "provider")
}

export function canAudienceSyncTransition(
  from: AudienceSyncStatus,
  to: AudienceSyncStatus
): TransitionResult {
  if (!isAudienceSyncStatus(from)) {
    return { ok: false, error: `audience_sync: from "${String(from)}" is not a known status` }
  }
  if (!isAudienceSyncStatus(to)) {
    return { ok: false, error: `audience_sync: to "${String(to)}" is not a known status` }
  }
  return check(from, to, AUDIENCE_SYNC_TRANSITIONS, "audience_sync")
}

export function canTrackingTransition(
  from: TrackingStatus,
  to: TrackingStatus
): TransitionResult {
  if (!isTrackingStatus(from)) {
    return { ok: false, error: `tracking: from "${String(from)}" is not a known status` }
  }
  if (!isTrackingStatus(to)) {
    return { ok: false, error: `tracking: to "${String(to)}" is not a known status` }
  }
  return check(from, to, TRACKING_TRANSITIONS, "tracking")
}

export function providerAllowedNext(s: ProviderStatus): readonly ProviderStatus[] {
  return PROVIDER_TRANSITIONS[s] ?? []
}
export function audienceSyncAllowedNext(s: AudienceSyncStatus): readonly AudienceSyncStatus[] {
  return AUDIENCE_SYNC_TRANSITIONS[s] ?? []
}
export function trackingAllowedNext(s: TrackingStatus): readonly TrackingStatus[] {
  return TRACKING_TRANSITIONS[s] ?? []
}

export function isProviderTerminal(s: ProviderStatus): boolean {
  return PROVIDER_TRANSITIONS[s].length === 0
}
export function isAudienceSyncTerminal(s: AudienceSyncStatus): boolean {
  return AUDIENCE_SYNC_TRANSITIONS[s].length === 0
}
export function isTrackingTerminal(s: TrackingStatus): boolean {
  return TRACKING_TRANSITIONS[s].length === 0
}
