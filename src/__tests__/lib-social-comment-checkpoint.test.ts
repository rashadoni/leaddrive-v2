import { describe, expect, it } from "vitest"
import { planSocialCommentCheckpoint } from "@/lib/social/comment-checkpoint"

describe("social comment checkpoint cadence", () => {
  const now = new Date("2026-07-22T21:00:00.000Z")

  it("makes a newly discovered parent immediately due", () => {
    expect(planSocialCommentCheckpoint({
      state: {
        discoveredAt: now,
        lastActivityAt: now,
        lastSuccessfulAt: null,
        consecutiveNoChange: 0,
        status: "ACTIVE",
      },
      now,
    })).toMatchObject({ status: "ACTIVE", nextDueAt: now, reason: "FIRST_SCAN" })
  })

  it.each([
    [12, 1, "YOUNG_POST"],
    [48, 6, "RECENT_POST"],
    [24 * 10, 24, "OLDER_POST"],
  ] as const)("uses adaptive cadence for a %s-hour-old parent", (ageHours, cadenceHours, reason) => {
    const lastSuccessfulAt = new Date(now.getTime() - 30 * 60_000)
    expect(planSocialCommentCheckpoint({
      state: {
        discoveredAt: new Date(now.getTime() - ageHours * 3_600_000),
        lastActivityAt: lastSuccessfulAt,
        lastSuccessfulAt,
        consecutiveNoChange: 1,
        status: "ACTIVE",
      },
      now,
    })).toMatchObject({ cadenceHours, reason })
  })

  it("retires a parent only after both age and quiet time reach thirty days", () => {
    expect(planSocialCommentCheckpoint({
      state: {
        discoveredAt: new Date("2026-06-01T00:00:00.000Z"),
        lastActivityAt: new Date("2026-06-15T00:00:00.000Z"),
        lastSuccessfulAt: new Date("2026-07-21T21:00:00.000Z"),
        consecutiveNoChange: 12,
        status: "ACTIVE",
      },
      now: new Date("2026-07-22T21:00:00.000Z"),
    })).toMatchObject({ status: "INACTIVE", nextDueAt: null, reason: "THIRTY_DAYS_QUIET" })
  })
})
