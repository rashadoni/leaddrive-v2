import { describe, expect, it } from "vitest"
import {
  agentActivityLocale,
  agentActivityPush,
  agentRouteNotice,
  agentVisitNotice,
} from "@/lib/mtm/agent-activity-notice"

const DAY = new Date("2026-11-24T00:00:00.000Z")

describe("what a manager reads about his agent", () => {
  it("names the doctor with his clinic and counts in Russian", () => {
    const words = agentRouteNotice({
      locale: "ru",
      event: "agent_route_published",
      agentName: "Aqil",
      routeDate: DAY,
      stops: [
        { customerName: "Klinika 1", contactName: "Dr. Əliyev" },
        { customerName: "Klinika 2" },
        { customerName: "Klinika 3" },
        { customerName: "Klinika 4" },
        { customerName: "Klinika 5" },
      ],
    })
    expect(words.title).toBe("Aqil: новый маршрут на 24 ноября")
    expect(words.body).toBe("5 визитов: Dr. Əliyev (Klinika 1); Klinika 2; Klinika 3; Klinika 4; Klinika 5")
    expect(words.pushBody).toBe("5 визитов. Список в приложении.")
  })

  it("keeps a very long route readable", () => {
    const stops = Array.from({ length: 23 }, (_, index) => ({ customerName: `K${index + 1}` }))
    const words = agentRouteNotice({ locale: "az", event: "agent_route_published", agentName: "Aqil", routeDate: DAY, stops })
    expect(words.body.startsWith("23 vizit: K1; K2;")).toBe(true)
    expect(words.body.endsWith("K20; və daha 3")).toBe(true)
  })

  it("says the order changed when no client did", () => {
    const words = agentRouteNotice({
      locale: "en",
      event: "agent_route_updated",
      agentName: "Aqil",
      routeDate: DAY,
      stops: [{ customerName: "B" }, { customerName: "A" }],
    })
    expect(words.body).toBe("Now 2 visits, order or time changed: B; A")
  })

  it("writes a visit in the company's time, with the distance and who was next", () => {
    const words = agentVisitNotice({
      locale: "az",
      event: "agent_visit_out_of_order",
      agentName: "Kənan",
      stop: { customerName: "Klinika 3", contactName: "Dr. Həsənova" },
      address: "  Nizami   3 ",
      at: new Date("2026-11-23T10:32:00.000Z"),
      timezone: "Asia/Baku",
      distanceMeters: 449.6,
      expectedStop: { customerName: "Klinika 2" },
    })
    expect(words.title).toBe("Kənan: növbədən kənar vizit")
    expect(words.body).toBe("Dr. Həsənova (Klinika 3) · Nizami 3 · 14:32 · müştəridən 450 m. Növbədə idi: Klinika 2")
    expect(words.pushBody).toBe("Saat 14:32. Təfərrüat tətbiqdədir.")
    expect(words.pushBody).not.toContain("Klinika")
  })

  it("pushes only its own notices", () => {
    expect(agentActivityPush("T", { event: "agent_visit_off_route", pushBody: "B" }))
      .toEqual({ title: "T", body: "B", event: "agent_visit_off_route" })
    expect(agentActivityPush("T", { event: "route_published", pushBody: "B" })).toBeNull()
    expect(agentActivityPush("T", { event: "agent_visit_off_route" })).toBeNull()
    expect(agentActivityPush("T", null)).toBeNull()
  })

  it("falls back to Azerbaijani", () => {
    expect(agentActivityLocale("ru")).toBe("ru")
    expect(agentActivityLocale(null)).toBe("az")
    expect(agentActivityLocale("de")).toBe("az")
  })
})
