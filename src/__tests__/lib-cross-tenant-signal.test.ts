import { describe, it, expect } from "vitest"
import { CROSS_TENANT_CODE, readCrossTenantSignal } from "@/lib/cross-tenant-signal"

/**
 * The refusal a tab of the wrong organisation gets (lib/cross-tenant-signal).
 *
 * The body is what the proxy sends on production: 401, this code, and the two subdomain labels —
 * the session's and the host's. Everything else that can arrive with a 401 must stay silent, because
 * an ordinary "sign in again" is a different sentence and a different fix.
 */
describe("readCrossTenantSignal", () => {
  it("reads the proxy's refusal, with both organisations named", () => {
    const body = { error: "Unauthorized", code: CROSS_TENANT_CODE, sessionSlug: "leaddrive", hostSlug: "zeytun" }
    expect(readCrossTenantSignal(401, body)).toEqual({ sessionSlug: "leaddrive", hostSlug: "zeytun" })
  })

  it("stays silent on an ordinary 401", () => {
    expect(readCrossTenantSignal(401, { error: "Unauthorized" })).toBeNull()
    expect(readCrossTenantSignal(401, { error: "Unauthorized", code: "session_expired" })).toBeNull()
  })

  it("stays silent on anything that is not a 401", () => {
    const body = { code: CROSS_TENANT_CODE, sessionSlug: "leaddrive", hostSlug: "zeytun" }
    expect(readCrossTenantSignal(200, body)).toBeNull()
    expect(readCrossTenantSignal(403, body)).toBeNull()
  })

  it("survives a body that is not an object", () => {
    for (const body of [null, undefined, "Unauthorized", 401, [], [{ code: CROSS_TENANT_CODE }]]) {
      expect(readCrossTenantSignal(401, body)).toBeNull()
    }
  })

  it("drops a slug that is not a subdomain label instead of putting it on screen", () => {
    // The slugs are rendered into a sentence. Nothing but a real label ever reaches it, whatever a
    // response claims to be.
    const signal = readCrossTenantSignal(401, {
      code: CROSS_TENANT_CODE,
      sessionSlug: "<img src=x onerror=alert(1)>",
      hostSlug: "Zeytun Pharma",
    })
    expect(signal).toEqual({ sessionSlug: null, hostSlug: null })
  })

  it("keeps the signal when only one side is known", () => {
    expect(readCrossTenantSignal(401, { code: CROSS_TENANT_CODE, sessionSlug: null, hostSlug: "zeytun" }))
      .toEqual({ sessionSlug: null, hostSlug: "zeytun" })
  })
})
