import { describe, expect, it } from "vitest"
import { mediaDashboardObservationWhere } from "@/lib/social/media-observations"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

const riskScope = {
  OR: [
    { mention: { is: null } },
    { mention: { is: riskRelevantMentionWhere() } },
  ],
}

describe("media dashboard server filters", () => {
  it("filters known sentiment before the observation limit", () => {
    expect(mediaDashboardObservationWhere("org-1", { sentiment: "negative" })).toEqual({
      organizationId: "org-1",
      purgedAt: null,
      AND: [
        riskScope,
        { mention: { is: { sentiment: "negative" } } },
      ],
    })
  })

  it("keeps observations without a mention or without classified sentiment", () => {
    expect(mediaDashboardObservationWhere("org-1", { sentiment: "unknown" })).toEqual({
      organizationId: "org-1",
      purgedAt: null,
      AND: [
        riskScope,
        {
          OR: [
            { mention: { is: null } },
            { mention: { is: { sentiment: null } } },
          ],
        },
      ],
    })
  })

  it("always hides media linked to positive or unresolved legacy comments", () => {
    expect(mediaDashboardObservationWhere("org-1")).toEqual({
      organizationId: "org-1",
      purgedAt: null,
      AND: [riskScope],
    })
  })
})
