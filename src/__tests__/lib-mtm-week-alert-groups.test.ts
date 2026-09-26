import { describe, expect, it } from "vitest"
import { groupMtmWeekAlerts, projectMtmWeekAlert } from "@/lib/mtm/week-alert-groups"

const TZ = "Asia/Baku"

function outOfZone(id: string, createdAt: string, distanceMeters: number) {
  return {
    id,
    type: "OUT_OF_ZONE",
    category: "WARNING",
    createdAt: new Date(createdAt),
    title: "Out of zone",
    description: `Agent is ${distanceMeters}m away`,
    metadata: { messageKey: "outOfZoneCheckIn", messageParams: { distanceMeters, geofenceRadius: 150 } },
  }
}

describe("week alert projection", () => {
  it("keeps the localizable key, params and the largest usable distance", () => {
    const alert = projectMtmWeekAlert(outOfZone("a1", "2026-09-14T11:20:00.000Z", 812.4), TZ)
    expect(alert).toMatchObject({
      id: "a1",
      type: "OUT_OF_ZONE",
      date: "2026-09-14",
      messageKey: "outOfZoneCheckIn",
      messageParams: { distanceMeters: 812.4, geofenceRadius: 150 },
      distanceMeters: 812,
    })
  })

  it("falls back to the stored sentence and metadata distance for legacy rows", () => {
    const alert = projectMtmWeekAlert({
      id: "old",
      type: "OUT_OF_ZONE",
      category: "WARNING",
      createdAt: "2026-09-14T11:20:00.000Z",
      title: "Out of zone",
      description: "Agent is 400m away",
      metadata: { distance: 400 },
    }, TZ)
    expect(alert).toMatchObject({ messageKey: null, fallbackText: "Agent is 400m away", distanceMeters: 400 })
  })

  it("drops a row with an unreadable timestamp instead of throwing", () => {
    expect(projectMtmWeekAlert({ id: "x", type: "OUT_OF_ZONE", category: "WARNING", createdAt: "nope" }, TZ)).toBeNull()
  })
})

describe("week alert grouping", () => {
  it("turns 18 alerts into one line per type per tenant-local hour", () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, index) => outOfZone(`h15-${index}`, `2026-09-14T11:${String(index * 9).padStart(2, "0")}:00.000Z`, 300 + index * 100)),
      ...Array.from({ length: 12 }, (_, index) => outOfZone(`h16-${index}`, `2026-09-14T12:${String(index * 4).padStart(2, "0")}:00.000Z`, 200)),
    ]
    const alerts = rows.map((row) => projectMtmWeekAlert(row, TZ)!)
    const groups = groupMtmWeekAlerts(alerts, TZ)
    expect(groups).toHaveLength(2)
    // Newest hour first; hours are Baku time (UTC+4).
    expect(groups[0]).toMatchObject({ type: "OUT_OF_ZONE", date: "2026-09-14", hour: 16, count: 12, maxDistanceMeters: 200 })
    expect(groups[1]).toMatchObject({ hour: 15, count: 6, maxDistanceMeters: 800, firstAt: "2026-09-14T11:00:00.000Z", lastAt: "2026-09-14T11:45:00.000Z" })
    expect(groups[1].latest.id).toBe("h15-5")
  })

  it("splits types within the same hour and groups across the tenant-local midnight correctly", () => {
    const late = projectMtmWeekAlert({ ...outOfZone("late", "2026-09-13T20:30:00.000Z", 100) }, TZ)! // 00:30 on 14 Sep in Baku
    const battery = projectMtmWeekAlert({ id: "b", type: "LOW_BATTERY", category: "CRITICAL", createdAt: "2026-09-13T20:40:00.000Z" }, TZ)!
    const groups = groupMtmWeekAlerts([late, battery], TZ)
    expect(groups.map((group) => [group.date, group.hour, group.type])).toEqual([
      ["2026-09-14", 0, "LOW_BATTERY"],
      ["2026-09-14", 0, "OUT_OF_ZONE"],
    ])
  })
})
