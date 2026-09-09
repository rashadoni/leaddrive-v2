import { describe, expect, it } from "vitest"
import type { MonitoringScenario } from "@/lib/social/monitoring-scenarios"
import { buildTikTokTenantQueryPack, isTikTokDiscoveryDue, prepareTikTokSelectiveDiscovery, tiktokDiscoveryDispatchIdempotencyKey } from "@/lib/social/tiktok-selective-discovery"

function scenario(id: string, status: "active" | "paused" = "active", platform = "tiktok"): MonitoringScenario {
  return {
    id, subjectId: `subject-${id}`, subjectName: id, name: id, description: null, status,
    platforms: [platform as "tiktok"],
    search: { topics: [], keywords: [`Brand ${id}`], hashtags: [`tag${id}`], handles: [`@${id}`], urls: [], useHashtagFallback: false, includeOwnedComments: false, includeExternalComments: true },
    ai: { sentiments: [], minConfidence: 70, action: "show_only", directions: [] },
    reply: { identityId: null, identityLabel: null, mode: "draft_only", autoReplyEnabled: false, liveSendAllowed: false },
    archive: { startAt: null, lastBackfilledAt: null, scannedCount: 0, matchedCount: 0, status: "pending" },
    createdAt: "2026-07-18T00:00:00.000Z", updatedAt: "2026-07-18T00:00:00.000Z",
  }
}

describe("TikTok tenant query packs", () => {
  it("keeps two tenant payloads disjoint and includes tenant negatives", () => {
    const a = buildTikTokTenantQueryPack({ organizationId: "org-a", scenarios: [scenario("a")], subjects: [{ id: "subject-a", exclusions: ["fake"], aliases: [{ kind: "NAME", value: "Acme", normalizedValue: "acme", isNegative: false }, { kind: "NEGATIVE", value: "other acme", normalizedValue: "other acme", isNegative: true }] }] })!
    const b = buildTikTokTenantQueryPack({ organizationId: "org-b", scenarios: [scenario("b")] })!
    expect(a.organizationId).toBe("org-a")
    expect(a.queries.some(query => query.normalizedQuery === "brand a")).toBe(true)
    expect(a.queries.flatMap(query => query.negativeTerms)).toEqual(expect.arrayContaining(["fake", "other acme"]))
    expect(a.queries.map(query => `${query.kind}:${query.normalizedQuery}`).filter(key => b.queries.some(query => `${query.kind}:${query.normalizedQuery}` === key))).toEqual([])
    expect(a.version).not.toBe(b.version)
  })

  it("dispatches nothing for empty, paused or non-TikTok scenarios", () => {
    expect(buildTikTokTenantQueryPack({ organizationId: "org", scenarios: [] })).toBeNull()
    expect(buildTikTokTenantQueryPack({ organizationId: "org", scenarios: [scenario("x", "paused")] })).toBeNull()
    expect(buildTikTokTenantQueryPack({ organizationId: "org", scenarios: [scenario("x", "active", "instagram")] })).toBeNull()
  })

  it("produces a stable version and one retry key per UTC daily tick", () => {
    const pack = buildTikTokTenantQueryPack({ organizationId: "org", scenarios: [scenario("x")] })!
    const retry = buildTikTokTenantQueryPack({ organizationId: "org", scenarios: [scenario("x")] })!
    expect(retry.version).toBe(pack.version)
    expect(tiktokDiscoveryDispatchIdempotencyKey(pack, new Date("2026-07-18T01:00:00Z"))).toBe(tiktokDiscoveryDispatchIdempotencyKey(retry, new Date("2026-07-18T23:59:00Z")))
    expect(tiktokDiscoveryDispatchIdempotencyKey(pack, new Date("2026-07-19T00:00:00Z"))).not.toBe(tiktokDiscoveryDispatchIdempotencyKey(pack, new Date("2026-07-18T23:59:00Z")))
  })

  it("is due exactly every 1440 minutes", () => {
    const last = new Date("2026-07-18T12:00:00Z")
    expect(isTikTokDiscoveryDue({ lastSuccessfulAt: null, now: last })).toBe(true)
    expect(isTikTokDiscoveryDue({ lastSuccessfulAt: last, now: new Date("2026-07-19T11:59:59Z") })).toBe(false)
    expect(isTikTokDiscoveryDue({ lastSuccessfulAt: last, now: new Date("2026-07-19T12:00:00Z") })).toBe(true)
  })

  it("prepares no dispatch until due and never emits arbitrary-video input", () => {
    const scenarios = [scenario("x")]
    expect(prepareTikTokSelectiveDiscovery({ organizationId: "org", scenarios, lastSuccessfulAt: new Date("2026-07-18T12:00:00Z"), now: new Date("2026-07-19T11:59:00Z") })).toBeNull()
    const dispatch = prepareTikTokSelectiveDiscovery({ organizationId: "org", scenarios, lastSuccessfulAt: null, now: new Date("2026-07-19T12:00:00Z") })!
    expect(dispatch.queries.every(query => query.scenarioIds.length > 0)).toBe(true)
    expect(dispatch).not.toHaveProperty("videoUrls")
  })
})
