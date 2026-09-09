import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    division: { findFirst: vi.fn(), findMany: vi.fn() },
    boardPermission: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    boardColumn: { findMany: vi.fn() },
    taskActivity: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { GET } from "@/app/api/v1/divisions/[id]/analytics/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const ADMIN = { orgId: "org-1", userId: "u-admin", role: "admin", email: "", name: "" }
const SALES = { orgId: "org-1", userId: "u-sales", role: "sales", email: "", name: "" }
const req = (url: string) => new Request(url) as any
const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => vi.clearAllMocks())

describe("GET /api/v1/divisions/[id]/analytics", () => {
  it("admin → 200 with the analytics bundle", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "t1", taskKey: "D-1", title: "x", status: "in_progress", boardColumnKey: null, type: "bug", dueDate: null, completedAt: null, createdAt: new Date(), assignedTo: null, estimatedHours: null, assignee: null },
    ] as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValue([
      { key: "in_progress", label: "IN PROGRESS", mapsToStatus: "in_progress", color: null },
    ] as any)
    const res = await GET(req("http://localhost/api/v1/divisions/d1/analytics?range=30d"), params("d1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.totals.totalTasks).toBe(1)
    expect(body.data.totals.wip).toBe(1)
    expect(body.data.wip[0].key).toBe("in_progress")
    // Value rollup rides the always-on base bundle (no ?flow=1 needed)
    expect(body.data.valueRollup.openCount).toBe(1)
    expect(body.data.valueRollup.byLane.find((l: { key: string; count: number }) => l.key === "in_progress")?.count).toBe(1)
    // Burnup rides the same always-on base bundle
    expect(body.data.burnup.total).toBe(1)
    expect(Array.isArray(body.data.burnup.points)).toBe(true)
    expect(body.data.burnup.points.at(-1)).toMatchObject({ scope: 1, done: 0 }) // 1 open task, none done
    // Monte-Carlo too: 1 open task, no completions ⇒ not enough throughput to forecast
    expect(body.data.monteCarlo).toMatchObject({ remaining: 1, throughputTotal: 0, sufficient: false })
  })

  it("?flow=1 adds Tier-2 flow metrics + fetches status_changed activity", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "t1", taskKey: "D-1", title: "x", status: "done", boardColumnKey: null, type: "task", dueDate: null, completedAt: new Date(), createdAt: new Date(Date.now() - 5 * 86_400_000), assignedTo: null, estimatedHours: null, assignee: null },
    ] as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.taskActivity.findMany).mockResolvedValue([] as any)
    const res = await GET(req("http://localhost/api/v1/divisions/d1/analytics?flow=1"), params("d1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.flow.leadTime).toHaveProperty("count", 1)
    expect(body.data.flow.cycleTime).toHaveProperty("coveredOf")
    expect(body.data.flow.aging).toHaveProperty("tasks")
    expect(body.data.flow.timeInStatus).toHaveProperty("stages")
    // CFD rides the same flow=1 opt-in + activity fetch
    expect(body.data.cfd).toMatchObject({ coveredOf: 0, total: 1 }) // task has no status history
    expect(Array.isArray(body.data.cfd.points)).toBe(true)
    expect(body.data.cfd.points[0]).toHaveProperty("done")
    // Reopened/rework rides the same opt-in
    expect(body.data.reopened).toMatchObject({ reopenEvents: 0, reopenedTasks: 0, total: 1 })
    expect(Array.isArray(body.data.reopened.topReopened)).toBe(true)
    // SLA rides the opt-in; no per-board target set ⇒ global default 5, board-default flag true
    expect(body.data.sla).toMatchObject({ targetDays: 5, measuredCount: 0, metCount: 0, pct: 0, coveredOf: 1, isBoardDefault: true })
    // the activity fetch is org-scoped + status_changed only
    const where = (vi.mocked(prisma.taskActivity.findMany).mock.calls[0][0] as any).where
    expect(where).toMatchObject({ organizationId: "org-1", action: "status_changed" })
  })

  it("WITHOUT ?flow=1: no flow field + no TaskActivity fetch (Tier-1 stays cheap)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValue([] as any)
    const res = await GET(req("http://localhost/api/v1/divisions/d1/analytics"), params("d1"))
    expect(res.status).toBe(200)
    expect((await res.json()).data.flow).toBeUndefined()
    expect(prisma.taskActivity.findMany).not.toHaveBeenCalled()
  })

  it("cross-org / missing division → 404 (no leak)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue(null)
    const res = await GET(req("http://localhost/api/v1/divisions/x/analytics"), params("x"))
    expect(res.status).toBe(404)
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("non-admin without board access → 404", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([] as any) // no canView grants
    vi.mocked(prisma.division.findMany).mockResolvedValue([] as any) // heads nothing
    const res = await GET(req("http://localhost/api/v1/divisions/d1/analytics"), params("d1"))
    expect(res.status).toBe(404)
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("non-admin WITH a canView grant → 200", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([{ divisionId: "d1", canView: true }] as any)
    vi.mocked(prisma.division.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValue([] as any)
    const res = await GET(req("http://localhost/api/v1/divisions/d1/analytics"), params("d1"))
    expect(res.status).toBe(200)
  })

  it("assignee + type filters flow into the org+division-scoped task query", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "d1" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.boardColumn.findMany).mockResolvedValue([] as any)
    await GET(req("http://localhost/api/v1/divisions/d1/analytics?assignee=bob&type=bug"), params("d1"))
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    // a normal (non-department) board now aggregates over the single-id set [id]
    expect(where).toMatchObject({ organizationId: "org-1", divisionId: { in: ["d1"] }, deletedAt: null, assignedTo: "bob", type: "bug" })
  })

  it("department → aggregates tasks across its child sections with canonical columns", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "DEPT", isDepartment: true, slaTargetDays: null } as any)
    // getDepartmentSectionIds → active children
    vi.mocked(prisma.division.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "t1", taskKey: "S1-1", title: "a", status: "todo", boardColumnKey: null, type: "task", dueDate: null, completedAt: null, createdAt: new Date(), assignedTo: null, estimatedHours: null, estimatedPrice: null, assignee: null },
      { id: "t2", taskKey: "S2-1", title: "b", status: "in_progress", boardColumnKey: null, type: "task", dueDate: null, completedAt: null, createdAt: new Date(), assignedTo: null, estimatedHours: null, estimatedPrice: null, assignee: null },
    ] as any)
    const res = await GET(req("http://localhost/api/v1/divisions/DEPT/analytics?range=30d"), params("DEPT"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.totals.totalTasks).toBe(2)
    // task query scoped to the child sections, not the department id
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    expect(where.divisionId).toEqual({ in: ["s1", "s2"] })
    // a department uses canonical columns → its own boardColumn.findMany is never called
    expect(prisma.boardColumn.findMany).not.toHaveBeenCalled()
  })

  it("department ?sections= narrows the aggregate to the selected sections", async () => {
    vi.mocked(requireAuth).mockResolvedValue(ADMIN as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "DEPT", isDepartment: true, slaTargetDays: null } as any)
    vi.mocked(prisma.division.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    await GET(req("http://localhost/api/v1/divisions/DEPT/analytics?sections=s2"), params("DEPT"))
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    expect(where.divisionId).toEqual({ in: ["s2"] })
  })

  it("department with no visible sections → 404 for a non-member", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SALES as any)
    vi.mocked(prisma.division.findFirst).mockResolvedValue({ id: "DEPT", isDepartment: true, slaTargetDays: null } as any)
    // sales user: no board permissions, heads nothing → accessible = []
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([] as any)
    // getAccessibleDivisionIds headship query + getDepartmentSectionIds both hit division.findMany;
    // headship → [], and children query returns sections the user can't see
    vi.mocked(prisma.division.findMany).mockImplementation(async (args: any) =>
      args?.where?.parentDivisionId ? [{ id: "s1" }] : [],
    )
    const res = await GET(req("http://localhost/api/v1/divisions/DEPT/analytics"), params("DEPT"))
    expect(res.status).toBe(404)
  })
})
