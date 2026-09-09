import { describe, expect, it } from "vitest"
import { providerRunRollup } from "@/lib/social/provider-run-rollup"

describe("provider run operator rollup", () => {
  it("separates funnel counts, actual cost and reserved exposure", () => {
    const rollup = providerRunRollup([
      {
        phase: "DISCOVER_CANDIDATE_POSTS",
        receivedCount: 12,
        acceptedCount: 5,
        reviewCount: 2,
        duplicateCount: 3,
        reservedChargeUsd: "0.05",
        actualChargeUsd: "0.04",
      },
      {
        phase: "ENRICH_CONTENT",
        receivedCount: 5,
        acceptedCount: 4,
        reviewCount: 1,
        duplicateCount: 0,
        reservedChargeUsd: "0.03",
        actualChargeUsd: null,
      },
    ])

    expect(rollup).toEqual({
      candidates: 12,
      enriched: 5,
      review: 3,
      accepted: 9,
      duplicates: 3,
      reservedUsd: 0.08,
      actualUsd: 0.04,
      hasActual: true,
    })
  })

  it("does not turn malformed cost values into NaN", () => {
    expect(providerRunRollup([{
      phase: "PAID_ROUTE_COLLECTION",
      receivedCount: 1,
      acceptedCount: 0,
      reviewCount: 0,
      duplicateCount: 0,
      reservedChargeUsd: "not-a-number",
      actualChargeUsd: null,
    }])).toMatchObject({ reservedUsd: 0, actualUsd: 0, hasActual: false })
  })
})
