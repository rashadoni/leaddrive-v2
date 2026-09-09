import { describe, it, expect, beforeEach, vi } from "vitest"

vi.mock("@/lib/prisma", () => {
  const prisma: any = { task: { findMany: vi.fn() }, taskType: { findMany: vi.fn() }, eventType: { findMany: vi.fn() } }
  return { prisma, logAudit: vi.fn() }
})
vi.mock("@/lib/api-auth", () => ({ getSession: vi.fn(), getOrgId: vi.fn() }))
vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((row: any) => row),
}))
vi.mock("@/lib/tasks/list-query", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/tasks/list-query")>()
  return { ...actual, buildTaskListWhere: vi.fn() }
})

import { GET } from "@/app/api/v1/tasks/report/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId } from "@/lib/api-auth"
import { buildTaskListWhere } from "@/lib/tasks/list-query"

const SESSION = { orgId: "org-1", userId: "u1", role: "admin", email: "", name: "" }
const req = (qs = "") => new Request(`http://x/api/v1/tasks/report${qs}`) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as any)
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  vi.mocked(buildTaskListWhere).mockResolvedValue({ where: {}, blocked: false })
  vi.mocked(prisma.taskType.findMany).mockResolvedValue([{ name: "seo", displayName: "SEO" }])
  vi.mocked(prisma.eventType.findMany).mockResolvedValue([{ name: "914_line", displayName: "914 LINE" }])
  vi.mocked(prisma.task.findMany).mockResolvedValue([
    { type: "seo", status: "done", assignee: { name: "Alice" }, project: null, division: { name: "Marketing", key: "MKT" } },
    { type: "seo", status: "todo", assignee: { name: "Bob" }, project: null, division: { name: "Marketing", key: "MKT" } },
  ])
})

describe("GET /api/v1/tasks/report", () => {
  it("401 without org", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any)
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    expect((await GET(req())).status).toBe(401)
  })

  it("aggregates by division with bucket split + totals", async () => {
    const res = await GET(req("?groupBy=division"))
    const j = await res.json()
    expect(j.success).toBe(true)
    expect(j.data.groupBy).toBe("division")
    expect(j.data.groupLabel).toBe("Board / Department")
    expect(j.data.rows).toHaveLength(1)
    expect(j.data.rows[0]).toMatchObject({ group: "Marketing", total: 2, planned: 1, completed: 1 })
    expect(j.data.totals).toMatchObject({ total: 2 })
  })

  it("resolves the type label when grouping by type", async () => {
    const res = await GET(req("?groupBy=type"))
    const j = await res.json()
    expect(j.data.rows[0].group).toBe("SEO")
  })

  it("resolves the event-type label when grouping by eventType", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { type: "seo", eventType: "914_line", status: "done", assignee: null, project: null, division: { name: "M", key: "M" } },
      { type: "seo", eventType: "914_line", status: "todo", assignee: null, project: null, division: { name: "M", key: "M" } },
      { type: "seo", eventType: null, status: "todo", assignee: null, project: null, division: { name: "M", key: "M" } },
    ])
    const res = await GET(req("?groupBy=eventType"))
    const j = await res.json()
    expect(j.data.groupBy).toBe("eventType")
    expect(j.data.groupLabel).toBe("Event type")
    expect(j.data.rows.find((r: any) => r.group === "914 LINE")).toMatchObject({ total: 2 })
    expect(j.data.rows.find((r: any) => r.group === "— (no event type)")).toMatchObject({ total: 1 })
  })

  it("defaults an invalid groupBy to division", async () => {
    const res = await GET(req("?groupBy=nonsense"))
    const j = await res.json()
    expect(j.data.groupBy).toBe("division")
  })

  it("returns a monthly pivot in timeline mode", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { type: "seo", status: "done", completedAt: new Date("2026-06-10"), assignee: { name: "Alice" }, project: null, division: { name: "Marketing", key: "MKT" } },
      { type: "seo", status: "done", completedAt: new Date("2026-05-02"), assignee: { name: "Alice" }, project: null, division: { name: "Marketing", key: "MKT" } },
    ])
    const res = await GET(req("?groupBy=assignee&mode=timeline"))
    const j = await res.json()
    expect(j.data.mode).toBe("timeline")
    expect(j.data.periods).toEqual(["2026-05", "2026-06"])
    expect(j.data.rows[0]).toMatchObject({ group: "Alice", total: 2, byPeriod: [1, 1] })
    expect(j.data.totalsByPeriod).toEqual([1, 1])
  })

  it("blocked access → empty rows, no task query", async () => {
    vi.mocked(buildTaskListWhere).mockResolvedValue({ where: {}, blocked: true })
    const res = await GET(req("?divisionId=other"))
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(j.data.rows).toHaveLength(0)
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })
})
