import { describe, it, expect, vi } from "vitest"

// Mock buildTaskListWhere's collaborators so the board-isolation gate can be
// unit-tested directly (prisma is never queried on the blocked path; the gate
// returns before any findMany).
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(async (_org: string, _user: string, _role: string, _entity: string, where: unknown) => where),
}))
vi.mock("@/lib/tasks/board-access", () => ({ getAccessibleDivisionIds: vi.fn() }))

import { parseTaskListFilters, statusBucket, statusBucketLabel, buildTaskListWhere } from "@/lib/tasks/list-query"
import { getAccessibleDivisionIds } from "@/lib/tasks/board-access"

describe("parseTaskListFilters", () => {
  it("reads createdBy and the assigneeId/assignedTo alias", () => {
    const f = parseTaskListFilters(new URLSearchParams("assigneeId=u1&createdBy=u2"))
    expect(f.assignedTo).toBe("u1")
    expect(f.createdBy).toBe("u2")
  })

  it("falls back to legacy assignedTo when assigneeId is absent", () => {
    const f = parseTaskListFilters(new URLSearchParams("assignedTo=u9"))
    expect(f.assignedTo).toBe("u9")
  })

  it("splits a comma status list and trims", () => {
    const f = parseTaskListFilters(new URLSearchParams("status=todo, in_progress ,done"))
    expect(f.statusParts).toEqual(["todo", "in_progress", "done"])
  })

  it("parses valid date bounds and ignores malformed ones", () => {
    const f = parseTaskListFilters(new URLSearchParams("createdAfter=2026-01-01&completedBefore=nope"))
    expect(f.createdRange?.gte instanceof Date).toBe(true)
    expect(f.completedRange).toBeNull()
  })

  it("reads the eventType (channel) filter, defaulting to empty", () => {
    expect(parseTaskListFilters(new URLSearchParams("eventType=social_media")).eventType).toBe("social_media")
    expect(parseTaskListFilters(new URLSearchParams()).eventType).toBe("")
  })

  it("reads the custom-field pair (cfKey/cfValue) — the Brand report filter", () => {
    const f = parseTaskListFilters(new URLSearchParams("cfKey=brand&cfValue=Pepsi"))
    expect(f.cfKey).toBe("brand")
    expect(f.cfValue).toBe("Pepsi")
  })
})

describe("buildTaskListWhere — custom-field (Brand) filter", () => {
  it("applies a JSON path equality when BOTH cfKey and cfValue are set", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue("all")
    const f = parseTaskListFilters(new URLSearchParams("cfKey=brand&cfValue=Pepsi"))
    const { where } = await buildTaskListWhere("org1", "u1", "admin", f)
    expect(where.customFields).toEqual({ path: ["brand"], equals: "Pepsi" })
  })

  it("ignores a dangling cfKey without a value (no filter, no crash)", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue("all")
    const f = parseTaskListFilters(new URLSearchParams("cfKey=brand"))
    const { where } = await buildTaskListWhere("org1", "u1", "admin", f)
    expect(where.customFields).toBeUndefined()
  })
})

describe("statusBucket", () => {
  it("maps planned / ongoing / completed", () => {
    expect(statusBucket("backlog")).toBe("planned")
    expect(statusBucket("todo")).toBe("planned")
    expect(statusBucket("pending")).toBe("planned")
    expect(statusBucket("in_progress")).toBe("ongoing")
    expect(statusBucket("testing")).toBe("ongoing")
    expect(statusBucket("review")).toBe("ongoing")
    expect(statusBucket("done")).toBe("completed")
    expect(statusBucket("completed")).toBe("completed")
  })

  it("keeps cancelled as its own bucket (NOT folded into completed)", () => {
    expect(statusBucket("cancelled")).toBe("cancelled")
    expect(statusBucketLabel("cancelled")).toBe("Cancelled")
  })

  it("labels are title-cased", () => {
    expect(statusBucketLabel("in_progress")).toBe("Ongoing")
    expect(statusBucketLabel("done")).toBe("Completed")
  })
})

// Board isolation — the load-bearing invariant behind the per-board operational
// report: a report locked to board X must NEVER aggregate another board's tasks,
// and a divisionId the caller can't access must fail safe (empty), not leak.
describe("buildTaskListWhere — board isolation (per-board report safety)", () => {
  it("BLOCKS a divisionId the user cannot access (board A can't see board B)", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue(["div-A"])
    const f = parseTaskListFilters(new URLSearchParams("divisionId=div-B"))
    const { blocked } = await buildTaskListWhere("org1", "u1", "sales", f)
    expect(blocked).toBe(true)
  })

  it("does NOT block when the divisionId IS accessible, and root-scopes the where to it", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue(["div-A"])
    const f = parseTaskListFilters(new URLSearchParams("divisionId=div-A"))
    const { blocked, where } = await buildTaskListWhere("org1", "u1", "sales", f)
    expect(blocked).toBe(false)
    expect(where.divisionId).toBe("div-A")
  })

  it("admin (accessible='all') is still root-scoped to the requested board", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue("all")
    const f = parseTaskListFilters(new URLSearchParams("divisionId=div-B"))
    const { blocked, where } = await buildTaskListWhere("org1", "admin1", "admin", f)
    expect(blocked).toBe(false)
    expect(where.divisionId).toBe("div-B")
  })

  it("divisionId=__none__ (no-board tasks) is NOT gated even for a restricted role", async () => {
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue(["div-A"])
    const f = parseTaskListFilters(new URLSearchParams("divisionId=__none__"))
    const { blocked, where } = await buildTaskListWhere("org1", "u1", "sales", f)
    expect(blocked).toBe(false)
    expect(where.divisionId).toBeNull() // __none__ → tasks with no board
  })

  it("co-assignee grant lands in BOTH gates for a restricted role (sharing OR + boardScope OR)", async () => {
    // Restricted roles get a sharing-rules OR (own ∨ rule) AND-ed with the
    // boardScope OR; a collaborator-only task must satisfy both, so the
    // collaborators clause has to sit in each. Regression test for the
    // architect finding where it was only in boardScope and a sales-role
    // co-assignee couldn't see their own task.
    const { applyRecordFilter } = await import("@/lib/sharing-rules")
    vi.mocked(applyRecordFilter).mockImplementationOnce(async (_o: string, _u: string, _r: string, _e: string, where: any) => ({
      ...where,
      OR: [{ assignedTo: "u1" }, { createdBy: "u1" }],
    }))
    vi.mocked(getAccessibleDivisionIds).mockResolvedValue([])
    const f = parseTaskListFilters(new URLSearchParams())
    const { where } = await buildTaskListWhere("org1", "u1", "sales", f)
    const collabClause = { collaborators: { some: { userId: "u1" } } }
    expect(where.OR).toEqual(expect.arrayContaining([collabClause]))
    const boardScope = (where.AND as any[]).find((c) => Array.isArray(c.OR))
    expect(boardScope.OR).toEqual(expect.arrayContaining([collabClause]))
  })
})
