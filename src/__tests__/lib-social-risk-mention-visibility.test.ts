import { describe, expect, it } from "vitest"
import { riskRelevantMentionWhere } from "@/lib/social/risk-mention-visibility"

describe("riskRelevantMentionWhere", () => {
  it("keeps publications but exposes only classified risk comments and replies", () => {
    expect(riskRelevantMentionWhere()).toEqual({
      OR: [
        {
          AND: [
            { contentKind: { notIn: ["COMMENT", "REPLY", "comment", "reply"] } },
            { sourceType: { notIn: ["comment", "reply", "COMMENT", "REPLY"] } },
          ],
        },
        {
          AND: [
            {
              OR: [
                { contentKind: { in: ["COMMENT", "REPLY", "comment", "reply"] } },
                { sourceType: { in: ["comment", "reply", "COMMENT", "REPLY"] } },
              ],
            },
            { sentiment: { in: ["negative", "neutral"], mode: "insensitive" } },
          ],
        },
      ],
    })
  })
})
