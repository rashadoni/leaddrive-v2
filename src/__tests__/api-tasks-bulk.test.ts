import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

// ──────────────────────────────────────────────────────────────────────────────
// Mock setup — mirrors api-tasks.test.ts pattern. Bulk endpoint uses
// prisma.task.updateMany / deleteMany / prisma.customField.findFirst +
// prisma.$executeRaw (for JSONB merge in update_custom_field).
// ──────────────────────────────────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    task: {
      // findMany snapshots affected id+status+projectId before status/delete
      // actions (rollup recalc + §5.7 status_changed activity emission).
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    taskActivity: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    customField: { findFirst: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
  }
  // $transaction invokes the interactive callback with the mock itself as tx.
  prisma.$transaction = vi.fn((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve(arg),
  )
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/project-rollup", () => ({
  recalcProjectCompletion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
  getOrgId: vi.fn(),
}))

import { POST } from "@/app/api/v1/tasks/bulk/route"
import { prisma } from "@/lib/prisma"
import { requireAuth, isAuthError } from "@/lib/api-auth"
import { recalcProjectCompletion } from "@/lib/project-rollup"

const prismaMock = prisma as typeof prisma & {
  customField: { findFirst: ReturnType<typeof vi.fn> }
  $executeRaw: ReturnType<typeof vi.fn>
}

function makeRequest(body: any) {
  return new Request("http://localhost/api/v1/tasks/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
  vi.mocked(isAuthError).mockReturnValue(false)
})

// ─── action: complete ──────────────────────────────────────────────────────
describe("POST /api/v1/tasks/bulk → action: complete", () => {
  it("updates all selected tasks to status=completed with completedAt timestamp", async () => {
    const res = await POST(makeRequest({ ids: ["t1", "t2", "t3"], action: "complete" }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.affected).toBe(3)

    // updateMany called with correct WHERE + status + completedAt
    expect(prisma.task.updateMany).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.task.updateMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["t1", "t2", "t3"] }, organizationId: "org-1" })
    expect(call.data.status).toBe("completed")
    expect(call.data.completedAt).toBeInstanceOf(Date)
  })
})

// ─── §5.7: bulk status moves must emit status_changed activity ──────────────
describe("POST /api/v1/tasks/bulk → status_changed activity (flow history)", () => {
  it("emits status_changed for bulk-completed tasks whose status actually changed", async () => {
    vi.mocked(prismaMock.task.findMany).mockResolvedValue([
      { id: "t1", status: "in_progress", projectId: null },
      { id: "t2", status: "completed", projectId: null }, // already done → no activity row
    ] as any)
    const res = await POST(makeRequest({ ids: ["t1", "t2"], action: "complete" }))
    expect(res.status).toBe(200)
    const acts = (vi.mocked(prismaMock.taskActivity.createMany).mock.calls[0][0] as any).data
    expect(acts).toEqual([
      { organizationId: "org-1", taskId: "t1", userId: "u-1", action: "status_changed", oldValue: "in_progress", newValue: "completed" },
    ])
  })

  it("emits status_changed on bulk update_status", async () => {
    vi.mocked(prismaMock.task.findMany).mockResolvedValue([
      { id: "t1", status: "pending", projectId: null },
    ] as any)
    const res = await POST(makeRequest({ ids: ["t1"], action: "update_status", value: "in_progress" }))
    expect(res.status).toBe(200)
    const acts = (vi.mocked(prismaMock.taskActivity.createMany).mock.calls[0][0] as any).data
    expect(acts).toEqual([
      { organizationId: "org-1", taskId: "t1", userId: "u-1", action: "status_changed", oldValue: "pending", newValue: "in_progress" },
    ])
  })

  it("writes NO activity when no selected task's status actually changed", async () => {
    vi.mocked(prismaMock.task.findMany).mockResolvedValue([
      { id: "t1", status: "completed", projectId: null },
    ] as any)
    const res = await POST(makeRequest({ ids: ["t1"], action: "complete" }))
    expect(res.status).toBe(200)
    expect(prismaMock.taskActivity.createMany).not.toHaveBeenCalled()
  })
})

// ─── action: delete — separate permission re-check ──────────────────────
describe("POST /api/v1/tasks/bulk → action: delete", () => {
  it("re-checks tasks:delete permission separately and returns auth error if denied", async () => {
    // First requireAuth (for the endpoint entry, tasks:write) succeeds.
    // Second requireAuth (for the delete branch, tasks:delete) returns 403.
    // This guards against a refactor accidentally dropping the second check —
    // which would silently let any tasks:write user delete records.
    // Route now does ONE requireAuth (via withRlsAuth "tasks","write") + an inline
    // checkPermission(auth.role,"tasks","delete") for the delete branch. A role with
    // tasks:write but NOT tasks:delete ("sales") must be rejected with 403 — the real
    // checkPermission runs (permissions lib is not mocked). NOTE: requireAuth is mocked
    // (returns the role), so the OUTER write-gate is mocked-through here; this test
    // exercises only the inline delete-gate.
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "sales" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)

    const res = await POST(makeRequest({ ids: ["t1"], action: "delete" }))

    expect(res.status).toBe(403)
    // deleteMany must NOT have fired
    expect(prisma.task.deleteMany).not.toHaveBeenCalled()
  })

  it("deletes selected tasks when delete permission is granted", async () => {
    // Both auth checks pass
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
    const res = await POST(makeRequest({ ids: ["t1", "t2"], action: "delete" }))
    expect(res.status).toBe(200)
    expect(prisma.task.deleteMany).toHaveBeenCalledOnce()
    const call = vi.mocked(prisma.task.deleteMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: { in: ["t1", "t2"] }, organizationId: "org-1" })
  })
})

// ─── action: update_status validation ─────────────────────────────────────
describe("POST /api/v1/tasks/bulk → action: update_status", () => {
  it("returns 400 for invalid status value", async () => {
    const res = await POST(makeRequest({ ids: ["t1"], action: "update_status", value: "bogus" }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Invalid status")
    expect(prisma.task.updateMany).not.toHaveBeenCalled()
  })

  it("returns 400 for missing value", async () => {
    const res = await POST(makeRequest({ ids: ["t1"], action: "update_status" }))
    expect(res.status).toBe(400)
  })
})

// ─── action: update_custom_field (Roadmap #8 + #9) ────────────────────────
describe("POST /api/v1/tasks/bulk → action: update_custom_field", () => {
  it("returns 400 when fieldName is missing", async () => {
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field", fieldValue: "Successful",
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("fieldName is required")
  })

  it("returns 404 when custom field def does not exist for this org", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field",
      fieldName: "nonexistent", fieldValue: "x",
    }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toContain("nonexistent")
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it("returns 400 when select-type value is not in def.options", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-1", fieldName: "outcome", fieldLabel: "Outcome",
      fieldType: "select", options: ["Successful", "Lost"], isRequired: false,
    })
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field",
      fieldName: "outcome", fieldValue: "Maybe",
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("not in the allowed options")
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it("returns 400 when boolean field receives non-boolean value", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-2", fieldName: "flag", fieldLabel: "Flag",
      fieldType: "boolean", options: [], isRequired: false,
    })
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field",
      fieldName: "flag", fieldValue: "yes",
    }))
    expect(res.status).toBe(400)
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it("returns 400 when number field receives non-number value", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-3", fieldName: "minutes", fieldLabel: "Minutes",
      fieldType: "number", options: [], isRequired: false,
    })
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field",
      fieldName: "minutes", fieldValue: "ten",
    }))
    expect(res.status).toBe(400)
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it("returns 400 when trying to CLEAR a required custom field (null value)", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-4", fieldName: "sprint", fieldLabel: "Sprint",
      fieldType: "select", options: ["S1", "S2"], isRequired: true,
    })
    const res = await POST(makeRequest({
      ids: ["t1", "t2"], action: "update_custom_field",
      fieldName: "sprint", fieldValue: null,
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Sprint")
    expect(body.error).toContain("required")
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
  })

  it("accepts valid select value and uses JSONB CONCAT (||) for merge", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-5", fieldName: "outcome", fieldLabel: "Outcome",
      fieldType: "select", options: ["Successful", "Lost"], isRequired: false,
    })
    const res = await POST(makeRequest({
      ids: ["t1", "t2"], action: "update_custom_field",
      fieldName: "outcome", fieldValue: "Successful",
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.affected).toBe(2)
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce()

    // Assert the SQL template used the JSONB CONCAT operator (||) — not
    // delete (-) or anything else. Guards against a refactor accidentally
    // swapping the two code paths.
    const args = prismaMock.$executeRaw.mock.calls[0]
    const sqlParts = args[0] as unknown as ArrayLike<string>
    const fullSql = Array.from(sqlParts).join("?")
    expect(fullSql).toMatch(/\|\|/)
    expect(fullSql).not.toMatch(/SET\s+"customFields"\s+=\s+COALESCE\("customFields",\s*'\{\}'::jsonb\)\s+-\s/)
  })

  it("null value on NON-required field uses JSONB MINUS (-) to clear key", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      id: "cf-6", fieldName: "tag", fieldLabel: "Tag",
      fieldType: "select", options: ["a", "b"], isRequired: false,
    })
    const res = await POST(makeRequest({
      ids: ["t1"], action: "update_custom_field",
      fieldName: "tag", fieldValue: null,
    }))
    expect(res.status).toBe(200)
    expect(prismaMock.$executeRaw).toHaveBeenCalledOnce()

    // Assert the SQL used the JSONB MINUS operator (-) for key delete,
    // NOT the merge (||) path.
    const args = prismaMock.$executeRaw.mock.calls[0]
    const sqlParts = args[0] as unknown as ArrayLike<string>
    const fullSql = Array.from(sqlParts).join("?")
    expect(fullSql).toMatch(/SET\s+"customFields"\s+=\s+COALESCE\("customFields",\s*'\{\}'::jsonb\)\s+-\s/)
    expect(fullSql).not.toMatch(/\|\|/)
  })
})

// ─── action: project rollup integration ───────────────────────────────────
describe("POST /api/v1/tasks/bulk → project rollup", () => {
  it("triggers recalc for every project whose tasks were completed", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([
      { projectId: "proj-a" }, { projectId: "proj-b" }, { projectId: "proj-a" },
      { projectId: null }, // tasks without a project don't contribute
    ] as any)

    const res = await POST(makeRequest({ ids: ["t1", "t2", "t3", "t4"], action: "complete" }))
    expect(res.status).toBe(200)

    // Each unique projectId should be recalc'd exactly once
    await Promise.resolve()
    const calledProjects = new Set(vi.mocked(recalcProjectCompletion).mock.calls.map((c) => c[0]))
    expect(calledProjects).toEqual(new Set(["proj-a", "proj-b"]))
  })

  it("triggers recalc for affected projects after bulk delete", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValueOnce([
      { projectId: "proj-1" },
    ] as any)
    // Re-mock requireAuth so the second internal check (tasks:delete) also passes
    vi.mocked(requireAuth)
      .mockResolvedValueOnce({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
      .mockResolvedValueOnce({ orgId: "org-1", userId: "u-1", role: "admin" } as any)

    const res = await POST(makeRequest({ ids: ["t1"], action: "delete" }))
    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(recalcProjectCompletion).toHaveBeenCalledWith("proj-1", "org-1")
  })

  it("does NOT snapshot projectIds for update_custom_field (no rollup impact)", async () => {
    prismaMock.customField.findFirst.mockResolvedValueOnce({
      organizationId: "org-1", entityType: "task", fieldName: "tag",
      fieldType: "text", isActive: true, isRequired: false,
    } as any)

    const res = await POST(
      makeRequest({ ids: ["t1"], action: "update_custom_field", fieldName: "tag", fieldValue: "ops" })
    )
    expect(res.status).toBe(200)
    // findMany must not be called for non-rollup actions — it's a wasted query
    expect(prisma.task.findMany).not.toHaveBeenCalled()
    expect(recalcProjectCompletion).not.toHaveBeenCalled()
  })
})
