import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const explorer = readFileSync("src/components/mtm/organization-explorer.tsx", "utf8")
const settings = readFileSync("src/app/(dashboard)/mtm/settings/organization-attribute-package-settings.tsx", "utf8")
const route = readFileSync("src/app/api/v1/mtm/organizations/route.ts", "utf8")
const migration = readFileSync("prisma/migrations/20260809173000_mtm_organization_attribute_packages/migration.sql", "utf8")

describe("SWM-07/SWM-08 organization attribute contract", () => {
  it("renders signed category, license, and polygon filters without placeholders masquerading as facts", () => {
    expect(explorer).toContain('setFilter("medicalCategoryCode", value)')
    expect(explorer).toContain('setFilter("licenseStatus", value)')
    expect(explorer).toContain('setFilter("polygonCode", value)')
    expect(explorer).toContain('tx("explorer.notProvided")')
    expect(explorer).toContain('tx("explorer.optionalAttributesHint")')
    expect(explorer).toContain('attributes.package.sourceSystem')
  })

  it("binds explorer rows only to an active effective package", () => {
    expect(route).toContain('status: "ACTIVE" as const')
    expect(route).toContain('effectiveFrom: { lte: asOf }')
    expect(route).toContain('...(polygonCode ? { polygonCode } : {})')
    expect(route).toContain('package: activeAttributePackage')
  })

  it("requires exact-hash activation and shows source metadata to administrators", () => {
    expect(settings).toContain("expectedRowsHash: activation.rowsHash")
    expect(settings).toContain("sourceObservedAt")
    expect(settings).toContain("approvalReference.trim()")
    expect(settings).toContain('accept="application/json,.json"')
  })

  it("enforces tenant isolation, one active package, and coherent signatures in PostgreSQL", () => {
    expect(migration).toContain('CREATE UNIQUE INDEX "mtm_org_attribute_packages_one_active_key"')
    expect(migration).toContain('ALTER TABLE "mtm_organization_attribute_packages" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_organization_attribute_facts" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('"status" = \'ACTIVE\'')
    expect(migration).toContain('"rowsHash" ~ \'^[a-f0-9]{64}$\'')
  })
})
