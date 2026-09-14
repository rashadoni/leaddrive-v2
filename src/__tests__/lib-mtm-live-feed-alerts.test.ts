import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  buildMtmLiveFeedAlertMessage,
  groupMtmLiveFeedAlerts,
  mtmLiveFeedHistoryHref,
  type MtmLiveFeedAlertRow,
} from "@/lib/mtm/live-feed-alerts"

function deviation(id: string, at: string, meters: number, agentId = "anar"): MtmLiveFeedAlertRow {
  return {
    id,
    agentId,
    agentName: agentId === "anar" ? "Anar Mammadov" : "Leyla",
    type: "OUT_OF_ZONE",
    title: "Route deviation detected",
    createdAt: at,
    metadata: {
      deviationMeters: meters,
      messageKey: "routeDeviation",
      messageParams: { deviationMeters: meters, thresholdMeters: 500 },
    },
  }
}

describe("live feed alert message", () => {
  it("reads the stored key and number instead of the English title", () => {
    expect(buildMtmLiveFeedAlertMessage("OUT_OF_ZONE", deviation("a", "2026-09-14T13:00:00Z", 7734).metadata))
      .toEqual({ key: "routeDeviation", distanceMeters: 7734 })
    expect(buildMtmLiveFeedAlertMessage("OUT_OF_ZONE", {
      messageKey: "geofenceViolation",
      messageParams: { customerName: "ADV-Store 1", distanceMeters: 13100, geofenceRadius: 100 },
    })).toEqual({ key: "outOfZoneCheckIn", distanceMeters: 13100 })
    expect(buildMtmLiveFeedAlertMessage("LONG_BREAK", {
      messageKey: "visitStillOpen",
      messageParams: { customerName: "X", minutes: 95, thresholdMinutes: 60 },
    })).toEqual({ key: "visitStillOpen", minutes: 95 })
  })

  it("recovers the distance from rows written before message keys existed", () => {
    expect(buildMtmLiveFeedAlertMessage("OUT_OF_ZONE", { deviationMeters: 812, threshold: 500 }))
      .toEqual({ key: "routeDeviation", distanceMeters: 812 })
  })

  it("falls back to the alert type, never to an empty sentence", () => {
    expect(buildMtmLiveFeedAlertMessage("LOW_BATTERY", null)).toEqual({ key: "type", alertType: "LOW_BATTERY" })
    expect(buildMtmLiveFeedAlertMessage("OUT_OF_ZONE", { deviationMeters: "far" })).toEqual({ key: "type", alertType: "OUT_OF_ZONE" })
  })

  it("has feed strings for every message key in every language", () => {
    for (const locale of ["en", "ru", "az"]) {
      const feed = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")).mtmMap.feed
      expect(feed.routeDeviation).toContain("{distance}")
      expect(feed.outOfZoneCheckIn).toContain("{distance}")
      expect(feed.visitStillOpen).toContain("{minutes}")
      expect(feed.repeated).toMatch(/\{count[},]/)
    }
  })
})

describe("groupMtmLiveFeedAlerts", () => {
  it("collapses ten repeats in one local hour into one row with the farthest distance", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      deviation(`d${index}`, new Date(Date.UTC(2026, 8, 14, 13, 5 + index * 5)).toISOString(), 7000 + index * 70))
    const groups = groupMtmLiveFeedAlerts(rows, "Asia/Baku")
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      id: "alert-d9",
      agentId: "anar",
      agent: "Anar Mammadov",
      time: "2026-09-14T13:50:00.000Z",
      alert: {
        count: 10,
        firstAt: "2026-09-14T13:05:00.000Z",
        lastAt: "2026-09-14T13:50:00.000Z",
        message: { key: "routeDeviation", distanceMeters: 7630 },
      },
    })
  })

  it("keeps different agents, kinds and hours apart, newest first", () => {
    const groups = groupMtmLiveFeedAlerts([
      deviation("a", "2026-09-14T13:10:00Z", 900),
      deviation("b", "2026-09-14T14:10:00Z", 950),
      deviation("c", "2026-09-14T13:20:00Z", 700, "leyla"),
      { id: "d", agentId: "anar", agentName: "Anar Mammadov", type: "LOW_BATTERY", title: "Low battery", createdAt: "2026-09-14T13:15:00Z", metadata: null },
    ], "Asia/Baku")
    expect(groups.map((group) => group.id)).toEqual(["alert-b", "alert-c", "alert-d", "alert-a"])
  })

  it("groups by the tenant's hour, not UTC's", () => {
    // 13:50 and 14:20 UTC are 18:20 and 18:50 in Kolkata (+05:30): same local hour.
    const groups = groupMtmLiveFeedAlerts([
      deviation("a", "2026-09-14T13:50:00Z", 900),
      deviation("b", "2026-09-14T14:20:00Z", 950),
    ], "Asia/Kolkata")
    expect(groups).toHaveLength(1)
  })
})

describe("mtmLiveFeedHistoryHref", () => {
  it("opens the agent's GPS history around the alert, in tenant time", () => {
    const href = mtmLiveFeedHistoryHref({
      agentId: "anar",
      firstAt: "2026-09-14T13:05:00.000Z",
      lastAt: "2026-09-14T13:50:00.000Z",
      timezone: "Asia/Baku",
    })
    const url = new URL(href, "http://x")
    expect(url.pathname).toBe("/mtm/map")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      mode: "history",
      agentId: "anar",
      date: "2026-09-14",
      from: "16:50",
      to: "18:05",
    })
  })

  it("clamps the window to the day instead of wrapping past midnight", () => {
    const url = new URL(mtmLiveFeedHistoryHref({
      agentId: "anar",
      firstAt: "2026-09-13T20:05:00.000Z",
      lastAt: "2026-09-13T19:55:00.000Z",
      timezone: "Asia/Baku",
    }), "http://x")
    // 00:05 local on the 14th minus 15 minutes would be the 13th.
    expect(url.searchParams.get("date")).toBe("2026-09-14")
    expect(url.searchParams.get("from")).toBe("00:00")
  })
})
