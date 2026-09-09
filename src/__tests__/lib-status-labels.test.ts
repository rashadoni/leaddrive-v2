import { describe, it, expect } from "vitest"
import { enumKey, categoryKey, pickEnumLabel, stageDictKey, type DynamicTranslator } from "@/lib/status-labels"

describe("enumKey", () => {
  it("builds <prefix><Pascal> keys", () => {
    expect(enumKey("category", "partner")).toBe("categoryPartner")
    expect(enumKey("priority", "high")).toBe("priorityHigh")
    expect(enumKey("status", "paid")).toBe("statusPaid")
  })
  it("camel-joins snake_case and kebab-case values", () => {
    expect(enumKey("status", "in_progress")).toBe("statusInProgress")
    expect(enumKey("status", "registration_open")).toBe("statusRegistrationOpen")
    expect(enumKey("type", "cold-call")).toBe("typeColdCall")
  })
})

describe("categoryKey", () => {
  it("is enumKey with the 'category' prefix", () => {
    expect(categoryKey("vip")).toBe("categoryVip")
    expect(categoryKey("service")).toBe("categoryService")
  })
})

describe("stageDictKey", () => {
  it("maps default pipeline stage names to deals dict keys", () => {
    expect(stageDictKey("LEAD")).toBe("stageLead")
    expect(stageDictKey("QUALIFIED")).toBe("stageQualified")
    expect(stageDictKey("WON")).toBe("stageWon")
    expect(stageDictKey("LOST")).toBe("stageLost")
    expect(stageDictKey("CLOSED_WON")).toBe("stageWon")
    expect(stageDictKey("CLOSED_LOST")).toBe("stageLost")
    expect(stageDictKey("Qazanıldı")).toBe("stageWon")
  })
  it("returns undefined for a custom (non-default) stage name", () => {
    expect(stageDictKey("DISCOVERY")).toBeUndefined()
    expect(stageDictKey("custom-stage")).toBeUndefined()
  })
})

describe("pickEnumLabel", () => {
  const dict: Record<string, string> = {
    statusPaid: "Ödənilib",
    statusDraft: "Qaralama",
  }
  // Mimics next-intl: a missing key resolves to the dotted fallback path, NOT raw.
  const t: DynamicTranslator = (k) => dict[k] ?? `invoices.${k}`
  const known = new Set(["draft", "sent", "paid", "overdue"])
  const keyOf = (v: string) => enumKey("status", v)

  it("translates a known value via the dictionary", () => {
    expect(pickEnumLabel(t, known, keyOf, "paid")).toBe("Ödənilib")
    expect(pickEnumLabel(t, known, keyOf, "draft")).toBe("Qaralama")
  })

  it("returns the RAW value for an unknown value — never the dotted key path", () => {
    expect(pickEnumLabel(t, known, keyOf, "foobar")).toBe("foobar")
    expect(pickEnumLabel(t, known, keyOf, "foobar")).not.toContain("invoices.")
  })

  it("trusts the caller's known-set: a declared-known value still goes through t", () => {
    // 'sent' is declared known but absent from this mock dict → t's fallback.
    expect(pickEnumLabel(t, known, keyOf, "sent")).toBe("invoices.statusSent")
  })
})
