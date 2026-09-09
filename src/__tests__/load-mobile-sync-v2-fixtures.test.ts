import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertMobileSyncV2FixturePool,
  mobileSyncV2BootstrapMatchesFixture,
} from "../../tests/load/config.js"

function fixture(index: number, accessToken = `staging-token-${index}`) {
  return {
    tenantId: `tenant-${index % 2}`,
    agentId: `agent-${index}`,
    deviceId: `device-${index}`,
    accessToken,
    apkVersion: "2.4.0+101",
  }
}

describe("S6 mobile sync v2 staging fixture pool", () => {
  it("accepts a pool with distinct tenant, agent, device and JWT identities", () => {
    expect(() => assertMobileSyncV2FixturePool([
      fixture(1),
      fixture(2),
      fixture(3),
      fixture(4),
    ], { requiredUsers: 4, requiredTenants: 2 })).not.toThrow()
  })

  it("rejects a reused JWT before it can falsify a per-user fairness run", () => {
    expect(() => assertMobileSyncV2FixturePool([
      fixture(1, "same-staging-token"),
      fixture(2, "same-staging-token"),
    ], { requiredUsers: 2, requiredTenants: 2 }))
      .toThrow("mobile sync v2 fixture access tokens must be distinct")
  })

  it("accepts a fixture only when bootstrap proves its tenant and exact routes cohort", () => {
    const approvedFixture = fixture(1)
    expect(mobileSyncV2BootstrapMatchesFixture({
      success: true,
      data: {
        tenant: { id: approvedFixture.tenantId },
        manifest: { syncV2: { routes: true } },
      },
    }, approvedFixture)).toBe(true)

    expect(mobileSyncV2BootstrapMatchesFixture({
      success: true,
      data: {
        tenant: { id: "different-tenant" },
        manifest: { syncV2: { routes: true } },
      },
    }, approvedFixture)).toBe(false)
    expect(mobileSyncV2BootstrapMatchesFixture({
      success: true,
      data: {
        tenant: { id: approvedFixture.tenantId },
        manifest: { syncV2: { routes: false } },
      },
    }, approvedFixture)).toBe(false)
  })

  it("makes the k6 storm bootstrap the same fixture before a routes pull", () => {
    const scenario = readFileSync(join(process.cwd(), "tests/load/scenarios/mobile-sync-v2-routes.js"), "utf8")

    expect(scenario).toContain("/api/v1/mtm/mobile/bootstrap")
    expect(scenario).toContain("mobileSyncV2BootstrapMatchesFixture(body, fixture)")
    expect(scenario).toContain("if (!verifyFixtureBootstrap({ base: BASE_URL, headers, fixture })) return")
  })

  it("keeps the full S6 storm staging-only, fair, jittered and retry-safe", () => {
    const scenario = readFileSync(join(process.cwd(), "tests/load/scenarios/mobile-sync-v2-routes.js"), "utf8")

    expect(scenario).toContain('MOBILE_SYNC_V2_TARGET_USERS", 5_000, 1, 5_000')
    expect(scenario).toContain('MOBILE_SYNC_V2_TARGET_TENANTS", 100, 1, 100')
    expect(scenario).toContain('if (__ENV.LOAD_TEST_ENVIRONMENT !== "staging")')
    expect(scenario).toContain("S6 requires 100 tenants / 5000 users")
    expect(scenario).toContain('MOBILE_SYNC_V2_ALLOW_SMALL_POOL === "1"')
    expect(scenario).toContain('MOBILE_SYNC_V2_LOGIN_JITTER_SECONDS", 120, 0, 300')
    expect(scenario).toContain("sleep(Math.random() * LOGIN_JITTER_SECONDS)")
    expect(scenario).toContain('response.status !== 429 && response.status !== 503')
    expect(scenario).toContain("sleep(retryAfterSeconds(response) + Math.random())")
  })
})
