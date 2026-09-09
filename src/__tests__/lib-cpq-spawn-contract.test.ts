/**
 * S6 CPQ slice-3 piece-4.5 — spawn-contract helper unit tests.
 *
 * The helper is the pure data-construction layer extracted from the
 * Quote PATCH transaction. Tests pin every documented invariant so a
 * future PR can't silently drift the spawn shape.
 */
import { describe, it, expect } from "vitest"
import { buildSpawnedContractData } from "@/lib/cpq/spawn-contract"

const FIXED_NOW = new Date("2026-05-29T16:00:00.000Z")

function fixture() {
  return {
    organizationId: "org-1",
    quote: {
      id: "cmpr3l6e20003508qa37m0daf",
      quoteNumber: "Q-2026-001",
      currency: "AZN",
      dealId: "deal-1",
    },
    rolledTotalAmount: "1200.5000",
    dealCompanyId: "company-1",
    createdByUserId: "user-1",
    now: FIXED_NOW,
  }
}

describe("buildSpawnedContractData — basics", () => {
  it("constructs contractNumber as {quoteNumber}-CTR-{last6cuid}", () => {
    const data = buildSpawnedContractData(fixture())
    // Last 6 chars of "cmpr3l6e20003508qa37m0daf" = "7m0daf"
    expect(data.contractNumber).toBe("Q-2026-001-CTR-7m0daf")
  })

  it("uses a sales-rep-friendly title that names the source quote", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.title).toBe("Quote Q-2026-001 acceptance")
  })

  it("defaults status=draft so user finalises terms separately", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.status).toBe("draft")
  })

  it("type=service_agreement as the CPQ-default contract type", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.type).toBe("service_agreement")
  })

  it("carries the spawnedFromQuoteId for the @unique idempotency constraint", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.spawnedFromQuoteId).toBe("cmpr3l6e20003508qa37m0daf")
  })

  it("notes line auto-explains the provenance", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.notes).toBe("Auto-spawned from accepted quote Q-2026-001.")
  })

  it("startDate stamped to the injected `now` (test-determinism)", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.startDate).toBe(FIXED_NOW)
  })
})

describe("buildSpawnedContractData — money correspondence", () => {
  it("valueAmount mirrors rolledTotalAmount when supplied as string", () => {
    const data = buildSpawnedContractData({ ...fixture(), rolledTotalAmount: "1200.5000" })
    expect(data.valueAmount).toBe("1200.5000")
  })

  it("valueAmount stringifies rolledTotalAmount when supplied as Decimal", () => {
    // Mimic Prisma.Decimal — only the `.toString()` interface matters
    // for the helper's branch. Real callers pass an instance from
    // `rollUpQuote(...)`. Covers the Decimal branch that the route
    // layer pre-converts to string today, but the helper must keep
    // working if a caller hands in a Decimal directly (defense
    // against future refactors).
    const fakeDecimal = { toString: () => "1234.5678" } as unknown as import("@prisma/client").Prisma.Decimal
    const data = buildSpawnedContractData({ ...fixture(), rolledTotalAmount: fakeDecimal })
    expect(data.valueAmount).toBe("1234.5678")
  })

  it("currency is inherited from quote.currency, not hardcoded", () => {
    const data = buildSpawnedContractData({
      ...fixture(),
      quote: { ...fixture().quote, currency: "USD" },
    })
    expect(data.currency).toBe("USD")
  })
})

describe("buildSpawnedContractData — relationship inheritance", () => {
  it("companyId inherited from the pre-resolved dealCompanyId", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.companyId).toBe("company-1")
  })

  it("companyId=null when no deal company resolved (deal has no company FK)", () => {
    const data = buildSpawnedContractData({ ...fixture(), dealCompanyId: null })
    expect(data.companyId).toBeNull()
  })

  it("dealId inherited from quote.dealId", () => {
    const data = buildSpawnedContractData(fixture())
    expect(data.dealId).toBe("deal-1")
  })

  it("dealId=null when quote was standalone (no parent deal)", () => {
    const data = buildSpawnedContractData({
      ...fixture(),
      quote: { ...fixture().quote, dealId: null },
    })
    expect(data.dealId).toBeNull()
  })

  it("createdBy null when no session user (rare system-initiated path)", () => {
    const data = buildSpawnedContractData({ ...fixture(), createdByUserId: null })
    expect(data.createdBy).toBeNull()
  })
})

describe("buildSpawnedContractData — contractNumber collision suffix", () => {
  it("two different quotes with same quoteNumber produce different contract numbers", () => {
    const a = buildSpawnedContractData({
      ...fixture(),
      quote: { ...fixture().quote, id: "cmprfirstquoteid999999" },
    })
    const b = buildSpawnedContractData({
      ...fixture(),
      quote: { ...fixture().quote, id: "cmprsecondquoteidabcdef" },
    })
    expect(a.contractNumber).toBe("Q-2026-001-CTR-999999")
    expect(b.contractNumber).toBe("Q-2026-001-CTR-abcdef")
    expect(a.contractNumber).not.toBe(b.contractNumber)
  })

  it("quote ids shorter than 6 chars pass through unchanged (slice clamp)", () => {
    // `slice(-6)` on a 3-char string returns the original string — no
    // defensive fallback logic, just JavaScript slice semantics. Test
    // pins the behaviour so a future refactor doesn't introduce a
    // padding/truncation surprise.
    const data = buildSpawnedContractData({
      ...fixture(),
      quote: { ...fixture().quote, id: "abc" },
    })
    expect(data.contractNumber).toBe("Q-2026-001-CTR-abc")
  })
})
