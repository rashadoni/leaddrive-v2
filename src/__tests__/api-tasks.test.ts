import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    socialMention: { updateMany: vi.fn() },
    company:  { findFirst: vi.fn() },
    contact:  { findFirst: vi.fn() },
    deal:     { findFirst: vi.fn() },
    lead:     { findFirst: vi.fn() },
    ticket:   { findFirst: vi.fn() },
    project:  { findFirst: vi.fn() },
    boardPermission: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    division: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    boardColumn: { findFirst: vi.fn() },
    taskActivity: { create: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    customField: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn() },
    // Dynamic task-type validation (isValidTaskType): empty list → falls back to
    // the legacy 5 names, so a POST with type "task" stays valid.
    taskType: { findMany: vi.fn().mockResolvedValue([]) },
    // Co-assignees: org-membership validation + replace-set rows.
    user: { count: vi.fn().mockResolvedValue(0) },
    taskCollaborator: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ max: 0 }]),
  }
  // PATCH now writes the status_changed activity inside a $transaction (§5.7);
  // the mock invokes the interactive callback with the mock itself as tx.
  prisma.$transaction = vi.fn((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.resolve(arg),
  )
  return { prisma, logAudit: vi.fn() }
})

// Mock the project rollup helper so we can assert it's been called without
// touching prisma.project.update / prisma.task.count / prisma.projectTask.count.
// The helper's own logic is tested in src/__tests__/lib-project-rollup.test.ts.
vi.mock("@/lib/recurrence/spawn", () => ({
  spawnNextRecurringTask: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/project-rollup", () => ({
  recalcProjectCompletion: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((result: any) => result instanceof NextResponse),
}))

vi.mock("@/lib/field-filter", () => ({
  getFieldPermissions: vi.fn().mockResolvedValue([]),
  filterEntityFields: vi.fn().mockImplementation((data: any) => data),
  filterWritableFields: vi.fn().mockImplementation((data: any) => data),
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn().mockImplementation((_o: any, _u: any, _r: any, _e: any, where: any) => where),
}))

vi.mock("@/lib/notifications", () => ({
  createNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/workflow-engine", () => ({
  executeWorkflows: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from "@/app/api/v1/tasks/route"
import { GET as GET_BY_ID, PATCH, DELETE } from "@/app/api/v1/tasks/[id]/route"
import { prisma } from "@/lib/prisma"
import { getSession, getOrgId, requireAuth, isAuthError } from "@/lib/api-auth"
import { createNotification } from "@/lib/notifications"
import { applyRecordFilter } from "@/lib/sharing-rules"
import { recalcProjectCompletion } from "@/lib/project-rollup"
import { spawnNextRecurringTask } from "@/lib/recurrence/spawn"

// Give TypeScript the extended prisma type in this test file
const prismaMock = prisma as typeof prisma & {
  company:  { findFirst: ReturnType<typeof vi.fn> }
  contact:  { findFirst: ReturnType<typeof vi.fn> }
  deal:     { findFirst: ReturnType<typeof vi.fn> }
  lead:     { findFirst: ReturnType<typeof vi.fn> }
  ticket:   { findFirst: ReturnType<typeof vi.fn> }
  project:  { findFirst: ReturnType<typeof vi.fn> }
  customField: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> }
  $executeRaw: ReturnType<typeof vi.fn>
}

const SESSION = { orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" }

function makeRequest(url: string, opts?: RequestInit) {
  return new Request(url, opts) as any
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: no required custom fields exist for this org. Tests for
  // Roadmap #9 validation override this with mockResolvedValueOnce.
  prismaMock.customField.findMany.mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// GET /api/v1/tasks
// ---------------------------------------------------------------------------
describe("GET /api/v1/tasks", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(getOrgId).mockResolvedValue(null as any)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks"))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe("Unauthorized")
  })

  it("returns 400 for invalid page (NaN)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?page=abc"))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid page or limit")
  })

  it("returns 400 for page < 1", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?page=0"))
    expect(res.status).toBe(400)
  })

  it("returns 400 for limit > 200", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?limit=201"))
    expect(res.status).toBe(400)
  })

  it("returns tasks with filters (assignedTo, status)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const mockTasks = [{ id: "t1", title: "Task 1", status: "pending", assignedTo: "user-1" }]
    vi.mocked(prisma.task.findMany).mockResolvedValue(mockTasks as any)
    vi.mocked(prisma.task.count).mockResolvedValue(1)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?assignedTo=user-1&status=pending"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.tasks).toHaveLength(1)
    expect(body.data.total).toBe(1)

    const findManyCall = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    expect(findManyCall.where.assignedTo).toBe("user-1")
    expect(findManyCall.where.status).toBe("pending")
  })

  it("admin is NOT division-scoped (no AND visibility clause) and excludes deleted", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any) // role: admin
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/tasks"))
    const call = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    expect(call.where.AND).toBeUndefined()
    expect(call.where.deletedAt).toBeNull()
    expect(prisma.boardPermission.findMany).not.toHaveBeenCalled()
  })

  it("ADDITIVELY widens the sharing-rules OR with accessible divisions (non-admin)", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...SESSION, role: "sales" } as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([
      { divisionId: "div-A", canView: true },
    ] as any)
    vi.mocked(prisma.division.findMany).mockResolvedValue([{ id: "div-B" }] as any)
    // Simulate real sharing-rules: a restricted role gets an own-records OR.
    vi.mocked(applyRecordFilter).mockImplementationOnce(
      (_o: any, u: any, _r: any, _e: any, where: any) => ({
        ...where,
        OR: [{ assignedTo: u }, { createdBy: u }],
      }),
    )
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/tasks"))
    const call = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    // Division access is OR-ed IN (additive) — not AND-ed (which would
    // over-restrict and hide board tasks the viewer isn't personally assigned).
    expect(call.where.OR).toContainEqual({ divisionId: { in: ["div-A", "div-B"] } })
    expect(call.where.OR).toContainEqual({ assignedTo: "user-1" })
    expect(call.where.OR).toContainEqual({ createdBy: "user-1" })
  })

  it("restricted role: search AND-narrows the division-visible set (no leak)", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...SESSION, role: "sales" } as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValue([
      { divisionId: "div-A", canView: true },
    ] as any)
    vi.mocked(prisma.division.findMany).mockResolvedValue([] as any)
    vi.mocked(applyRecordFilter).mockImplementationOnce(
      (_o: any, u: any, _r: any, _e: any, where: any) => ({
        ...where,
        OR: [{ assignedTo: u }, { createdBy: u }],
      }),
    )
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/tasks?search=foo"))
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    // search lives in AND (narrows): a division task whose title/key doesn't
    // match "foo" can never pass, so accessible-division access can't leak it.
    const searchClause = where.AND.find((c: any) => c.OR?.some((o: any) => o.title))
    expect(searchClause).toBeTruthy()
    // division visibility lives in OR, AND-combined with search at the top level.
    expect(where.OR).toContainEqual({ divisionId: { in: ["div-A"] } })
  })

  it("supports multi-status (comma) and search over title + taskKey", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    await GET(makeRequest("http://localhost/api/v1/tasks?status=todo,in_progress&search=KHS-5"))
    const call = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    expect(call.where.status).toEqual({ in: ["todo", "in_progress"] })
    const searchClause = call.where.AND.find((c: any) => c.OR?.some((o: any) => o.title))
    expect(searchClause.OR).toContainEqual({ title: { contains: "KHS-5", mode: "insensitive" } })
    expect(searchClause.OR).toContainEqual({ taskKey: { contains: "KHS-5", mode: "insensitive" } })
  })

  it("filters by projectId when ?projectId=<cuid> is provided", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?projectId=proj-1"))
    expect(res.status).toBe(200)

    const findManyCall = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    expect(findManyCall.where.projectId).toBe("proj-1")
  })

  it("filters by IS NULL when ?projectId=__none__ (orphan tasks)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks?projectId=__none__"))
    expect(res.status).toBe(200)

    const findManyCall = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    // Prisma uses `null` to mean IS NULL — must NOT be the literal string "__none__"
    expect(findManyCall.where.projectId).toBe(null)
  })

  it("omits projectId filter when not provided (default behaviour)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)

    const res = await GET(makeRequest("http://localhost/api/v1/tasks"))
    expect(res.status).toBe(200)

    const findManyCall = vi.mocked(prisma.task.findMany).mock.calls[0][0] as any
    expect("projectId" in findManyCall.where).toBe(false)
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findMany).mockRejectedValue(new Error("DB down"))

    const res = await GET(makeRequest("http://localhost/api/v1/tasks"))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.success).toBeUndefined()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// POST /api/v1/tasks
// ---------------------------------------------------------------------------
describe("POST /api/v1/tasks", () => {
  it("creates a task and returns 201", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "t-new", title: "New Task", status: "pending", priority: "medium", assignedTo: "user-1" }
    vi.mocked(prisma.task.create).mockResolvedValue(created as any)

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "New Task", assignedTo: "user-1" }),
    }))

    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("t-new")
  })

  // ── Board (division) creates ──
  it("board create: generates taskKey from the division prefix + logs activity", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any) // admin
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ id: "div-1", key: "KHS", headUserId: null } as any)
    vi.mocked(prismaMock.$queryRaw).mockResolvedValue([{ max: 54 }] as any)
    vi.mocked(prisma.task.create).mockImplementation(async ({ data }: any) => ({ id: "t1", ...data }))

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Pentest acme.az", divisionId: "div-1", type: "task" }),
    }))
    expect(res.status).toBe(201)
    const createArg = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(createArg.data.taskKey).toBe("KHS-55")
    expect(createArg.data.createdBy).toBe("user-1") // reporter = session user
    expect(createArg.data.divisionId).toBe("div-1")
    expect(prismaMock.taskActivity.create).toHaveBeenCalled()
  })

  it("board create: 403 when the user lacks create permission", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...SESSION, role: "sales" } as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ id: "div-1", key: "KHS", headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(null) // no grant, not head

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Blocked task", divisionId: "div-1" }),
    }))
    expect(res.status).toBe(403)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("board create: 403 when a non-head role creates directly in `done` (spec #3 gate)", async () => {
    vi.mocked(getSession).mockResolvedValue({ ...SESSION, role: "sales" } as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ id: "div-1", key: "KHS", headUserId: null } as any)
    // Has create rights but is NOT head/admin/manager → can't mint a `done` task.
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue({
      canView: true, canCreateTask: true, canEdit: false, canMoveToTodo: false,
      canMoveToInProgress: false, canMoveToTesting: false, canMoveToReview: false,
      canMoveBack: false, canComment: false,
    } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Sneaky done", divisionId: "div-1", status: "done" }),
    }))
    expect(res.status).toBe(403)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("board create: 400 when divisionId is not in the caller's org (Codex P0 cross-tenant)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue(null) // org-scoped query → not found

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Cross tenant", divisionId: "other-org-div" }),
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Division not found")
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("board create: retries taskKey on a P2002 unique race (capped)", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ id: "div-1", key: "KHS", headUserId: null } as any)
    vi.mocked(prismaMock.$queryRaw).mockResolvedValueOnce([{ max: 1 }]).mockResolvedValueOnce([{ max: 2 }])
    const p2002 = Object.assign(new Error("unique"), { code: "P2002", meta: { target: ["organizationId", "taskKey"] } })
    vi.mocked(prisma.task.create)
      .mockRejectedValueOnce(p2002 as any)
      .mockImplementationOnce(async ({ data }: any) => ({ id: "t2", ...data }))

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Race task", divisionId: "div-1" }),
    }))
    expect(res.status).toBe(201)
    expect(vi.mocked(prisma.task.create).mock.calls.length).toBe(2) // retried once after the P2002
  })

  it("validation: rejects estimatedPrice over 100,000,000", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Pricey task", estimatedPrice: 200_000_000 }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when title is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({}),
    }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })

  it("applies defaults: status=pending, priority=medium", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t1", title: "X", status: "pending", priority: "medium" } as any)

    await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "X" }),
    }))

    const createCall = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(createCall.data.status).toBe("pending")
    expect(createCall.data.priority).toBe("medium")
  })

  it("sends warning notification for urgent priority", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const created = { id: "t-urg", title: "Urgent!", status: "pending", priority: "urgent", assignedTo: "user-2" }
    vi.mocked(prisma.task.create).mockResolvedValue(created as any)

    await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Urgent!", priority: "urgent", assignedTo: "user-2" }),
    }))

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "warning",
        userId: "user-2",
      })
    )
  })

  it("returns 500 on DB error — bare {error} envelope, no success:false", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.create).mockRejectedValue(new Error("DB down"))

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "X" }),
    }))
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body.success).toBeUndefined()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// GET /api/v1/tasks/:id
// ---------------------------------------------------------------------------
describe("GET /api/v1/tasks/:id", () => {
  it("returns a task when found", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const task = { id: "t1", title: "Found", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(task as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t1"), makeParams("t1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.id).toBe("t1")
  })

  it("returns 404 when task not found", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/nope"), makeParams("nope"))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe("Not found")
  })

  it("requests recurrence relations (architect P2 — series UI contract)", async () => {
    // The series panel on /tasks/[id] depends on `recurrenceParent` +
    // `recurrenceChildren` being included in the GET response. A future
    // schema rename or include-drop would silently break the UI; this
    // pins the contract so the panel can trust the shape.
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", organizationId: "org-1",
      recurrenceRule: "weekly", recurrenceParentId: null,
      recurrenceChildren: [],
    } as any)

    await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t1"), makeParams("t1"))

    const call = vi.mocked(prisma.task.findFirst).mock.calls[0][0] as any
    expect(call.include).toMatchObject({
      recurrenceParent: { select: expect.any(Object) },
      recurrenceChildren: { select: expect.any(Object), orderBy: { dueDate: "asc" } },
    })
    // The parent select must include the bare fields the UI reads
    expect(call.include.recurrenceParent.select).toMatchObject({
      id: true, title: true, status: true, dueDate: true,
    })
  })

  it("relatedName is empty string when company belongs to different org", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const task = {
      id: "t1", title: "Task", organizationId: "org-1",
      relatedType: "company", relatedId: "company-from-org-2",
      checklist: [], comments: [],
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(task as any)
    // company.findFirst returns null → foreign org, access denied
    prismaMock.company.findFirst.mockResolvedValue(null)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t1"), makeParams("t1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    // relatedName must be empty — never leak foreign org entity name
    expect(body.data.relatedName).toBe("")
    // Verify the lookup was scoped to our org
    const companyCall = prismaMock.company.findFirst.mock.calls[0][0] as any
    expect(companyCall.where.organizationId).toBe("org-1")
    expect(companyCall.where.id).toBe("company-from-org-2")
  })

  it("relatedName is populated when entity belongs to same org", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const task = {
      id: "t1", title: "Task", organizationId: "org-1",
      relatedType: "deal", relatedId: "deal-1",
      checklist: [], comments: [],
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(task as any)
    prismaMock.deal.findFirst.mockResolvedValue({ title: "Big Deal" } as any)

    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t1"), makeParams("t1"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.relatedName).toBe("Big Deal")
  })
})

// ---------------------------------------------------------------------------
// PATCH /api/v1/tasks/:id
// ---------------------------------------------------------------------------
describe("PATCH /api/v1/tasks/:id", () => {
  it("returns auth error when requireAuth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ title: "X" }) }),
      makeParams("t1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when task not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ title: "X" }) }),
      makeParams("t1")
    )
    expect(res.status).toBe(404)
  })

  it("updates a task successfully", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Old", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    const updated = { id: "t1", title: "New Title", organizationId: "org-1" }
    vi.mocked(prisma.task.update).mockResolvedValue(updated as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "New Title" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.title).toBe("New Title")

    // Verify update was called with where: { id } (no orgId in update where)
    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0] as any
    expect(updateCall.where).toEqual({ id: "t1" })
  })

  it("does NOT block the update when an UNCHANGED relatedId points to a now-deleted entity", async () => {
    // Repro (2026-06-11): a task linked to a lead that was later deleted. The
    // edit dialog re-sends the same now-orphaned relatedId on every save; the
    // PATCH must not reject the WHOLE update over a stale link the user never
    // touched (was a hard 400 "Related entity not found").
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = {
      id: "t1", title: "T", status: "backlog", organizationId: "org-1",
      relatedType: "lead", relatedId: "dead-lead",
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null) // entity gone → resolveRelated → null
    vi.mocked(prisma.task.update).mockResolvedValue({ ...existing, category: "Q1" } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ category: "Q1", relatedType: "lead", relatedId: "dead-lead" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    // The unchanged link must NOT be re-validated — no entity lookup at all.
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
    expect(prisma.task.update).toHaveBeenCalled()
  })

  it("STILL 400s when a genuinely NEW relatedId points to a non-existent entity", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = {
      id: "t1", title: "T", status: "backlog", organizationId: "org-1",
      relatedType: null, relatedId: null,
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null) // new link target doesn't exist
    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: "lead", relatedId: "bogus-new" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(400)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("clears an orphaned link (relatedType/relatedId → null) without re-validating it", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = {
      id: "t1", title: "T", status: "backlog", organizationId: "org-1",
      relatedType: "lead", relatedId: "dead-lead",
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ ...existing, relatedType: null, relatedId: null } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: null, relatedId: null }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
  })

  it("validates a partial relatedId-only change against the EXISTING relatedType", async () => {
    // Edge (architect): body sends a new relatedId but no relatedType. The new id
    // must be validated against the task's existing relatedType — a new id can't
    // land under a mismatched/unchecked type.
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = {
      id: "t1", title: "T", status: "backlog", organizationId: "org-1",
      relatedType: "lead", relatedId: "old-lead",
    }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue(null) // the NEW id doesn't exist as a lead
    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedId: "new-missing" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(400)
    expect(prisma.lead.findFirst).toHaveBeenCalled()
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("sets completedAt when status=completed", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Task", status: "pending", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ ...existing, status: "completed" } as any)

    await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )

    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0] as any
    expect(updateCall.data.completedAt).toBeInstanceOf(Date)

    // Also creates a completion notification
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Task Completed",
      })
    )
  })

  // ── Board (division) status transitions ──
  const boardSession = { ...SESSION, role: "sales", userId: "user-1" }
  const boardExisting = (o: any = {}) => ({
    id: "t1", title: "Task", status: "todo", organizationId: "org-1",
    divisionId: "div-1", assignedTo: null, ...o,
  })
  const grant = (o: any = {}) => ({
    canView: true, canEdit: false, canMoveToTodo: false, canMoveToInProgress: false,
    canMoveToTesting: false, canMoveToReview: false, canMoveBack: false,
    canCreateTask: false, canComment: false, ...o,
  })

  it("board move: forward transition allowed with the per-action flag + logs activity", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToInProgress: true }) as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "in_progress" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(200)
    expect(prismaMock.taskActivity.createMany).toHaveBeenCalled()
    const acts = (vi.mocked(prismaMock.taskActivity.createMany).mock.calls[0][0] as any).data
    expect(acts).toContainEqual(expect.objectContaining({ action: "status_changed", oldValue: "todo", newValue: "in_progress" }))
  })

  // ── boardColumnKey co-write (custom columns Phase 1b) ──
  it("board move: co-writes boardColumnKey + status when both are sent (canonical column)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToInProgress: true }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "in_progress" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "in_progress", boardColumnKey: "in_progress" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "in_progress", boardColumnKey: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(200)
    const data = (vi.mocked(prisma.task.update).mock.calls[0][0] as any).data
    expect(data.status).toBe("in_progress")
    expect(data.boardColumnKey).toBe("in_progress")
  })

  it("board reorder: persists a finite manual position when the user drops between cards", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo", boardPosition: 1024 }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canEdit: true }) as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "todo", boardPosition: 1536 }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", {
      method: "PATCH",
      body: JSON.stringify({ boardPosition: 1536 }),
    }), makeParams("t1"))

    expect(res.status).toBe(200)
    expect((vi.mocked(prisma.task.update).mock.calls[0][0] as any).data.boardPosition).toBe(1536)
  })

  it("board move: a drag carrying a position is not refused for lacking canEdit", async () => {
    // The board sends boardPosition with every drop. It was missing from the
    // status-only exemption, so a user whose canMoveToTodo allowed the very
    // move they attempted got a 403 and the card rolled back.
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "backlog", boardColumnKey: "backlog" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(
      grant({ canEdit: false, canMoveToTodo: true }) as any,
    )
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "todo" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "todo", boardColumnKey: "todo" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", {
      method: "PATCH",
      body: JSON.stringify({ status: "todo", boardColumnKey: "todo", boardPosition: 2048 }),
    }), makeParams("t1"))

    expect(res.status).toBe(200)
    const written = (vi.mocked(prisma.task.update).mock.calls[0][0] as any).data
    expect(written.boardColumnKey).toBe("todo")
    expect(written.boardPosition).toBe(2048)
  })

  it("board reorder: rejects non-finite positions", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", {
      method: "PATCH",
      body: JSON.stringify({ boardPosition: "not-a-number" }),
    }), makeParams("t1"))

    expect(res.status).toBe(400)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: boardColumnKey for an unknown column on this board → 400, no update", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue(null) // no such column on the board

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ boardColumnKey: "bogus" }) }), makeParams("t1"))
    expect(res.status).toBe(400)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: boardColumnKey-only DERIVES status → still gated by canMoveToStatus (403 without the flag)", async () => {
    // Security: a key-only write must not bypass the move-permission gate.
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToInProgress: false }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "in_progress" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ boardColumnKey: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(403)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: status disagreeing with the target column's mapsToStatus → 400", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "in_progress" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "done", boardColumnKey: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(400)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: lane-only reshuffle (same status, new column) WITHOUT canEdit → 403", async () => {
    // Two columns map to in_progress; moving between them is an EDIT, not a status
    // move — a move-only user can't do it ungated (architect note #1).
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "in_progress", boardColumnKey: "dev" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToInProgress: true, canEdit: false }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "in_progress" } as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ boardColumnKey: "qa" }) }), makeParams("t1"))
    expect(res.status).toBe(403)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: lane-only reshuffle WITH canEdit → 200, persists the new lane (status unchanged)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "in_progress", boardColumnKey: "dev" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canEdit: true }) as any)
    vi.mocked(prismaMock.boardColumn.findFirst).mockResolvedValue({ mapsToStatus: "in_progress" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "in_progress", boardColumnKey: "qa" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ boardColumnKey: "qa" }) }), makeParams("t1"))
    expect(res.status).toBe(200)
    const data = (vi.mocked(prisma.task.update).mock.calls[0][0] as any).data
    expect(data.boardColumnKey).toBe("qa")
    expect(data.status).toBe("in_progress") // derived from the column, unchanged
  })

  it("board move: forward transition WITHOUT the per-action flag → 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "todo" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToInProgress: false }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(403)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: → done blocked for a non-head role even with move flags", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "review" }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToReview: true, canMoveBack: true, canEdit: true }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "done" }) }), makeParams("t1"))
    expect(res.status).toBe(403)
  })

  it("board move: non-status field without canEdit → 403", async () => {
    vi.mocked(requireAuth).mockResolvedValue(boardSession as any)
    vi.mocked(getSession).mockResolvedValue(boardSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting() as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: null } as any)
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveToTodo: true }) as any) // no canEdit

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ title: "Renamed" }) }), makeParams("t1"))
    expect(res.status).toBe(403)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("board move: done→other clears completedAt (head moving back)", async () => {
    const headSession = { ...SESSION, role: "sales", userId: "head-1" }
    vi.mocked(requireAuth).mockResolvedValue(headSession as any)
    vi.mocked(getSession).mockResolvedValue(headSession as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(boardExisting({ status: "done", completedAt: new Date() }) as any)
    vi.mocked(prismaMock.division.findFirst).mockResolvedValue({ headUserId: "head-1" } as any) // caller is the head
    vi.mocked(prismaMock.boardPermission.findUnique).mockResolvedValue(grant({ canMoveBack: true, canEdit: true }) as any)
    vi.mocked(prisma.task.update).mockResolvedValue(boardExisting({ status: "in_progress" }) as any)

    const res = await PATCH(makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ status: "in_progress" }) }), makeParams("t1"))
    expect(res.status).toBe(200)
    const updateCall = vi.mocked(prisma.task.update).mock.calls[0][0] as any
    expect(updateCall.data.completedAt).toBe(null)
  })

  // ── Cross-tenant relatedId security regression tests ─────────────────────
  it("rejects relatedId belonging to a different org (cross-tenant write block)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Task", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    // deal.findFirst returns null → entity not found in this org
    prismaMock.deal.findFirst.mockResolvedValue(null)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: "deal", relatedId: "deal-from-other-org" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Related entity not found")
    // Verify deal lookup was scoped to our org
    const dealCall = prismaMock.deal.findFirst.mock.calls[0][0] as any
    expect(dealCall.where.organizationId).toBe("org-1")
    expect(dealCall.where.id).toBe("deal-from-other-org")
  })

  it("allows relatedId when entity belongs to same org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Task", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    // contact.findFirst returns the entity → belongs to same org
    prismaMock.contact.findFirst.mockResolvedValue({ id: "ct-1" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ ...existing, relatedType: "contact", relatedId: "ct-1" } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: "contact", relatedId: "ct-1" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    // Verify the org-scoped lookup was performed
    const ctCall = prismaMock.contact.findFirst.mock.calls[0][0] as any
    expect(ctCall.where.organizationId).toBe("org-1")
  })

  it("rejects unknown relatedType (not in allowed set)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Task", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: "unknown_entity", relatedId: "x" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(400)
    const body = await res.json()
    // Rejected at Zod enum layer — message is the Zod validation error, not "Related entity not found"
    expect(body.error).toBeDefined()
  })

  it("returns 500 when DB throws during relatedId lookup (not masked as 400)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    const existing = { id: "t1", title: "Task", organizationId: "org-1" }
    vi.mocked(prisma.task.findFirst).mockResolvedValue(existing as any)
    // Simulate DB outage during company lookup
    prismaMock.company.findFirst.mockRejectedValue(new Error("DB connection lost"))

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ relatedType: "company", relatedId: "co-1" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal server error")
  })
})

// ---------------------------------------------------------------------------
// DELETE /api/v1/tasks/:id
// ---------------------------------------------------------------------------
describe("DELETE /api/v1/tasks/:id", () => {
  it("returns auth error when requireAuth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any
    )

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "DELETE" }),
      makeParams("t1")
    )
    expect(res.status).toBe(401)
  })

  it("returns 404 when task not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "DELETE" }),
      makeParams("t1")
    )
    expect(res.status).toBe(404)
  })

  it("soft-deletes a task (updateMany sets deletedAt) scoped to id+org", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ title: "Bye" } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "DELETE" }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)

    // Soft delete: updateMany scoped to id+org sets deletedAt; NO hard delete.
    expect(prisma.task.deleteMany).not.toHaveBeenCalled()
    const call = vi.mocked(prisma.task.updateMany).mock.calls[0][0] as any
    expect(call.where).toEqual({ id: "t1", organizationId: "org-1" })
    expect(call.data.deletedAt).toBeInstanceOf(Date)
  })
})

// ---------------------------------------------------------------------------
// Roadmap #9 — server-side required-field validation for CustomField
// ---------------------------------------------------------------------------
describe("Required custom-field validation (Roadmap #9)", () => {
  const REQUIRED_SPRINT_DEF = {
    fieldName: "sprint",
    fieldLabel: "Sprint",
  }

  it("POST /api/v1/tasks → 400 when required custom field is missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    prismaMock.customField.findMany.mockResolvedValueOnce([REQUIRED_SPRINT_DEF as any])

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "New Task" }), // no customFields
    }))

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Sprint")
    expect(body.error).toContain("required")
    // task.create must NOT have fired
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("POST /api/v1/tasks → 201 when required custom field is provided", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    prismaMock.customField.findMany.mockResolvedValueOnce([REQUIRED_SPRINT_DEF as any])
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-ok", title: "X" } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "X", customFields: { sprint: "S1" } }),
    }))

    expect(res.status).toBe(201)
    expect(prisma.task.create).toHaveBeenCalled()
  })

  it("PATCH allows status-only update on task with pre-existing missing required (don't trip legacy data)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    // Existing task has empty customFields (predates the required-field becoming required)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1", title: "Old", customFields: {} } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "Old", status: "completed" } as any)

    // PATCH only touches status — customFields NOT in body → validation should NOT fire
    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    // The required-field findMany must NOT have been called for this code path
    expect(prismaMock.customField.findMany).not.toHaveBeenCalled()
    expect(prisma.task.update).toHaveBeenCalled()
  })

  it("PATCH /api/v1/tasks/[id] → 400 when caller tries to clear a required custom field", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    // Existing task HAS sprint set to "S1"
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "Active", customFields: { sprint: "S1" },
    } as any)
    prismaMock.customField.findMany.mockResolvedValueOnce([REQUIRED_SPRINT_DEF as any])

    // PATCH sends customFields: { sprint: null } — should be rejected
    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ customFields: { sprint: null } }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain("Sprint")
    expect(body.error).toContain("required")
    expect(prisma.task.update).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Task → Project relation + rollup (Phase 2 of Notion-tasks plan)
// ---------------------------------------------------------------------------
describe("Task → Project relation + rollup", () => {
  it("POST → 400 when projectId references a project from another org", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    // findFirst returns null because the project doesn't belong to org-1
    prismaMock.project.findFirst.mockResolvedValueOnce(null)

    const res = await POST(
      makeRequest("http://localhost/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "X", projectId: "proj-from-other-org" }),
      })
    )

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Project not found")
    expect(prisma.task.create).not.toHaveBeenCalled()
    expect(recalcProjectCompletion).not.toHaveBeenCalled()
  })

  it("POST → creates task with projectId and triggers rollup", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: "proj-1" } as any)
    vi.mocked(prisma.task.create).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-1", status: "pending", priority: "medium",
    } as any)

    const res = await POST(
      makeRequest("http://localhost/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "X", projectId: "proj-1" }),
      })
    )

    expect(res.status).toBe(201)
    const createCall = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(createCall.data.projectId).toBe("proj-1")
    // Rollup fired with the new projectId. Fire-and-forget — promise may
    // resolve after the response, so awaiting the next tick is enough.
    await Promise.resolve()
    expect(recalcProjectCompletion).toHaveBeenCalledWith("proj-1", "org-1")
  })

  it("PATCH → triggers rollup when status changes on a project-linked task", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-1", status: "pending", customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-1", status: "completed",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(recalcProjectCompletion).toHaveBeenCalledWith("proj-1", "org-1")
  })

  it("PATCH → recalcs BOTH old and new project when projectId is reassigned", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-old", status: "in_progress", customFields: {},
    } as any)
    // Project validation passes for the new project
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: "proj-new" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-new", status: "in_progress",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ projectId: "proj-new" }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    await Promise.resolve()
    const calls = vi.mocked(recalcProjectCompletion).mock.calls
    const calledProjects = new Set(calls.map((c) => c[0]))
    expect(calledProjects).toEqual(new Set(["proj-old", "proj-new"]))
  })

  it("PATCH → recalcs BOTH old and new project on combined status+projectId patch (P1 fix)", async () => {
    // Architect P1: a single patch that BOTH moves the task to a new
    // project AND marks it completed must recalc the OLD project too —
    // otherwise the OLD project's percentage overstates `done/total`
    // because the completed task is no longer counted under it.
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-a", status: "in_progress", customFields: {},
    } as any)
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: "proj-b" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-b", status: "completed",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ projectId: "proj-b", status: "completed" }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    await Promise.resolve()
    const calledProjects = new Set(
      vi.mocked(recalcProjectCompletion).mock.calls.map((c) => c[0]),
    )
    // Both projects must be recalc'd; either one missing = data drift.
    expect(calledProjects).toEqual(new Set(["proj-a", "proj-b"]))
  })

  it("PATCH → no rollup when neither status nor projectId is in patch", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", projectId: "proj-1", status: "pending", customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "Renamed", projectId: "proj-1", status: "pending",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" }),
      }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    expect(recalcProjectCompletion).not.toHaveBeenCalled()
  })

  it("DELETE → triggers rollup when the deleted task had a projectId", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      title: "X", projectId: "proj-1",
    } as any)
    vi.mocked(prisma.task.updateMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "DELETE" }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(recalcProjectCompletion).toHaveBeenCalledWith("proj-1", "org-1")
  })

  it("DELETE → no rollup when deleted task had no projectId", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      title: "X", projectId: null,
    } as any)
    vi.mocked(prisma.task.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await DELETE(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "DELETE" }),
      makeParams("t1")
    )

    expect(res.status).toBe(200)
    expect(recalcProjectCompletion).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Recurrence — Roadmap #22
// ---------------------------------------------------------------------------
describe("Task recurrence", () => {
  it("POST → 400 when recurrenceRule is unknown", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    const res = await POST(
      makeRequest("http://localhost/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({ title: "X", recurrenceRule: "fortnightly" }),
      })
    )
    expect(res.status).toBe(400)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("POST → accepts a valid recurrence and stores all three fields", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.create).mockResolvedValue({
      id: "t1", title: "X", recurrenceRule: "weekly",
    } as any)

    const res = await POST(
      makeRequest("http://localhost/api/v1/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: "Weekly status",
          recurrenceRule: "weekly",
          recurrenceCount: 5,
          recurrenceEndAt: "2026-12-31T00:00:00.000Z",
        }),
      })
    )
    expect(res.status).toBe(201)
    const call = vi.mocked(prisma.task.create).mock.calls[0][0] as any
    expect(call.data.recurrenceRule).toBe("weekly")
    expect(call.data.recurrenceCount).toBe(5)
    expect(call.data.recurrenceEndAt).toBeInstanceOf(Date)
  })

  it("PATCH → 400 when recurrenceRule is unknown", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", status: "pending", customFields: {},
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ recurrenceRule: "fortnightly" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(400)
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it("PATCH → fires spawn helper when a recurring task completes", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", status: "pending",
      recurrenceRule: "daily", customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", status: "completed",
      recurrenceRule: "daily", recurrenceEndAt: null, recurrenceCount: null,
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    await Promise.resolve()
    expect(spawnNextRecurringTask).toHaveBeenCalledOnce()
    const callArg = vi.mocked(spawnNextRecurringTask).mock.calls[0][0] as any
    expect(callArg.task.recurrenceRule).toBe("daily")
  })

  it("PATCH → does NOT fire spawn when completed task has no recurrenceRule", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", status: "pending", recurrenceRule: null, customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", status: "completed", recurrenceRule: null,
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    expect(spawnNextRecurringTask).not.toHaveBeenCalled()
  })

  it("PATCH → does NOT fire spawn on idempotent re-completion (architect P1)", async () => {
    // Task is ALREADY completed; PATCH re-sends status=completed.
    // Spawn must skip — otherwise every form-resubmit creates a duplicate.
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X",
      status: "completed", // already completed
      recurrenceRule: "weekly",
      customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", status: "completed", recurrenceRule: "weekly",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    expect(spawnNextRecurringTask).not.toHaveBeenCalled()
  })

  it("PATCH → does NOT fire spawn when status changes to in_progress (only completed triggers)", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1" } as any)
    vi.mocked(isAuthError).mockReturnValue(false)
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", role: "admin" } as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "X", status: "pending", recurrenceRule: "weekly", customFields: {},
    } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({
      id: "t1", title: "X", status: "in_progress", recurrenceRule: "weekly",
    } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", {
        method: "PATCH",
        body: JSON.stringify({ status: "in_progress" }),
      }),
      makeParams("t1")
    )
    expect(res.status).toBe(200)
    expect(spawnNextRecurringTask).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Board isolation — departmental access control (no cross-department leak)
// ---------------------------------------------------------------------------
describe("Board isolation", () => {
  const SALES = { orgId: "org-1", userId: "u-sales", role: "sales", email: "s@b.com", name: "Sales" }

  it("GET list: a non-admin filtering by an inaccessible divisionId gets nothing, before the query runs", async () => {
    vi.mocked(getSession).mockResolvedValue(SALES as any)
    // boardPermission.findMany + division.findMany default to [] → accessible = []
    const res = await GET(makeRequest("http://localhost/api/v1/tasks?divisionId=other-dept"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.tasks).toEqual([])
    expect(body.data.total).toBe(0)
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("GET list: an admin filtering by any divisionId still runs the query (accessible='all')", async () => {
    vi.mocked(getSession).mockResolvedValue(SESSION as any) // admin
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    const res = await GET(makeRequest("http://localhost/api/v1/tasks?divisionId=any-dept"))
    expect(res.status).toBe(200)
    expect(prisma.task.findMany).toHaveBeenCalled()
  })

  it("GET [id]: a non-member reading a board task they do not own → 404 (no leak)", async () => {
    vi.mocked(getSession).mockResolvedValue(SALES as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t1", title: "Secret", organizationId: "org-1", divisionId: "div-X",
      assignedTo: "someone-else", createdBy: "someone-else",
    } as any)
    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t1"), makeParams("t1"))
    expect(res.status).toBe(404)
  })

  it("GET [id]: the assignee can read their own board task without board membership → 200", async () => {
    vi.mocked(getSession).mockResolvedValue(SALES as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t2", title: "Mine", organizationId: "org-1", divisionId: "div-X",
      assignedTo: "u-sales", createdBy: "someone-else",
    } as any)
    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t2"), makeParams("t2"))
    expect(res.status).toBe(200)
  })

  it("GET [id]: a board member (canView grant) can read the board task → 200", async () => {
    vi.mocked(getSession).mockResolvedValue(SALES as any)
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValueOnce([{ divisionId: "div-X", canView: true }] as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      id: "t3", title: "Board task", organizationId: "org-1", divisionId: "div-X",
      assignedTo: "someone-else", createdBy: "someone-else",
    } as any)
    const res = await GET_BY_ID(makeRequest("http://localhost/api/v1/tasks/t3"), makeParams("t3"))
    expect(res.status).toBe(200)
  })

  it("GET list: a manager (otherwise unrestricted) still gets board tasks gated to membership/ownership", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-mgr", role: "manager", email: "m@b.com", name: "Mgr" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    const res = await GET(makeRequest("http://localhost/api/v1/tasks"))
    expect(res.status).toBe(200)
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    const andClauses = (where.AND ?? []) as any[]
    // The board-isolation clause gates board tasks to null-division / mine.
    const boardClause = andClauses.find((c) => Array.isArray(c.OR) && c.OR.some((o: any) => o.divisionId === null))
    expect(boardClause).toBeDefined()
    expect(boardClause.OR).toEqual(expect.arrayContaining([
      { divisionId: null },
      { assignedTo: "u-mgr" },
      { createdBy: "u-mgr" },
    ]))
  })

  it("GET list: a board member's accessible division is inside the AND board-scope (member not filtered out)", async () => {
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-mbr", role: "sales", email: "x@b.com", name: "Member" } as any)
    vi.mocked(prisma.boardPermission.findMany).mockResolvedValueOnce([{ divisionId: "div-X", canView: true }] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.count).mockResolvedValue(0)
    const res = await GET(makeRequest("http://localhost/api/v1/tasks?divisionId=div-X"))
    expect(res.status).toBe(200)
    // div-X IS accessible → not short-circuited, the query runs.
    expect(prisma.task.findMany).toHaveBeenCalled()
    const where = (vi.mocked(prisma.task.findMany).mock.calls[0][0] as any).where
    // The member's accessible division is present in the AND board-scope, so
    // their board's tasks pass the gate (the AND doesn't filter the member out).
    const andBoard = ((where.AND ?? []) as any[]).find(
      (c) => Array.isArray(c.OR) && c.OR.some((o: any) => Array.isArray(o.divisionId?.in) && o.divisionId.in.includes("div-X")),
    )
    expect(andBoard).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// Task collaborators (co-assignees) — primary stays assignedTo; collaboratorIds
// is a replace-set, org-membership-validated, primary filtered out.
// ---------------------------------------------------------------------------
describe("Task collaborators (co-assignees)", () => {
  const prismaAny = prisma as any

  it("POST 400s when a collaboratorId is not a member of the org", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    prismaAny.user.count.mockResolvedValue(1) // 1 of 2 ids found → mismatch

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "T", collaboratorIds: ["u-2", "u-evil-other-org"] }),
    }))
    expect(res.status).toBe(400)
    expect(prisma.task.create).not.toHaveBeenCalled()
  })

  it("POST creates collaborator rows (deduped, primary excluded)", async () => {
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    prismaAny.user.count.mockResolvedValue(1) // only u-2 remains after filtering
    vi.mocked(prisma.task.create).mockResolvedValue({ id: "t-c1", title: "T", status: "pending", priority: "medium" } as any)

    const res = await POST(makeRequest("http://localhost/api/v1/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "T", assignedTo: "u-1", collaboratorIds: ["u-2", "u-2", "u-1"] }),
    }))
    expect(res.status).toBe(201)
    const arg = prismaAny.taskCollaborator.createMany.mock.calls[0][0]
    expect(arg.data).toEqual([{ organizationId: "org-1", taskId: "t-c1", userId: "u-2" }])
    expect(arg.skipDuplicates).toBe(true)
  })

  it("PATCH replaces the collaborator set (delete-then-create in the tx)", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1", title: "T", organizationId: "org-1", status: "pending", assignedTo: "u-1" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "T", organizationId: "org-1" } as any)
    prismaAny.user.count.mockResolvedValue(2)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ collaboratorIds: ["u-2", "u-3"] }) }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    expect(prismaAny.taskCollaborator.deleteMany).toHaveBeenCalledWith({ where: { taskId: "t1" } })
    const arg = prismaAny.taskCollaborator.createMany.mock.calls[0][0]
    expect(arg.data.map((d: any) => d.userId).sort()).toEqual(["u-2", "u-3"])
    // collaboratorIds must NOT leak into the task.update column data
    const updateArg = vi.mocked(prisma.task.update).mock.calls[0][0] as any
    expect(updateArg.data.collaboratorIds).toBeUndefined()
  })

  it("PATCH with [] clears collaborators without creating rows", async () => {
    vi.mocked(requireAuth).mockResolvedValue(SESSION as any)
    vi.mocked(getSession).mockResolvedValue(SESSION as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: "t1", title: "T", organizationId: "org-1", status: "pending" } as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ id: "t1", title: "T", organizationId: "org-1" } as any)

    const res = await PATCH(
      makeRequest("http://localhost/api/v1/tasks/t1", { method: "PATCH", body: JSON.stringify({ collaboratorIds: [] }) }),
      makeParams("t1"),
    )
    expect(res.status).toBe(200)
    expect(prismaAny.taskCollaborator.deleteMany).toHaveBeenCalledWith({ where: { taskId: "t1" } })
    expect(prismaAny.taskCollaborator.createMany).not.toHaveBeenCalled()
  })
})
