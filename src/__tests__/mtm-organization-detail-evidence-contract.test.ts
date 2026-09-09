import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const component = readFileSync("src/components/mtm/organization-detail.tsx", "utf8")
const route = readFileSync("src/app/api/v1/mtm/organizations/[id]/route.ts", "utf8")
const migration = readFileSync("prisma/migrations/20260809200000_mtm_organization_detail_evidence/migration.sql", "utf8")

describe("SWM-06 organization detail evidence contract", () => {
  it("loads all seven reference sections without unavailable-domain placeholders", () => {
    expect(route).toContain('"departments", "staff", "promotions", "files"')
    expect(route).toContain("pharmacyPromotionTargets")
    expect(route).toContain("sourceImportJob")
    expect(component).toContain('value="departments"')
    expect(component).toContain('value="promotions"')
    expect(component).toContain('value="files"')
    expect(component).not.toContain("const unavailableSections")
  })

  it("keeps source attribution visible for departments, files, coordinates, and commercial totals", () => {
    expect(component).toContain('t("detail.sourceLine"')
    expect(component).toContain("coordinateVerification")
    expect(component).toContain("commercial.latestSource")
    expect(component).toContain("documentSource")
  })

  it("enforces composite tenant keys, coordinate checks, and RLS", () => {
    expect(migration).toContain('REFERENCES "mtm_customers"("organizationId", "id")')
    expect(migration).toContain('"latitude" BETWEEN -90 AND 90')
    expect(migration).toContain('"status" IN (\'VERIFIED\', \'REJECTED\')')
    expect(migration).toContain('ALTER TABLE "mtm_customer_departments" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_customer_coordinate_verifications" FORCE ROW LEVEL SECURITY')
  })
})
