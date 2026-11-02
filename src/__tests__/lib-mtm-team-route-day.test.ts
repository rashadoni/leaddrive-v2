import { describe, expect, it } from "vitest"
import { teamRouteDay, type TeamRouteDayPoint } from "@/lib/mtm/team-route-day"

/**
 * The manager's «Komanda» card tells an agent's day like a parcel in a
 * tracking app (owner, 2026-11-01): who he began with and when, who is next,
 * whom he is with now.
 */
const at = (time: string) => new Date(`2026-11-02T${time}:00.000Z`)
const point = (over: Partial<TeamRouteDayPoint> & Pick<TeamRouteDayPoint, "id" | "orderIndex">): TeamRouteDayPoint => ({
  status: "PENDING",
  plannedTime: null,
  visitedAt: null,
  customer: { name: `Аптека ${over.id}` },
  contact: null,
  ...over,
})

describe("an agent's day for the manager's card", () => {
  it("begins with the first client visited, by time — not by the order of the plan", () => {
    const day = teamRouteDay([
      point({ id: "a", orderIndex: 0, status: "VISITED", visitedAt: at("09:40") }),
      point({ id: "b", orderIndex: 1, status: "VISITED", visitedAt: at("09:10") }),
      point({ id: "c", orderIndex: 2 }),
    ], null)
    expect(day?.first).toEqual({ name: "Аптека b", at: at("09:10").toISOString() })
  })

  it("names the next stop still ahead in the order of the plan, with its planned time", () => {
    const day = teamRouteDay([
      point({ id: "a", orderIndex: 0, status: "VISITED", visitedAt: at("09:10") }),
      point({ id: "s", orderIndex: 1, status: "SKIPPED" }),
      point({ id: "d", orderIndex: 3, plannedTime: at("15:00") }),
      point({ id: "c", orderIndex: 2, plannedTime: at("14:30") }),
    ], null)
    expect(day?.next).toEqual({ name: "Аптека c", plannedTime: at("14:30").toISOString() })
  })

  it("calls a doctor's stop by the doctor, as the agent's own day does", () => {
    const day = teamRouteDay([point({ id: "a", orderIndex: 0, contact: { displayName: "Др. Алиева" } })], null)
    expect(day?.next?.name).toBe("Др. Алиева")
  })

  it("says whom he is with now, and does not call that stop «next»", () => {
    const day = teamRouteDay([
      point({ id: "a", orderIndex: 0 }),
      point({ id: "b", orderIndex: 1 }),
    ], { checkInAt: at("11:02"), routePointId: "a", customer: { name: "Аптека a" }, contact: null })
    expect(day?.visiting).toEqual({ name: "Аптека a", since: at("11:02").toISOString() })
    expect(day?.next?.name).toBe("Аптека b")
  })

  it("has nothing to say with no route and no visit, and leaves out what is unknown", () => {
    expect(teamRouteDay([], null)).toBeNull()
    const day = teamRouteDay([point({ id: "a", orderIndex: 0, status: "VISITED", visitedAt: at("09:10") })], null)
    expect(day).toEqual({ first: { name: "Аптека a", at: at("09:10").toISOString() }, next: null, visiting: null })
  })
})
