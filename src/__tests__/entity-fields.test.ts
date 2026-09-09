import { describe, it, expect } from "vitest"
import { ENTITY_FIELDS, ENTITY_TYPES } from "@/lib/entity-fields"

describe("entity-fields", () => {
  it("defines the supported field-permission entity types", () => {
    expect(ENTITY_TYPES).toEqual([
      "company",
      "contact",
      "deal",
      "contract",
      "invoice",
      "bill",
      "payment_order",
      "offer",
      "quote",
      "campaign",
      "mtm_route",
      "mtm_visit",
      "mtm_photo",
      "lead",
      "ticket",
      "task",
      "activity",
    ])
  })

  it("every entity has at least 1 field", () => {
    for (const type of ENTITY_TYPES) {
      expect(ENTITY_FIELDS[type].length).toBeGreaterThan(0)
    }
  })

  it("every field has name and label", () => {
    for (const type of ENTITY_TYPES) {
      for (const field of ENTITY_FIELDS[type]) {
        expect(field.name).toBeTruthy()
        expect(field.label).toBeTruthy()
      }
    }
  })

  it("no duplicate field names within entity", () => {
    for (const type of ENTITY_TYPES) {
      const names = ENTITY_FIELDS[type].map(f => f.name)
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    }
  })

  // Verify real Prisma field names are used
  it("company uses correct Prisma field names", () => {
    const names = ENTITY_FIELDS.company.map(f => f.name)
    expect(names).toContain("name")
    expect(names).toContain("annualRevenue") // not annual_revenue
    expect(names).toContain("employeeCount") // not employee_count
    expect(names).toContain("voen")
    expect(names).not.toContain("firstName") // this doesn't exist on company
  })

  it("contact uses fullName not firstName/lastName", () => {
    const names = ENTITY_FIELDS.contact.map(f => f.name)
    expect(names).toContain("fullName")
    expect(names).not.toContain("firstName")
    expect(names).not.toContain("lastName")
  })

  it("deal uses valueAmount not value", () => {
    const names = ENTITY_FIELDS.deal.map(f => f.name)
    expect(names).toContain("valueAmount")
    expect(names).not.toContain("value")
  })

  it("lead uses contactName not name", () => {
    const names = ENTITY_FIELDS.lead.map(f => f.name)
    expect(names).toContain("contactName")
    expect(names).not.toContain("name")
  })

  it("sensitive fields are marked", () => {
    const companySensitive = ENTITY_FIELDS.company.filter(f => f.sensitive).map(f => f.name)
    expect(companySensitive).toContain("phone")
    expect(companySensitive).toContain("email")
    expect(companySensitive).toContain("annualRevenue")
    expect(companySensitive).toContain("voen")

    const contactSensitive = ENTITY_FIELDS.contact.filter(f => f.sensitive).map(f => f.name)
    expect(contactSensitive).toContain("phone")
    expect(contactSensitive).toContain("email")
  })
})
