import { describe, expect, it } from "vitest"
import { socialMentionSurfaceWhere } from "@/lib/social/mention-surface"

describe("accepted mention surface predicates", () => {
  it("makes media an explicit content surface including legacy video platforms", () => {
    expect(socialMentionSurfaceWhere("media")).toEqual(expect.objectContaining({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            { contentKind: { in: ["VIDEO", "IMAGE", "AUDIO"] } },
            expect.objectContaining({
              AND: expect.arrayContaining([
                { platform: { in: ["youtube", "tiktok"] } },
              ]),
            }),
          ]),
        }),
      ]),
    }))
  })

  it("excludes every media-evidence branch from text posts", () => {
    expect(socialMentionSurfaceWhere("posts")).toEqual(expect.objectContaining({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { contentKind: "POST" },
                { platform: { notIn: ["youtube", "tiktok"] } },
              ]),
            }),
            expect.objectContaining({
              AND: expect.arrayContaining([
                expect.objectContaining({ NOT: expect.objectContaining({ OR: expect.any(Array) }) }),
              ]),
            }),
          ]),
        }),
      ]),
    }))
  })

  it("treats an explicit post kind as authoritative when legacy media metadata is absent", () => {
    expect(socialMentionSurfaceWhere("posts")).toEqual(expect.objectContaining({
      AND: expect.arrayContaining([
        expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { contentKind: "POST" },
                { platform: { notIn: ["youtube", "tiktok"] } },
              ]),
            }),
          ]),
        }),
      ]),
    }))
  })
})
