import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import {
  MTM_CONTACT_CLASS_DEFAULTS, MTM_CONTACT_CLASS_PRIORITY, MTM_CONTACT_CLASS_VALUES,
  coerceMtmContactClasses, contactClassOptions, isMtmContactClass, parseMtmContactClasses,
} from "@/lib/mtm/contact-classes"
import { ContactCreateSchema, MtmCustomerCategory } from "@/lib/mtm-validators"
import { MTM_SETTING_DEFAULTS } from "@/lib/mtm-settings"

// Client classes: the letter a company grades a doctor with. A pharma tenant
// grades "A, B, C, VIP" (owner, 2026-10-04); the product stored A..D only.

describe("client classes — what a tenant may use", () => {
  it("changes nothing for a tenant that never touched the setting", () => {
    expect(MTM_SETTING_DEFAULTS.contactClasses).toEqual(["A", "B", "C", "D"])
    expect(coerceMtmContactClasses(undefined)).toEqual([...MTM_CONTACT_CLASS_DEFAULTS])
  })

  it("keeps the tenant's letters in reading order whatever order they were ticked in", () => {
    expect(coerceMtmContactClasses(["VIP", "C", "A", "B"])).toEqual(["A", "B", "C", "VIP"])
  })

  it("drops what is not a class and never ends up empty", () => {
    expect(coerceMtmContactClasses(["A", "S", 1, null])).toEqual(["A"])
    expect(coerceMtmContactClasses([])).toEqual(["A", "B", "C", "D"])
    expect(coerceMtmContactClasses("VIP")).toEqual(["A", "B", "C", "D"])
  })

  it("refuses a bad list at the settings API instead of quietly shortening it", () => {
    expect(parseMtmContactClasses(["A", "B", "C", "VIP"])).toEqual({ success: true, data: ["A", "B", "C", "VIP"] })
    expect(parseMtmContactClasses(["A", "S"]).success).toBe(false)
    expect(parseMtmContactClasses([]).success).toBe(false)
    expect(parseMtmContactClasses("A,B").success).toBe(false)
  })
})

describe("client classes — what one client's dropdown offers", () => {
  it("offers the tenant's list", () => {
    expect(contactClassOptions(["A", "B", "C", "VIP"], "B")).toEqual(["A", "B", "C", "VIP"])
  })

  it("still shows a class the client already has after the tenant stopped offering it", () => {
    // Graded D before the tenant moved to A, B, C, VIP: the field must not open
    // empty and lose the grade on the next save.
    expect(contactClassOptions(["A", "B", "C", "VIP"], "D")).toEqual(["A", "B", "C", "D", "VIP"])
  })

  it("ignores a value that is not a class", () => {
    expect(contactClassOptions(["A", "VIP"], "")).toEqual(["A", "VIP"])
    expect(contactClassOptions(["A", "VIP"], "S")).toEqual(["A", "VIP"])
  })
})

describe("client classes — VIP is a real class, above A", () => {
  it("is accepted wherever a class is written", () => {
    expect(isMtmContactClass("VIP")).toBe(true)
    expect(MtmCustomerCategory.safeParse("VIP").success).toBe(true)
    expect(ContactCreateSchema.safeParse({ firstName: "Aynur", lastName: "Əliyeva", category: "VIP" }).success).toBe(true)
    expect(MtmCustomerCategory.safeParse("S").success).toBe(false)
  })

  it("comes first in importance, and the database orders the enum the same way", () => {
    expect(MTM_CONTACT_CLASS_PRIORITY).toEqual(["VIP", "A", "B", "C", "D"])
    expect([...MTM_CONTACT_CLASS_PRIORITY].sort()).toEqual([...MTM_CONTACT_CLASS_VALUES].sort())

    // "By priority" is ORDER BY category, and Postgres orders an enum by
    // position: appended at the end, VIP would sort below D.
    const migration = readFileSync("prisma/migrations/20261004100000_mtm_customer_category_vip/migration.sql", "utf8")
    expect(migration).toMatch(/ALTER TYPE "MtmCustomerCategory" ADD VALUE IF NOT EXISTS 'VIP' BEFORE 'A';/)
    const schema = readFileSync("prisma/schema.prisma", "utf8")
    const declared = schema.slice(schema.indexOf("enum MtmCustomerCategory {"))
    const values = declared.slice(0, declared.indexOf("}")).split("\n").map((line) => line.trim())
      .filter((line) => /^[A-Z]+$/.test(line))
    expect(values).toEqual([...MTM_CONTACT_CLASS_PRIORITY])
  })

  it("is the order route candidates page through", () => {
    const route = readFileSync("src/app/api/v1/mtm/routes/candidates/route.ts", "utf8")
    expect(route).toContain("const mtmCustomerCategoryOrder: readonly MtmCustomerCategory[] = MTM_CONTACT_CLASS_PRIORITY")
  })
})
