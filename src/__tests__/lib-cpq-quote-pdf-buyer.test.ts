/**
 * S6 CPQ — resolveBuyerName unit tests (`src/lib/cpq/quote-pdf.ts`).
 *
 * Verifies the "FOR" buyer precedence without rendering a PDF:
 *   typed customerName (trimmed, non-empty) → linked deal's company →
 *   `Deal: <name>` → "—". Manual name fully overrides the deal lines.
 */
import { describe, it, expect } from "vitest"
import { resolveBuyerName } from "@/lib/cpq/quote-pdf"

describe("resolveBuyerName", () => {
  it("customerName set → returns [customerName.trim()], deal IGNORED even when present", () => {
    expect(
      resolveBuyerName({
        customerName: "Acme Corp",
        deal: { name: "Big Deal", company: { name: "Other Co" } },
      }),
    ).toEqual(["Acme Corp"])
  })

  it("customerName whitespace-only → falls through to deal", () => {
    expect(
      resolveBuyerName({
        customerName: "   ",
        deal: { name: "Summer Campaign", company: { name: "Widgets Ltd" } },
      }),
    ).toEqual(["Widgets Ltd", "Deal: Summer Campaign"])
  })

  it("no customerName + deal with company → [company.name, 'Deal: <name>']", () => {
    expect(
      resolveBuyerName({
        customerName: null,
        deal: { name: "Q1 Renewal", company: { name: "Globex Inc" } },
      }),
    ).toEqual(["Globex Inc", "Deal: Q1 Renewal"])
  })

  it("no customerName + deal WITHOUT company → ['Deal: <name>']", () => {
    expect(
      resolveBuyerName({
        customerName: null,
        deal: { name: "Unnamed Deal", company: null },
      }),
    ).toEqual(["Deal: Unnamed Deal"])
  })

  it("no customerName + no deal (null) → ['—']", () => {
    expect(resolveBuyerName({ customerName: null, deal: null })).toEqual(["—"])
  })

  it("customerName trims surrounding spaces", () => {
    expect(
      resolveBuyerName({
        customerName: "  Trimmed Name  ",
        deal: null,
      }),
    ).toEqual(["Trimmed Name"])
  })
})
