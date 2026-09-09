import { describe, expect, it, vi } from "vitest"

const db = vi.hoisted(() => ({
  user: vi.fn(async () => ({ timezone: "Asia/Baku" as string | null })),
  organization: vi.fn(async () => ({ settings: { timezone: "Europe/Warsaw" } as unknown })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: db.user },
    organization: { findFirst: db.organization },
  },
}))

import {
  loadVoiceReportingTimezone,
  resolveVoiceForecastRanges,
  resolveVoiceReportingRange,
} from "@/lib/ai/voice/reporting-timezone"

const NOW = new Date("2026-08-11T12:34:56.000Z")

describe("voice reporting timezone", () => {
  it("resolves the authenticated user's timezone before the org fallback", async () => {
    await expect(loadVoiceReportingTimezone("org-1", "user-1")).resolves.toBe("Asia/Baku")
    expect(db.user).toHaveBeenCalledWith({
      where: { id: "user-1", organizationId: "org-1" },
      select: { timezone: true },
    })
  })

  it("uses the org timezone when the user has no preference", async () => {
    db.user.mockResolvedValueOnce({ timezone: null })
    await expect(loadVoiceReportingTimezone("org-1", "user-1")).resolves.toBe("Europe/Warsaw")
  })

  it("bounds today at Baku midnight, not UTC midnight", () => {
    const range = resolveVoiceReportingRange("today", NOW, "Asia/Baku")
    expect(range.from.toISOString()).toBe("2026-08-10T20:00:00.000Z")
    expect(range.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(range.timezone).toBe("Asia/Baku")
    expect(range.label).toBe("2026-08-11")
  })

  it("keeps the rolling week distinct from the calendar month", () => {
    const week = resolveVoiceReportingRange("week", NOW, "Asia/Baku")
    const month = resolveVoiceReportingRange("month", NOW, "Asia/Baku")
    expect(week.from.toISOString()).toBe("2026-08-04T12:34:56.000Z")
    expect(month.from.toISOString()).toBe("2026-07-31T20:00:00.000Z")
  })

  it("keeps quarter actuals to now but forecasts expected closes through quarter end", () => {
    const ranges = resolveVoiceForecastRanges(NOW, "Asia/Baku")

    expect(ranges.actuals.from.toISOString()).toBe("2026-06-30T20:00:00.000Z")
    expect(ranges.actuals.toExclusive.toISOString()).toBe(NOW.toISOString())
    expect(ranges.pipelineToExclusive.toISOString()).toBe("2026-09-30T20:00:00.000Z")
  })
})
