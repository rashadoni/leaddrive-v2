import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

describe("social monitoring reset budget provenance", () => {
  it("excludes internal reset boundaries from tenant exports", () => {
    const tenantExport = source("../lib/tenant-export.ts")

    expect(tenantExport).toContain('entityType: "social_paid_run_authorization"')
    expect(tenantExport).toContain('action: "reset_boundary"')
    expect(tenantExport).toContain("NOT:")
  })

  it("requires system provenance in both paid-budget latest-boundary selectors", () => {
    const providerScope = source("../lib/social/paid-provider-run-scope.ts")
    const authorization = source("../lib/social/paid-run-authorization.ts")

    expect(providerScope.match(/"userId" IS NULL/g)).toHaveLength(3)
    expect(providerScope.match(/"entityName" = /g)).toHaveLength(3)
    expect(providerScope.match(/"entityId" LIKE /g)).toHaveLength(3)
    expect(authorization).toContain("userId: null")
    expect(authorization).toContain("entityName: RESET_BOUNDARY_ENTITY_NAME")
    expect(authorization).toContain(
      "entityId: { startsWith: RESET_BOUNDARY_ENTITY_ID_PREFIX }",
    )
  })
})
