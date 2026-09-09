import { describe, expect, it } from "vitest"
import {
  OrganizationAttributeRowsSchema,
  localizedOrganizationAttributeLabel,
  organizationAttributePackageSignatureIsCoherent,
  organizationAttributeRowsHash,
} from "@/lib/mtm/organization-attributes"

const rows = [{
  organizationCode: "3799",
  medicalCategory: { code: "A", labels: { ru: "Категория A", az: "A kateqoriyası", en: "Category A" } },
  license: { status: "LICENSED" as const, labels: { ru: "Есть", az: "Var", en: "Licensed" } },
  polygon: { code: "BAKU-01", labels: { ru: "Баку 01", az: "Bakı 01", en: "Baku 01" } },
}]

describe("SWM-07 signed organization attributes", () => {
  it("validates factual rows and canonicalizes row order", () => {
    expect(OrganizationAttributeRowsSchema.safeParse(rows).success).toBe(true)
    const second = [{ ...rows[0], organizationCode: "4000" }, rows[0]]
    expect(organizationAttributeRowsHash(second)).toBe(organizationAttributeRowsHash([...second].reverse()))
  })

  it("rejects duplicate Etalon IDs and rows that assert no attribute", () => {
    expect(OrganizationAttributeRowsSchema.safeParse([rows[0], rows[0]]).success).toBe(false)
    expect(OrganizationAttributeRowsSchema.safeParse([{ organizationCode: "3799" }]).success).toBe(false)
  })

  it("requires a complete immutable signature envelope", () => {
    const active = {
      status: "ACTIVE",
      approvalReference: "SWM-07 approval",
      signedByUserId: "admin",
      signedAt: new Date(),
      activatedAt: new Date(),
      retiredAt: null,
    }
    expect(organizationAttributePackageSignatureIsCoherent(active)).toBe(true)
    expect(organizationAttributePackageSignatureIsCoherent({ ...active, approvalReference: null })).toBe(false)
    expect(organizationAttributePackageSignatureIsCoherent({ ...active, retiredAt: new Date() })).toBe(false)
  })

  it("uses the requested locale and never guesses an absent label", () => {
    expect(localizedOrganizationAttributeLabel(rows[0].medicalCategory.labels, "ru")).toBe("Категория A")
    expect(localizedOrganizationAttributeLabel(rows[0].medicalCategory.labels, "az-AZ")).toBe("A kateqoriyası")
    expect(localizedOrganizationAttributeLabel(null, "en")).toBeNull()
  })
})
