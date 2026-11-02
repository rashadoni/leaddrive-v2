import type { MtmMobileCapabilityManifest } from "./mobile-capability-manifest"

/** Local cached field reads/drafts only. This is never a server API credential:
 * every queued mutation still passes current mobile auth, entitlement and RLS. */
export const MOBILE_FIELD_OFFLINE_MAX_SECONDS = 7 * 24 * 60 * 60

export function buildMtmMobileOfflineGrant(input: {
  manifest: MtmMobileCapabilityManifest
  deviceId: string | null
  now: Date
}) {
  const { manifest, deviceId, now } = input
  if (!deviceId || !manifest.tenant.id || !manifest.principal.id
    || manifest.principal.role !== "AGENT" || !manifest.modules.routeField.enabled
    || !manifest.streams.includes("visits")) return null
  return {
    version: 1 as const,
    kind: "LOCAL_FIELD_DRAFTS" as const,
    tenantId: manifest.tenant.id,
    principalId: manifest.principal.id,
    deviceId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MOBILE_FIELD_OFFLINE_MAX_SECONDS * 1000).toISOString(),
  }
}
