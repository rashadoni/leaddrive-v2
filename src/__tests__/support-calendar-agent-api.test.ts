import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const db = vi.hoisted(() => ({
  ticket: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  event: { findMany: vi.fn() },
  activity: { findMany: vi.fn() },
}))
vi.mock("@/lib/prisma", () => ({ prisma: db }))
vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: (req: NextRequest, auth: { orgId: string }) => Promise<Response>) =>
    (req: NextRequest) => handler(req, { orgId: "selected-organization" }),
}))

import { GET } from "@/app/api/v1/calendar/agent/route"

const ticket = (id: string, slaDueAt: Date | null, status = "open", closedAt: Date | null = null) => ({
  id, subject: "Synthetic " + id, status, priority: "medium", slaDueAt,
  createdAt: new Date("2026-09-01T09:00:00Z"), assignedTo: "selected-agent", closedAt,
})
const request = (from: string, to: string) => new NextRequest(`http://localhost/api/v1/calendar/agent?from=${from}&to=${to}`)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date("2026-10-02T12:00:00Z"))
  for (const source of Object.values(db)) source.findMany.mockReset().mockResolvedValue([])
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("agent calendar API ticket date scope", () => {
  it("honors explicit viewer-day offsets across UTC midnight", async () => {
    db.ticket.findMany.mockResolvedValue([
      ticket("inside", new Date("2026-10-04T20:30:00Z")),
      ticket("outside", new Date("2026-10-05T20:30:00Z")),
    ])
    const from = encodeURIComponent("2026-10-05T00:00:00+04:00")
    const to = encodeURIComponent("2026-10-05T23:59:59.999+04:00")
    const body = await (await GET(request(from, to))).json()
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["inside"])
    expect(body.data.items[0].dateKind).toBe("sla_due")
  })

  it("uses resolution time for resolved work and labels undated and creation fallbacks", async () => {
    db.ticket.findMany.mockResolvedValue([
      { ...ticket("resolved", null, "resolved"), resolvedAt: new Date("2026-10-01T10:00:00Z") },
      ticket("undated", null),
      { ...ticket("legacy", null, "closed"), createdAt: new Date("2026-10-03T11:00:00Z") },
    ])
    const body = await (await GET(request("2026-09-28", "2026-10-04"))).json()
    expect(body.data.items.map((item: { id: string; dateKind: string }) => [item.id, item.dateKind]))
      .toEqual([["resolved", "resolved"], ["undated", "undated_today"], ["legacy", "created"]])
  })

  it("rejects invalid or reversed ranges before querying sources", async () => {
    expect((await GET(request("invalid", "2026-10-04"))).status).toBe(400)
    expect((await GET(request("2026-10-05", "2026-10-04"))).status).toBe(400)
    expect(db.ticket.findMany).not.toHaveBeenCalled()
  })

  it("excludes dated open tickets outside the requested week from both items and counts", async () => {
    db.ticket.findMany.mockResolvedValue([
      ticket("past", new Date("2026-09-14T09:00:00Z")),
      ticket("current", new Date("2026-10-02T09:00:00Z")),
      ticket("future", new Date("2026-10-09T09:00:00Z")),
    ])
    const response = await GET(request("2026-09-28", "2026-10-04"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["current"])
    expect(body.data.counts).toEqual({ tickets: 1, tasks: 0, events: 0, activities: 0 })
    expect(body.data.items[0]).toMatchObject({ date: "2026-10-02T09:00:00.000Z", allDay: false })
    for (const source of Object.values(db)) expect(source.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "selected-organization" }) }))
  })

  it("shows a ticket on its future SLA date when today is outside that selected week", async () => {
    db.ticket.findMany.mockResolvedValue([
      ticket("current", new Date("2026-10-02T09:00:00Z")),
      ticket("future", new Date("2026-10-09T09:00:00Z")),
      ticket("undated", null),
    ])
    const response = await GET(request("2026-10-05", "2026-10-11"))
    const body = await response.json()
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["future"])
    expect(body.data.items[0]).toMatchObject({ date: "2026-10-09T09:00:00.000Z", allDay: false })
    expect(body.data.counts.tickets).toBe(1)
  })

  it("keeps undated open work on today and resolved work on its close date", async () => {
    db.ticket.findMany.mockResolvedValue([
      ticket("undated", null),
      ticket("resolved", new Date("2026-11-01T09:00:00Z"), "resolved", new Date("2026-10-01T10:00:00Z")),
      ticket("closed-outside", new Date("2026-10-02T09:00:00Z"), "closed", new Date("2026-09-14T10:00:00Z")),
    ])
    const response = await GET(request("2026-09-28", "2026-10-04"))
    const body = await response.json()
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["resolved", "undated"])
    expect(body.data.items[0]).toMatchObject({ date: "2026-10-01T10:00:00.000Z" })
    expect(body.data.items[1]).toMatchObject({ allDay: true, hour: -1 })
    expect(body.data.counts.tickets).toBe(2)
  })

  it("retains usable other sources when the ticket source fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    db.ticket.findMany.mockRejectedValue(new Error("Synthetic database failure"))
    db.task.findMany.mockResolvedValue([{
      id: "task", title: "Synthetic task", status: "open", priority: "medium",
      dueDate: new Date("2026-10-02T11:00:00Z"), createdAt: new Date("2026-09-01T09:00:00Z"), assignedTo: "selected-agent", completedAt: null,
    }])
    const response = await GET(request("2026-09-28", "2026-10-04"))
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.sources).toEqual({ tickets: "failed", tasks: "ok", events: "ok", activities: "ok" })
    expect(body.data.items.map((item: { id: string }) => item.id)).toEqual(["task"])
    expect(body.data.counts).toEqual({ tickets: 0, tasks: 1, events: 0, activities: 0 })
  })
})
