import { describe, it, expect } from "vitest"
import { filterEntityFields, filterWritableFields } from "@/lib/field-filter"

describe("filterEntityFields", () => {
  const entity = {
    id: "1",
    name: "Test Company",
    phone: "+994551234567",
    email: "secret@test.com",
    annualRevenue: 500000,
    description: "Public info",
    organizationId: "org1",
  }

  it("admin sees all fields unfiltered", () => {
    const perms = { phone: "hidden", email: "hidden", annualRevenue: "hidden" }
    const result = filterEntityFields(entity, perms, "admin")
    expect(result).toEqual(entity)
  })

  it("hides fields with access=hidden for non-admin", () => {
    const perms = { phone: "hidden", email: "hidden" }
    const result = filterEntityFields(entity, perms, "sales")
    expect(result).not.toHaveProperty("phone")
    expect(result).not.toHaveProperty("email")
    expect(result).toHaveProperty("name", "Test Company")
    expect(result).toHaveProperty("annualRevenue", 500000)
  })

  it("shows fields with access=visible", () => {
    const perms = { phone: "visible", email: "visible" }
    const result = filterEntityFields(entity, perms, "viewer")
    expect(result).toHaveProperty("phone")
    expect(result).toHaveProperty("email")
  })

  it("shows fields with access=editable", () => {
    const perms = { name: "editable" }
    const result = filterEntityFields(entity, perms, "sales")
    expect(result).toHaveProperty("name", "Test Company")
  })

  it("fields without explicit permission are visible by default", () => {
    const perms = {} // no permissions set
    const result = filterEntityFields(entity, perms, "support")
    expect(result).toEqual(entity)
  })

  it("mixed permissions filter correctly", () => {
    const perms = {
      phone: "hidden",
      email: "visible",
      annualRevenue: "editable",
      description: "hidden",
    }
    const result = filterEntityFields(entity, perms, "sales")
    expect(result).not.toHaveProperty("phone")
    expect(result).not.toHaveProperty("description")
    expect(result).toHaveProperty("email")
    expect(result).toHaveProperty("annualRevenue")
    expect(result).toHaveProperty("name")
  })

  it("returns empty-ish object when all fields hidden", () => {
    const allHidden: Record<string, string> = {}
    for (const key of Object.keys(entity)) {
      allHidden[key] = "hidden"
    }
    const result = filterEntityFields(entity, allHidden, "viewer")
    expect(Object.keys(result)).toHaveLength(0)
  })
})

describe("filterWritableFields", () => {
  const body = {
    name: "Updated Name",
    phone: "+994551234567",
    email: "new@test.com",
    annualRevenue: 999999,
  }

  it("admin can write all fields", () => {
    const perms = { phone: "visible", email: "hidden" }
    const result = filterWritableFields(body, perms, "admin")
    expect(result).toEqual(body)
  })

  it("non-admin can only write editable fields", () => {
    const perms = { name: "editable", phone: "visible", email: "hidden" }
    const result = filterWritableFields(body, perms, "sales")
    expect(result).toHaveProperty("name", "Updated Name")
    expect(result).not.toHaveProperty("phone") // visible = read-only
    expect(result).not.toHaveProperty("email") // hidden = no access
    expect(result).toHaveProperty("annualRevenue") // no permission = writable
  })

  it("fields without permission are writable by default", () => {
    const perms = {}
    const result = filterWritableFields(body, perms, "support")
    expect(result).toEqual(body)
  })

  it("rejects visible fields from write", () => {
    const perms = { name: "visible", phone: "visible", email: "visible", annualRevenue: "visible" }
    const result = filterWritableFields(body, perms, "viewer")
    expect(Object.keys(result)).toHaveLength(0)
  })

  it("rejects hidden fields from write", () => {
    const perms = { name: "hidden", phone: "hidden" }
    const result = filterWritableFields(body, perms, "sales")
    expect(result).not.toHaveProperty("name")
    expect(result).not.toHaveProperty("phone")
    expect(result).toHaveProperty("email")
    expect(result).toHaveProperty("annualRevenue")
  })
})
