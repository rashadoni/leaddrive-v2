import { describe, expect, it } from "vitest"

import { PharmacyCatalog } from "@/lib/voice-agent/pharmacy/catalog"
import { PharmacyOrderError, type PharmacyProduct } from "@/lib/voice-agent/pharmacy/contracts"
import { buildPharmacyOrderDraft } from "@/lib/voice-agent/pharmacy/draft"

const now = new Date("2026-10-22T08:00:00Z")
// Fictitious products: these fixtures make no medical/substitution claim.
function product(overrides: Partial<PharmacyProduct> = {}): PharmacyProduct {
  return {
    organizationId: "zeytun-test", externalId: "sku-1", name: "Тестмедин",
    approvedAliases: ["Testmedin"], strength: "500 мг", form: "таблетки",
    packSize: "20 таблеток", salesUnit: "упаковка", manufacturer: "Test factory A",
    orderMultiple: 1, active: true, requiresIdentityReview: false, ...overrides,
  }
}
function snapshot(products = [product()]) {
  return {
    organizationId: "zeytun-test", version: "catalog-v1",
    capturedAt: "2026-10-22T07:00:00Z", expiresAt: "2026-10-22T09:00:00Z",
    complete: true as const, products,
  }
}
function request(overrides: Record<string, unknown> = {}) {
  return { name: "Тестмедин", strength: "500 мг", form: "таблетки", packSize: "20 таблеток", salesUnit: "упаковка", ...overrides }
}
function resolve(catalog: PharmacyCatalog, input: unknown) {
  return catalog.resolve("zeytun-test", input, now)
}
function draft(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "zeytun-test", callId: "call-1", counterpartyId: "customer-1",
    branchId: "branch-1", revision: 1,
    lines: [{ lineId: "line-1", product: request(), quantity: 10 }], ...overrides,
  }
}

describe("pharmacy catalogue boundary", () => {
  it("rejects a snapshot assembled with another tenant's rows", () => {
    expect(() => new PharmacyCatalog(snapshot([product({ organizationId: "other-tenant" })])))
      .toThrow("invalid_catalog")
  })
  it("rejects incomplete snapshots, duplicate IDs, invalid lifetimes and guessed fields", () => {
    for (const input of [
      { ...snapshot(), complete: false },
      snapshot([product(), product()]),
      { ...snapshot(), expiresAt: snapshot().capturedAt },
      snapshot([ { ...product(), price: 1 } as PharmacyProduct ]),
    ]) expect(() => new PharmacyCatalog(input)).toThrow("invalid_catalog")
  })
  it("does not disclose candidates to another tenant, including for an expired snapshot", () => {
    const catalog = new PharmacyCatalog(snapshot())
    expect(() => catalog.resolve("other-tenant", { externalId: "sku-1" }, new Date("2030-01-01")))
      .toThrow(new PharmacyOrderError("tenant_mismatch"))
  })
  it.each(["2026-10-22T09:00:00Z", "2026-10-22T06:00:00Z", "invalid"])("blocks stale/future/invalid time %s", (time) => {
    expect(() => new PharmacyCatalog(snapshot()).resolve("zeytun-test", request(), new Date(time)))
      .toThrow("catalog_unavailable")
  })
  it("validates request boundaries without accepting a model confidence override", () => {
    const catalog = new PharmacyCatalog(snapshot())
    for (const input of [{}, { name: " " }, { name: "x".repeat(241) }, { ...request(), confidence: 1 }]) {
      expect(() => resolve(catalog, input)).toThrow("invalid_request")
    }
  })
  it("isolates the index from mutation of the original data and returned candidates", () => {
    const data = snapshot()
    const catalog = new PharmacyCatalog(data)
    data.products[0].strength = "5 мг"
    const first = resolve(catalog, request())
    first.candidates[0].strength = "50 мг"
    expect(resolve(catalog, request())).toMatchObject({ status: "resolved", product: { strength: "500 мг" } })
  })
})

describe("pharmacy identity selection", () => {
  it("resolves a fully specified name with harmless case/spacing variation", () => {
    expect(resolve(new PharmacyCatalog(snapshot()), request({ name: "  ТЕСТМЕДИН  " })))
      .toMatchObject({ status: "resolved", product: { externalId: "sku-1" } })
  })
  it("uses approved cross-script aliases but never auto-resolves a typo", () => {
    const catalog = new PharmacyCatalog(snapshot())
    expect(resolve(catalog, request({ name: "Testmedin" })).status).toBe("resolved")
    expect(resolve(catalog, request({ name: "Тестмедн" })))
      .toMatchObject({ status: "needs_clarification", reason: "similar_names", field: "name" })
  })
  it("requires missing strength even when the name has just one match", () => {
    expect(resolve(new PharmacyCatalog(snapshot()), { name: "Тестмедин" }))
      .toMatchObject({ status: "needs_clarification", field: "strength" })
  })
  it("accepts an explicit code, but a wrong code or conflicting name never falls back", () => {
    const catalog = new PharmacyCatalog(snapshot())
    expect(resolve(catalog, { externalId: "sku-1" }).status).toBe("resolved")
    expect(resolve(catalog, request({ externalId: "missing" })).status).toBe("not_found")
    expect(resolve(catalog, { externalId: "sku-1", name: "Другой препарат" }))
      .toMatchObject({ status: "needs_clarification", reason: "attribute_conflict", field: "name" })
  })
  it.each(["50 мг", "500 мкг", "0,5 г", "500 мг/5 мл"])("does not silently convert or guess strength %s", (strength) => {
    expect(resolve(new PharmacyCatalog(snapshot()), request({ strength })))
      .toMatchObject({ status: "needs_clarification", reason: "attribute_conflict", field: "strength" })
  })
  it("distinguishes forms, packs and order units", () => {
    const catalog = new PharmacyCatalog(snapshot())
    for (const [field, value] of [["form", "раствор"], ["packSize", "10 таблеток"], ["salesUnit", "коробка"]]) {
      expect(resolve(catalog, request({ [field]: value })))
        .toMatchObject({ status: "needs_clarification", reason: "attribute_conflict", field })
    }
  })
  it("asks for the manufacturer when all other attributes match", () => {
    const catalog = new PharmacyCatalog(snapshot([product(), product({ externalId: "sku-2", manufacturer: "Test factory B" })]))
    expect(resolve(catalog, request())).toMatchObject({ status: "needs_clarification", field: "manufacturer", candidateCount: 2 })
    expect(resolve(catalog, request({ manufacturer: "Test factory B" })))
      .toMatchObject({ status: "resolved", product: { externalId: "sku-2" } })
  })
  it("does not hide ambiguity when the presentation limit is five", () => {
    const catalog = new PharmacyCatalog(snapshot(Array.from({ length: 7 }, (_, i) => product({ externalId: `sku-${i}` }))))
    const result = resolve(catalog, request())
    expect(result).toMatchObject({ status: "needs_clarification", reason: "ambiguous", candidateCount: 7 })
    expect(result.candidates).toHaveLength(5)
  })
  it("retains inactive candidates in ambiguity and never substitutes them", () => {
    const catalog = new PharmacyCatalog(snapshot([product(), product({ externalId: "inactive", active: false })]))
    expect(resolve(catalog, request())).toMatchObject({ status: "needs_clarification", candidateCount: 2 })
    expect(resolve(catalog, { externalId: "inactive" })).toMatchObject({ status: "needs_review", reason: "inactive_product" })
  })
  it("does not discard an incompletely described competing SKU", () => {
    const catalog = new PharmacyCatalog(snapshot([product(), product({ externalId: "unknown-dose", strength: null })]))
    expect(resolve(catalog, request())).toMatchObject({ status: "needs_review", reason: "incomplete_product", candidateCount: 2 })
  })
  it("routes curated identity risks to a human even for an exact code", () => {
    const catalog = new PharmacyCatalog(snapshot([product({ requiresIdentityReview: true })]))
    expect(resolve(catalog, { externalId: "sku-1" })).toMatchObject({ status: "needs_review", reason: "identity_risk" })
  })
  it("does not erase meaningful Azerbaijani letters", () => {
    const catalog = new PharmacyCatalog(snapshot([product({ name: "Sınaq", approvedAliases: [] })]))
    expect(resolve(catalog, request({ name: "Sinaq" })).status).not.toBe("resolved")
    expect(resolve(catalog, request({ name: "Sınaq" })).status).toBe("resolved")
  })
  it("reuses one 10,000-item index and keeps a typo unresolved at catalogue scale", () => {
    const products = Array.from({ length: 10_000 }, (_, i) => product({
      externalId: `catalogue-${i}`, name: `Каталожный образец ${i}`, approvedAliases: [],
    }))
    const catalog = new PharmacyCatalog(snapshot(products))
    for (const i of [0, 4999, 9999]) {
      expect(resolve(catalog, { externalId: `catalogue-${i}` }))
        .toMatchObject({ status: "resolved", product: { externalId: `catalogue-${i}` } })
    }
    const suggestions = resolve(catalog, { name: "Каталожный образц 4999" })
    expect(suggestions.status).toBe("needs_clarification")
    expect(suggestions.candidates.length).toBeLessThanOrEqual(5)
    expect(suggestions.candidateCount).toBeGreaterThan(5)
  })
})

describe("pharmacy order draft for operator review", () => {
  it("builds exact SKU/unit/quantity lines without inventing price, stock or acceptance", () => {
    const preview = buildPharmacyOrderDraft(new PharmacyCatalog(snapshot()), draft(), now)
    expect(preview).toMatchObject({ status: "awaiting_operator_review", pricing: "not_checked", availability: "not_checked", canSubmitTo1c: false })
    expect(preview.lines[0]).toMatchObject({ quantity: 10, quantityIssue: null, resolution: { product: { externalId: "sku-1", salesUnit: "упаковка" } } })
  })
  it.each([null, 0, -1, 1.5, 1_000_001])("keeps invalid/missing quantity %s unresolved", (quantity) => {
    const preview = buildPharmacyOrderDraft(new PharmacyCatalog(snapshot()), draft({ lines: [{ lineId: "line-1", product: request(), quantity }] }), now)
    expect(preview.status).toBe("collecting")
    expect(preview.lines[0].quantityIssue).toBe(quantity === null ? "quantity_required" : "invalid_quantity")
  })
  it("does not round an order to a multiple or automatically merge duplicate SKUs", () => {
    const catalog = new PharmacyCatalog(snapshot([product({ orderMultiple: 6 })]))
    const preview = buildPharmacyOrderDraft(catalog, draft(), now)
    expect(preview.lines[0]).toMatchObject({ quantity: 10, quantityIssue: "order_multiple" })
    const twoLines = buildPharmacyOrderDraft(catalog, draft({ lines: [
      { lineId: "a", product: request(), quantity: 6 }, { lineId: "b", product: request(), quantity: 12 },
    ] }), now)
    expect(twoLines.lines).toHaveLength(2)
  })
  it("keeps ambiguous lines in the draft rather than silently dropping them", () => {
    const preview = buildPharmacyOrderDraft(new PharmacyCatalog(snapshot()), draft({ lines: [
      { lineId: "a", product: request(), quantity: 10 }, { lineId: "b", product: { name: "Тестмедн" }, quantity: 5 },
    ] }), now)
    expect(preview.status).toBe("collecting")
    expect(preview.lines).toHaveLength(2)
    expect(preview.lines[1].resolution.status).toBe("needs_clarification")
  })
  it("rejects foreign scope, duplicate line IDs, empty drafts and excessive line counts", () => {
    const catalog = new PharmacyCatalog(snapshot())
    expect(() => buildPharmacyOrderDraft(catalog, draft({ organizationId: "other" }), now)).toThrow("tenant_mismatch")
    for (const lines of [[], [draft().lines[0], draft().lines[0]], Array(101).fill(draft().lines[0])]) {
      expect(() => buildPharmacyOrderDraft(catalog, draft({ lines }), now)).toThrow("invalid_draft")
    }
  })
  it("rechecks freshness at draft time and rejects nonfinite quantities and missing customer bindings", () => {
    const catalog = new PharmacyCatalog(snapshot())
    expect(() => buildPharmacyOrderDraft(catalog, draft(), new Date("2026-10-22T10:00:00Z")))
      .toThrow("catalog_unavailable")
    for (const input of [
      draft({ counterpartyId: "" }), draft({ branchId: "" }),
      draft({ lines: [{ lineId: "a", product: request(), quantity: Infinity }] }),
    ]) expect(() => buildPharmacyOrderDraft(catalog, input, now)).toThrow("invalid_draft")
  })
  it("binds the fingerprint to corrections, catalogue version, call, customer and branch", () => {
    const catalog = new PharmacyCatalog(snapshot())
    const first = buildPharmacyOrderDraft(catalog, draft(), now)
    expect(buildPharmacyOrderDraft(catalog, draft(), now).contentHash).toBe(first.contentHash)
    for (const override of [
      { revision: 2 }, { callId: "call-2" }, { counterpartyId: "customer-2" }, { branchId: "branch-2" },
      { lines: [{ lineId: "line-1", product: request(), quantity: 20 }] },
    ]) expect(buildPharmacyOrderDraft(catalog, draft(override), now).contentHash).not.toBe(first.contentHash)
    expect(buildPharmacyOrderDraft(new PharmacyCatalog({ ...snapshot(), version: "v2" }), draft(), now).contentHash)
      .not.toBe(first.contentHash)
  })
})
