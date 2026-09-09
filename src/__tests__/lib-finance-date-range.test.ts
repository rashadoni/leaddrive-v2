/**
 * Unit tests for parseOptionalDateRange (src/lib/finance/date-range.ts).
 *
 * The helper is now shared across finance/dashboard, finance/receivables,
 * and finance/payables/stats — centralises all E-4 validation so each
 * consumer only needs `if (rangeResult.errorResponse) return rangeResult.errorResponse`.
 */
import { describe, it, expect } from "vitest"
import { NextRequest } from "next/server"
import { parseOptionalDateRange } from "@/lib/finance/date-range"

function req(query: string) {
  return new NextRequest(new URL(`/api/test?${query}`, "http://localhost:3000"))
}

describe("parseOptionalDateRange", () => {
  // ── No params ───────────────────────────────────────────────────────────────

  it("returns hasDateRange=false when no params provided", () => {
    const result = parseOptionalDateRange(req(""))
    expect(result.hasDateRange).toBe(false)
    expect(result.errorResponse).toBeUndefined()
    expect(result.dateRangeFilter).toBeUndefined()
    expect(result.startMonth).toBe(1)
    expect(result.endMonth).toBe(12)
  })

  // ── Partial input (XOR guard) ────────────────────────────────────────────────

  it("returns 400 when only dateFrom is provided", async () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-03-01"))
    expect(result.errorResponse).toBeDefined()
    const json = await result.errorResponse!.json()
    expect(json.error).toMatch(/dateFrom and dateTo are required/i)
    expect(result.errorResponse!.status).toBe(400)
  })

  it("returns 400 when only dateTo is provided", async () => {
    const result = parseOptionalDateRange(req("dateTo=2026-03-31"))
    expect(result.errorResponse).toBeDefined()
    expect(result.errorResponse!.status).toBe(400)
  })

  // ── Invalid date strings ─────────────────────────────────────────────────────

  it("returns 400 when dateFrom is not a valid date", async () => {
    const result = parseOptionalDateRange(req("dateFrom=not-a-date&dateTo=2026-03-31"))
    expect(result.errorResponse).toBeDefined()
    const json = await result.errorResponse!.json()
    expect(json.error).toMatch(/invalid/i)
    expect(result.errorResponse!.status).toBe(400)
  })

  it("returns 400 when dateTo is not a valid date", async () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-03-01&dateTo=garbage"))
    expect(result.errorResponse).toBeDefined()
    expect(result.errorResponse!.status).toBe(400)
  })

  // ── Inverted range ───────────────────────────────────────────────────────────

  it("returns 400 when dateFrom is after dateTo", async () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-04-01&dateTo=2026-03-01"))
    expect(result.errorResponse).toBeDefined()
    const json = await result.errorResponse!.json()
    expect(json.error).toMatch(/after/i)
    expect(result.errorResponse!.status).toBe(400)
  })

  // ── Cross-year range ─────────────────────────────────────────────────────────

  it("returns 400 when range crosses calendar year boundary", async () => {
    const result = parseOptionalDateRange(req("dateFrom=2025-12-01&dateTo=2026-01-31"))
    expect(result.errorResponse).toBeDefined()
    const json = await result.errorResponse!.json()
    expect(json.error).toMatch(/calendar year/i)
    expect(result.errorResponse!.status).toBe(400)
  })

  // ── Happy paths ──────────────────────────────────────────────────────────────

  it("returns active range for a valid same-year window", () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-03-01&dateTo=2026-03-31"))
    expect(result.hasDateRange).toBe(true)
    expect(result.errorResponse).toBeUndefined()
    expect(result.year).toBe(2026)
    expect(result.startMonth).toBe(3)
    expect(result.endMonth).toBe(3)
  })

  it("normalises bare YYYY-MM-DD to UTC midnight / end-of-day", () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-03-01&dateTo=2026-03-31"))
    expect(result.hasDateRange).toBe(true)
    const { gte, lte } = result.dateRangeFilter!
    expect(gte.toISOString()).toBe("2026-03-01T00:00:00.000Z")
    expect(lte.toISOString()).toBe("2026-03-31T23:59:59.999Z")
  })

  it("handles a full-year window (Jan–Dec)", () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-01-01&dateTo=2026-12-31"))
    expect(result.hasDateRange).toBe(true)
    expect(result.startMonth).toBe(1)
    expect(result.endMonth).toBe(12)
    expect(result.year).toBe(2026)
  })

  it("accepts same-day range (dateFrom === dateTo)", () => {
    const result = parseOptionalDateRange(req("dateFrom=2026-06-15&dateTo=2026-06-15"))
    expect(result.hasDateRange).toBe(true)
    expect(result.startMonth).toBe(6)
    expect(result.endMonth).toBe(6)
  })
})
