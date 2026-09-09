import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

// ── Mocks ───────────────────────────────────────────────────────────────────

const { mockAnthropicCreate } = vi.hoisted(() => ({
  mockAnthropicCreate: vi.fn(),
}))

vi.mock("@/lib/prisma", () => {
  const prisma: any = {
    project: {
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    projectMember: { findMany: vi.fn(), create: vi.fn(), delete: vi.fn() },
    projectTask: { findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    // recalcProjectCompletion also counts CRM-linked Tasks inside its transaction.
    task: { count: vi.fn() },
    event: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    emailTemplate: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    deal: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
    activity: { create: vi.fn() },
    aiChatSession: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    aiChatMessage: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    aiAgentConfig: { findFirst: vi.fn() },
    aiGuardrail: { findMany: vi.fn() },
    aiInteractionLog: { create: vi.fn(), findMany: vi.fn() },
    aiAlert: { create: vi.fn() },
    kbArticle: { findMany: vi.fn() },
    ticket: { count: vi.fn(), create: vi.fn() },
    ticketComment: { create: vi.fn() },
    contract: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
  }
  // recalcProjectCompletion runs inside prisma.$transaction(async tx => ...).
  // Pass the SAME mock object as `tx` so tx.* hit the vi.fn()s the tests set.
  prisma.$transaction = vi.fn(async (cb: any) => cb(prisma))
  return { prisma, logAudit: vi.fn() }
})

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  // events/[id] routes are getOrgId-only withRls handlers; withRls calls getSession
  // first, so default it to null to fall through to getOrgId (clearAllMocks keeps
  // this impl; no global mockReset configured).
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

vi.mock("@/lib/portal-auth", () => ({
  getPortalUser: vi.fn(),
}))

vi.mock("@/lib/ai/support-feature", () => ({
  isSupportAiEnabled: vi.fn().mockResolvedValue(true),
  SUPPORT_AI_DISABLED_ERROR: {
    error: "Support AI is disabled for this organization.",
    errorKey: "supportAiDisabled",
  },
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(),
}))

vi.mock("@/lib/sanitize", () => ({
  sanitizeForPrompt: vi.fn((s: string) => s),
}))

vi.mock("@/lib/ai/anthropic-client", () => ({
  getAnthropicClient: vi.fn(() => ({ messages: { create: mockAnthropicCreate } })),
}))

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(),
}))

vi.mock("@/lib/chat-store", () => ({
  getSessionByTelegramReply: vi.fn(),
  addOperatorMessage: vi.fn(),
}))

vi.mock("fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}))

import { prisma, logAudit } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { getPortalUser } from "@/lib/portal-auth"
import { isSupportAiEnabled } from "@/lib/ai/support-feature"
import { sendEmail } from "@/lib/email"
import { getSessionByTelegramReply, addOperatorMessage } from "@/lib/chat-store"

const ORG = "org-1"

function makeReq(url: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method })
}

function makeJsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

const AUTH_OK = { orgId: "org-1", userId: "u-1", role: "admin", email: "a@b.com", name: "Test" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
  vi.mocked(isSupportAiEnabled).mockResolvedValue(true)
})

// ═══════════════════════════════════════════════════════════════════════════
// Projects [id]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/projects/[id]", () => {
  let GET: typeof import("@/app/api/v1/projects/[id]/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/projects/[id]/route")).GET })

  it("requires projects:read", async () => {
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1", name: "Project 1", company: { name: "Co" }, members: [], milestones: [], tasks: [],
    } as any)
    await GET(makeReq("/api/v1/projects/p1"), params("p1"))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects", "read")
  })

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(new NextResponse(null, { status: 401 }) as any)
    const res = await GET(makeReq("/api/v1/projects/p1"), params("p1"))
    expect(res.status).toBe(401)
  })

  it("returns 404 when project not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.project.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/projects/p1"), params("p1"))
    expect(res.status).toBe(404)
  })

  it("returns project with includes", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.project.findFirst).mockResolvedValue({
      id: "p1", name: "Project 1", company: { name: "Co" }, members: [], milestones: [], tasks: [],
    } as any)
    const res = await GET(makeReq("/api/v1/projects/p1"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.name).toBe("Project 1")
  })
})

describe("PUT /api/v1/projects/[id]", () => {
  let PUT: typeof import("@/app/api/v1/projects/[id]/route").PUT
  beforeEach(async () => { PUT = (await import("@/app/api/v1/projects/[id]/route")).PUT })

  it("requires projects:write", async () => {
    vi.mocked(prisma.project.update).mockResolvedValue({ id: "p1", name: "Updated" } as any)
    await PUT(makeJsonReq("/api/v1/projects/p1", { name: "Updated" }, "PUT"), params("p1"))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects", "write")
  })

  it("returns 400 on invalid status", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await PUT(makeJsonReq("/api/v1/projects/p1", { status: "INVALID" }, "PUT"), params("p1"))
    expect(res.status).toBe(400)
  })

  it("rejects an unrealistically large project budget on update", async () => {
    const res = await PUT(
      makeJsonReq("/api/v1/projects/p1", { budget: 1_000_000_000_000 }, "PUT"),
      params("p1"),
    )

    expect(res.status).toBe(400)
    expect(prisma.project.update).not.toHaveBeenCalled()
  })

  it("updates project successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.project.update).mockResolvedValue({ id: "p1", name: "Updated" } as any)
    const res = await PUT(makeJsonReq("/api/v1/projects/p1", { name: "Updated" }, "PUT"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe("DELETE /api/v1/projects/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/projects/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/projects/[id]/route")).DELETE })

  it("requires projects:delete", async () => {
    vi.mocked(prisma.project.delete).mockResolvedValue({ id: "p1" } as any)
    await DELETE(makeReq("/api/v1/projects/p1", "DELETE"), params("p1"))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects", "delete")
  })

  it("deletes project", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.project.delete).mockResolvedValue({ id: "p1" } as any)
    const res = await DELETE(makeReq("/api/v1/projects/p1", "DELETE"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe("POST /api/v1/projects/bulk", () => {
  let POST: typeof import("@/app/api/v1/projects/bulk/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/projects/bulk/route")).POST })

  it("requires projects:write for the bulk endpoint", async () => {
    await POST(makeJsonReq("/api/v1/projects/bulk", {
      ids: ["p1"],
      action: "changeStatus",
      value: "active",
    }))
    expect(requireAuth).toHaveBeenCalledWith(expect.anything(), "projects", "write")
  })

  it("rejects ids array > 100", async () => {
    const res = await POST(makeJsonReq("/api/v1/projects/bulk", {
      ids: Array.from({ length: 101 }, (_, i) => `p${i}`),
      action: "changeStatus",
      value: "active",
    }))
    expect(res.status).toBe(400)
    expect(prisma.project.updateMany).not.toHaveBeenCalled()
  })

  it("re-checks projects:delete permission for bulk delete", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u-1", role: "viewer" } as any)

    const res = await POST(makeJsonReq("/api/v1/projects/bulk", {
      ids: ["p1", "p2"],
      action: "delete",
    }))

    expect(res.status).toBe(403)
    expect(prisma.project.deleteMany).not.toHaveBeenCalled()
  })

  it("bulk deletes scoped by organization and writes an audit log", async () => {
    vi.mocked(prisma.project.deleteMany).mockResolvedValue({ count: 2 } as any)

    const res = await POST(makeJsonReq("/api/v1/projects/bulk", {
      ids: ["p1", "p2"],
      action: "delete",
    }))

    expect(res.status).toBe(200)
    expect(prisma.project.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2"] }, organizationId: ORG },
    })
    expect(logAudit).toHaveBeenCalledWith(
      ORG,
      "bulk_delete",
      "project",
      "p1,p2",
      "Deleted 2 projects",
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Project Members
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/projects/[id]/members", () => {
  let GET: typeof import("@/app/api/v1/projects/[id]/members/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/projects/[id]/members/route")).GET })

  it("returns members list", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectMember.findMany).mockResolvedValue([{ id: "m1", userId: "u1" }] as any)
    const res = await GET(makeReq("/api/v1/projects/p1/members"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/projects/[id]/members", () => {
  let POST: typeof import("@/app/api/v1/projects/[id]/members/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/projects/[id]/members/route")).POST })

  it("returns 400 on missing userId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await POST(makeJsonReq("/api/v1/projects/p1/members", {}), params("p1"))
    expect(res.status).toBe(400)
  })

  it("creates member successfully", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectMember.create).mockResolvedValue({ id: "m1", userId: "u1" } as any)
    const res = await POST(makeJsonReq("/api/v1/projects/p1/members", { userId: "u1", role: "member" }), params("p1"))
    expect(res.status).toBe(201)
  })

  it("returns 409 on duplicate member", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectMember.create).mockRejectedValue(new Error("Unique constraint failed"))
    const res = await POST(makeJsonReq("/api/v1/projects/p1/members", { userId: "u1" }), params("p1"))
    expect(res.status).toBe(409)
  })
})

describe("DELETE /api/v1/projects/[id]/members", () => {
  let DELETE: typeof import("@/app/api/v1/projects/[id]/members/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/projects/[id]/members/route")).DELETE })

  it("returns 400 when memberId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await DELETE(makeReq("/api/v1/projects/p1/members", "DELETE"), params("p1"))
    expect(res.status).toBe(400)
  })

  it("deletes member", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectMember.delete).mockResolvedValue({} as any)
    const res = await DELETE(makeReq("/api/v1/projects/p1/members?memberId=m1", "DELETE"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Project Tasks
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/projects/[id]/tasks", () => {
  let GET: typeof import("@/app/api/v1/projects/[id]/tasks/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/projects/[id]/tasks/route")).GET })

  it("returns tasks list", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectTask.findMany).mockResolvedValue([{ id: "t1", title: "Task 1" }] as any)
    const res = await GET(makeReq("/api/v1/projects/p1/tasks"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/projects/[id]/tasks", () => {
  let POST: typeof import("@/app/api/v1/projects/[id]/tasks/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/projects/[id]/tasks/route")).POST })

  it("returns 400 on missing title", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await POST(makeJsonReq("/api/v1/projects/p1/tasks", {}), params("p1"))
    expect(res.status).toBe(400)
  })

  it("creates task", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectTask.create).mockResolvedValue({ id: "t1", title: "New Task" } as any)
    const res = await POST(makeJsonReq("/api/v1/projects/p1/tasks", { title: "New Task" }), params("p1"))
    expect(res.status).toBe(201)
  })
})

describe("PUT /api/v1/projects/[id]/tasks", () => {
  let PUT: typeof import("@/app/api/v1/projects/[id]/tasks/route").PUT
  beforeEach(async () => { PUT = (await import("@/app/api/v1/projects/[id]/tasks/route")).PUT })

  it("returns 400 when taskId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await PUT(makeJsonReq("/api/v1/projects/p1/tasks", { title: "Updated" }, "PUT"), params("p1"))
    expect(res.status).toBe(400)
  })

  it("updates task and recalculates project completion", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectTask.update).mockResolvedValue({ id: "t1", status: "done" } as any)
    vi.mocked(prisma.projectTask.count).mockResolvedValueOnce(10).mockResolvedValueOnce(5)
    vi.mocked(prisma.task.count).mockResolvedValue(0 as any) // no CRM-linked tasks
    vi.mocked(prisma.project.updateMany).mockResolvedValue({ count: 1 } as any)
    const res = await PUT(makeJsonReq("/api/v1/projects/p1/tasks", { taskId: "t1", status: "done" }, "PUT"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
    // recalcProjectCompletion writes via updateMany (org-scoped, defense-in-depth):
    // (5 done / 10 total) → 50%.
    expect(prisma.project.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { completionPercentage: 50 } }),
    )
  })
})

describe("DELETE /api/v1/projects/[id]/tasks", () => {
  let DELETE: typeof import("@/app/api/v1/projects/[id]/tasks/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/projects/[id]/tasks/route")).DELETE })

  it("returns 400 when taskId missing", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    const res = await DELETE(makeReq("/api/v1/projects/p1/tasks", "DELETE"), params("p1"))
    expect(res.status).toBe(400)
  })

  it("deletes task", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.projectTask.delete).mockResolvedValue({} as any)
    const res = await DELETE(makeReq("/api/v1/projects/p1/tasks?taskId=t1", "DELETE"), params("p1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Events [id]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/events/[id]", () => {
  let GET: typeof import("@/app/api/v1/events/[id]/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/events/[id]/route")).GET })

  it("returns 404 when event not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/events/e1"), params("e1"))
    expect(res.status).toBe(404)
  })

  it("returns event with participants", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e1", name: "Conference", participants: [] } as any)
    const res = await GET(makeReq("/api/v1/events/e1"), params("e1"))
    const json = await res.json()
    expect(json.data.name).toBe("Conference")
  })
})

describe("PUT /api/v1/events/[id]", () => {
  let PUT: typeof import("@/app/api/v1/events/[id]/route").PUT
  beforeEach(async () => { PUT = (await import("@/app/api/v1/events/[id]/route")).PUT })

  it("returns 404 when event not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT(makeJsonReq("/api/v1/events/e1", { name: "Updated" }, "PUT"), params("e1"))
    expect(res.status).toBe(404)
  })

  it("updates event", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.event.findFirst).mockResolvedValue({ id: "e1", name: "Updated" } as any)
    const res = await PUT(makeJsonReq("/api/v1/events/e1", { name: "Updated" }, "PUT"), params("e1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe("DELETE /api/v1/events/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/events/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/events/[id]/route")).DELETE })

  it("returns 404 when event not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 0 } as any)
    const res = await DELETE(makeReq("/api/v1/events/e1", "DELETE"), params("e1"))
    expect(res.status).toBe(404)
  })

  it("deletes event", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.event.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE(makeReq("/api/v1/events/e1", "DELETE"), params("e1"))
    const json = await res.json()
    expect(json.data.deleted).toBe("e1")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Email Templates [id]
// ═══════════════════════════════════════════════════════════════════════════

describe("GET /api/v1/email-templates/[id]", () => {
  let GET: typeof import("@/app/api/v1/email-templates/[id]/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/email-templates/[id]/route")).GET })

  it("returns 404 when template not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.emailTemplate.findFirst).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/email-templates/et1"), params("et1"))
    expect(res.status).toBe(404)
  })

  it("returns template", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.emailTemplate.findFirst).mockResolvedValue({ id: "et1", name: "Welcome", subject: "Hi" } as any)
    const res = await GET(makeReq("/api/v1/email-templates/et1"), params("et1"))
    const json = await res.json()
    expect(json.data.name).toBe("Welcome")
  })
})

describe("PUT /api/v1/email-templates/[id]", () => {
  let PUT: typeof import("@/app/api/v1/email-templates/[id]/route").PUT
  beforeEach(async () => { PUT = (await import("@/app/api/v1/email-templates/[id]/route")).PUT })

  it("returns 404 when template not found", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.emailTemplate.updateMany).mockResolvedValue({ count: 0 } as any)
    const res = await PUT(makeJsonReq("/api/v1/email-templates/et1", { name: "Updated" }, "PUT"), params("et1"))
    expect(res.status).toBe(404)
  })

  it("updates template", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.emailTemplate.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.emailTemplate.findFirst).mockResolvedValue({ id: "et1", name: "Updated" } as any)
    const res = await PUT(makeJsonReq("/api/v1/email-templates/et1", { name: "Updated" }, "PUT"), params("et1"))
    const json = await res.json()
    expect(json.success).toBe(true)
  })
})

describe("DELETE /api/v1/email-templates/[id]", () => {
  let DELETE: typeof import("@/app/api/v1/email-templates/[id]/route").DELETE
  beforeEach(async () => { DELETE = (await import("@/app/api/v1/email-templates/[id]/route")).DELETE })

  it("deletes template", async () => {
    vi.mocked(getOrgId).mockResolvedValue(ORG)
    vi.mocked(prisma.emailTemplate.deleteMany).mockResolvedValue({ count: 1 } as any)
    const res = await DELETE(makeReq("/api/v1/email-templates/et1", "DELETE"), params("et1"))
    const json = await res.json()
    expect(json.data.deleted).toBe("et1")
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Deals [id] Send Email (POST with FormData)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/deals/[id]/send-email", () => {
  let POST: typeof import("@/app/api/v1/deals/[id]/send-email/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/deals/[id]/send-email/route")).POST })

  it("returns 401 when unauthenticated", async () => {
    const { NextResponse: NR } = await import("next/server")
    vi.mocked(requireAuth).mockResolvedValue(NR.json({ error: "Unauthorized" }, { status: 401 }))
    const form = new FormData()
    form.append("contactId", "c1")
    form.append("subject", "Hi")
    form.append("body", "Hello")
    const req = new NextRequest(new URL("http://localhost:3000/api/v1/deals/d1/send-email"), { method: "POST", body: form })
    const res = await POST(req, params("d1"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when required fields missing", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u1" } as any)
    const form = new FormData()
    const req = new NextRequest(new URL("http://localhost:3000/api/v1/deals/d1/send-email"), { method: "POST", body: form })
    const res = await POST(req, params("d1"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when deal not found", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u1" } as any)
    vi.mocked(prisma.deal.findFirst).mockResolvedValue(null)
    const form = new FormData()
    form.append("contactId", "c1")
    form.append("subject", "Test")
    form.append("body", "Body text")
    const req = new NextRequest(new URL("http://localhost:3000/api/v1/deals/d1/send-email"), { method: "POST", body: form })
    const res = await POST(req, params("d1"))
    expect(res.status).toBe(404)
  })

  it("sends email and creates activity", async () => {
    vi.mocked(requireAuth).mockResolvedValue({ orgId: ORG, userId: "u1" } as any)
    vi.mocked(prisma.deal.findFirst).mockResolvedValue({ id: "d1", name: "Deal" } as any)
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({ id: "c1", fullName: "John", email: "j@test.com" } as any)
    vi.mocked(sendEmail).mockResolvedValue({ success: true } as any)
    vi.mocked(prisma.activity.create).mockResolvedValue({} as any)

    const form = new FormData()
    form.append("contactId", "c1")
    form.append("subject", "Test Subject")
    form.append("body", "Email body")
    const req = new NextRequest(new URL("http://localhost:3000/api/v1/deals/d1/send-email"), { method: "POST", body: form })
    const res = await POST(req, params("d1"))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.emailSent).toBe(true)
    expect(json.recipientEmail).toBe("j@test.com")
    expect(prisma.activity.create).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Portal Chat (POST + GET)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/v1/public/portal-chat", () => {
  let POST: typeof import("@/app/api/v1/public/portal-chat/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/v1/public/portal-chat/route")).POST })

  it("returns 403 before creating a chat session when Support AI is disabled", async () => {
    vi.mocked(getPortalUser).mockResolvedValue({
      organizationId: ORG, contactId: "c1", companyId: "co1", fullName: "John", email: "j@test.com",
    } as any)
    vi.mocked(isSupportAiEnabled).mockResolvedValue(false)

    const res = await POST(makeJsonReq("/api/v1/public/portal-chat", { message: "Hello" }))

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ errorKey: "supportAiDisabled" })
    expect(prisma.aiChatSession.create).not.toHaveBeenCalled()
    expect(prisma.aiChatMessage.create).not.toHaveBeenCalled()
  })

  it("returns 401 when portal user not authenticated", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)
    const res = await POST(makeJsonReq("/api/v1/public/portal-chat", { message: "Hello" }))
    expect(res.status).toBe(401)
  })

  it("returns 400 when message missing", async () => {
    vi.mocked(getPortalUser).mockResolvedValue({
      organizationId: ORG, contactId: "c1", companyId: "co1", fullName: "John", email: "j@test.com",
    } as any)
    const res = await POST(makeJsonReq("/api/v1/public/portal-chat", {}))
    expect(res.status).toBe(400)
  })

  it("returns fallback response when no API key", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    vi.mocked(getPortalUser).mockResolvedValue({
      organizationId: ORG, contactId: "c1", companyId: "co1", fullName: "John", email: "j@test.com",
    } as any)
    vi.mocked(prisma.aiChatSession.create).mockResolvedValue({ id: "sess1", messagesCount: 0 } as any)
    vi.mocked(prisma.aiChatMessage.create).mockResolvedValue({ id: "msg1", role: "assistant", content: "fallback", createdAt: new Date() } as any)
    vi.mocked(prisma.aiChatSession.update).mockResolvedValue({} as any)
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null)

    const res = await POST(makeJsonReq("/api/v1/public/portal-chat", { message: "привет" }))
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.sessionId).toBe("sess1")

    if (origKey) process.env.ANTHROPIC_API_KEY = origKey
  })

  it("masks portal customer PII in the full Anthropic payload", async () => {
    const origKey = process.env.ANTHROPIC_API_KEY
    process.env.ANTHROPIC_API_KEY = "test-key"

    vi.mocked(getPortalUser).mockResolvedValue({
      organizationId: ORG,
      contactId: "c1",
      companyId: "co1",
      fullName: "Иван Петров",
      email: "ivan.petrov@example.com",
    })
    vi.mocked(prisma.aiChatSession.create).mockResolvedValue({ id: "sess1", messagesCount: 0 } as never)
    vi.mocked(prisma.aiChatMessage.create).mockImplementation(async (args: unknown) => {
      const data = (args as { data: { role: string; content: string } }).data
      return {
        id: data.role === "assistant" ? "assistant-msg" : "user-msg",
        role: data.role,
        content: data.content,
        createdAt: new Date("2026-07-05T00:00:00.000Z"),
      } as never
    })
    vi.mocked(prisma.aiChatSession.update).mockResolvedValue({} as never)
    vi.mocked(prisma.aiAgentConfig.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.aiGuardrail.findMany).mockResolvedValue([])
    vi.mocked(prisma.kbArticle.findMany).mockResolvedValue([])
    vi.mocked(prisma.aiInteractionLog.create).mockResolvedValue({} as never)
    vi.mocked(prisma.aiInteractionLog.findMany).mockResolvedValue([])
    mockAnthropicCreate.mockResolvedValue({
      content: [{ type: "text", text: "Здравствуйте, [PERSON_1]. Ваш email [EMAIL_1] сохранён." }],
      usage: { input_tokens: 20, output_tokens: 10 },
    })

    try {
      const res = await POST(makeJsonReq("/api/v1/public/portal-chat", {
        message: "Здравствуйте, проверьте мой email ivan.petrov@example.com и телефон +994 50 123 45 67",
      }))
      const json = await res.json()
      const anthropicRequest = mockAnthropicCreate.mock.calls[0]?.[0]

      expect(json.success).toBe(true)
      expect(anthropicRequest).toBeTruthy()
      expect(anthropicRequest.system).toContain("[PERSON_")
      expect(anthropicRequest.system).toContain("[EMAIL_")
      expect(anthropicRequest.system).not.toContain("Иван Петров")
      expect(anthropicRequest.system).not.toContain("ivan.petrov@example.com")
      expect(JSON.stringify(anthropicRequest.messages)).not.toContain("ivan.petrov@example.com")
      expect(JSON.stringify(anthropicRequest.messages)).not.toContain("+994 50 123 45 67")
      expect(json.data.reply.content).toContain("Иван Петров")
      expect(json.data.reply.content).toContain("ivan.petrov@example.com")
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey
      else delete process.env.ANTHROPIC_API_KEY
    }
  })
})

describe("GET /api/v1/public/portal-chat", () => {
  let GET: typeof import("@/app/api/v1/public/portal-chat/route").GET
  beforeEach(async () => { GET = (await import("@/app/api/v1/public/portal-chat/route")).GET })

  it("returns 401 when not authenticated", async () => {
    vi.mocked(getPortalUser).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/public/portal-chat?sessionId=s1"))
    expect(res.status).toBe(401)
  })

  it("returns cleared=true when session not found", async () => {
    vi.mocked(getPortalUser).mockResolvedValue({ organizationId: ORG } as any)
    vi.mocked(prisma.aiChatSession.findUnique).mockResolvedValue(null)
    const res = await GET(makeReq("/api/v1/public/portal-chat?sessionId=s1"))
    const json = await res.json()
    expect(json.data.cleared).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// Chat Webhook (POST)
// ═══════════════════════════════════════════════════════════════════════════

describe("POST /api/chat/webhook", () => {
  let POST: typeof import("@/app/api/chat/webhook/route").POST
  beforeEach(async () => { POST = (await import("@/app/api/chat/webhook/route")).POST })

  it("returns ok when no reply_to_message", async () => {
    const req = new Request("http://localhost:3000/api/chat/webhook", {
      method: "POST",
      body: JSON.stringify({ message: { text: "hello" } }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.ok).toBe(true)
  })

  it("adds operator message when session found", async () => {
    vi.mocked(getSessionByTelegramReply).mockReturnValue("sess-1")
    vi.mocked(addOperatorMessage).mockReturnValue({} as any)

    const req = new Request("http://localhost:3000/api/chat/webhook", {
      method: "POST",
      body: JSON.stringify({
        message: {
          text: "Operator reply",
          reply_to_message: { message_id: 42 },
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(addOperatorMessage).toHaveBeenCalledWith("sess-1", "Operator reply")
  })

  it("ignores when session not found for reply", async () => {
    vi.mocked(getSessionByTelegramReply).mockReturnValue(undefined)

    const req = new Request("http://localhost:3000/api/chat/webhook", {
      method: "POST",
      body: JSON.stringify({
        message: {
          text: "Reply text",
          reply_to_message: { message_id: 99 },
        },
      }),
      headers: { "Content-Type": "application/json" },
    })
    const res = await POST(req)
    const json = await res.json()
    expect(json.ok).toBe(true)
    expect(addOperatorMessage).not.toHaveBeenCalled()
  })
})
