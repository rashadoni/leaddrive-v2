import { describe, expect, it } from "vitest"
import { buildMtmMobileCapabilityManifest } from "@/lib/mtm/mobile-capability-manifest"
import { buildMtmMobileOfflineGrant, MOBILE_FIELD_OFFLINE_MAX_SECONDS } from "@/lib/mtm/mobile-offline-grant"

function grant(role = "AGENT", enabled = true, deviceId: string | null = "installation-1") {
  const now = new Date("2026-10-23T12:00:00.000Z")
  const manifest = buildMtmMobileCapabilityManifest({
    organization: { id: "tenant-1", plan: "enterprise", addons: [], features: [], modules: { "route-field": enabled } },
    auth: { agentId: "agent-1", role }, timezone: "Asia/Baku", now,
  })
  return buildMtmMobileOfflineGrant({ manifest, deviceId, now })
}

describe("installation-scoped local field offline grant", () => {
  it("binds an admitted agent to the tenant and installation for at most the approved seven days", () => {
    const value = grant()!
    expect(value).toMatchObject({ version: 1, kind: "LOCAL_FIELD_DRAFTS", tenantId: "tenant-1", principalId: "agent-1", deviceId: "installation-1" })
    expect(Date.parse(value.expiresAt) - Date.parse(value.issuedAt)).toBe(MOBILE_FIELD_OFFLINE_MAX_SECONDS * 1000)
    expect(MOBILE_FIELD_OFFLINE_MAX_SECONDS).toBe(7 * 24 * 60 * 60)
    expect(value).not.toHaveProperty("token")
  })
  it.each(["MANAGER", "SUPERVISOR", "ADMIN", "EMPLOYEE", "unknown"])("does not issue an agent offline grant to %s", role => {
    expect(grant(role)).toBeNull()
  })
  it("does not guess admission from an agent role when the module is disabled", () => {
    expect(grant("AGENT", false)).toBeNull()
  })
  it("does not issue a portable grant when the installation header is missing", () => {
    expect(grant("AGENT", true, null)).toBeNull()
  })
})
