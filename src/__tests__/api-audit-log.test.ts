import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn(),
}))

vi.mock("@/lib/constants", () => ({
  isAdmin: vi.fn(() => true),
}))

import { prisma } from "@/lib/prisma"
import { getOrgId, getSession } from "@/lib/api-auth"
import { GET, POST } from "@/app/api/v1/audit-log/route"

function makeReq(url: string, opts?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(url, opts)
}

describe("GET /api/v1/audit-log", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0)
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
  })

  it("returns 401 when no org", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    const res = await GET(makeReq("http://localhost/api/v1/audit-log"))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe("Unauthorized")
  })

  it("returns success with log list", async () => {
    const log = { id: "l-1", action: "create", entityType: "deal", createdAt: new Date() }
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([log as any])
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1)

    const res = await GET(makeReq("http://localhost/api/v1/audit-log"))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.total).toBe(1)
    expect(json.data.logs).toHaveLength(1)
  })

  it("resolves the actor name for auditable user security actions", async () => {
    const log = {
      id: "l-1",
      action: "password_reset",
      entityType: "user",
      entityId: "target-1",
      entityName: "target@example.com",
      userId: "admin-1",
      createdAt: new Date(),
    }
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([log as any])
    vi.mocked(prisma.auditLog.count).mockResolvedValue(1)
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "admin-1", name: "Admin", email: "admin@example.com" },
    ] as any)

    const response = await GET(makeReq("http://localhost/api/v1/audit-log"))
    const json = await response.json()

    expect(json.data.logs[0]).toMatchObject({
      actorName: "Admin",
      actorEmail: "admin@example.com",
    })
  })

  it("returns 500 on DB error (not success:true with empty data)", async () => {
    vi.mocked(prisma.auditLog.findMany).mockRejectedValue(new Error("DB down"))
    const res = await GET(makeReq("http://localhost/api/v1/audit-log"))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
    // CRITICAL: must NOT return success:true on DB error
    expect(json.success).toBeUndefined()
  })

  it("filters by entityType and entityId", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([])
    vi.mocked(prisma.auditLog.count).mockResolvedValue(0)

    await GET(makeReq("http://localhost/api/v1/audit-log?entityType=deal&entityId=d-1"))

    expect(vi.mocked(prisma.auditLog.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityType: "deal",
          entityId: "d-1",
          NOT: {
            OR: [
              {
                entityType: "social_paid_run_authorization",
                action: "reset_boundary",
              },
              { entityType: "lead_voice_permission" },
            ],
          },
        }),
      })
    )
  })

  it("always hides the internal clean-slate budget boundary", async () => {
    await GET(makeReq(
      "http://localhost/api/v1/audit-log?entityType=social_paid_run_authorization",
    ))

    const hiddenBoundary = {
      OR: [
        {
          entityType: "social_paid_run_authorization",
          action: "reset_boundary",
        },
        { entityType: "lead_voice_permission" },
      ],
    }
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ NOT: hiddenBoundary }),
    }))
    expect(prisma.auditLog.count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ NOT: hiddenBoundary }),
    }))
  })
})

describe("POST /api/v1/audit-log", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as any)
  })

  it("returns 401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({ action: "create", entityType: "deal" }),
    }))
    expect(res.status).toBe(401)
  })

  it("returns 400 on invalid body", async () => {
    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({ entityType: "deal" }), // missing action
    }))
    expect(res.status).toBe(400)
  })

  it("creates audit log and returns 201", async () => {
    const log = { id: "l-1", action: "create", entityType: "deal", organizationId: "org-1" }
    vi.mocked(prisma.auditLog.create).mockResolvedValue(log as any)

    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({ action: "create", entityType: "deal", entityId: "d-1" }),
    }))
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data.id).toBe("l-1")
  })

  it("rejects the reserved paid-run system audit entity", async () => {
    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({
        action: "reset_boundary",
        entityType: "social_paid_run_authorization",
        entityId: "clean-slate:forged",
        entityName: "Social Monitoring clean slate",
        newValue: {
          budgetCarryForward: {
            schemaVersion: "social-monitoring-budget-carry-v1",
          },
        },
      }),
    }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("Reserved system audit entity")
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("rejects forged voice-permission replay entries", async () => {
    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({
        action: "voice_contact_allow",
        entityType: "lead_voice_permission",
        entityId: "00000000-0000-4000-8000-000000000001",
        entityName: "lead-1",
        newValue: { operation: "allow" },
      }),
    }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe("Reserved system audit entity")
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it("returns 500 on DB error", async () => {
    vi.mocked(prisma.auditLog.create).mockRejectedValue(new Error("DB down"))

    const res = await POST(makeReq("http://localhost/api/v1/audit-log", {
      method: "POST",
      body: JSON.stringify({ action: "create", entityType: "deal" }),
    }))
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toBe("Internal server error")
    expect(json.success).toBeUndefined()
  })
})
