import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type ShadowActionRow = ReturnType<typeof shadowAction>
type ShadowActionFindInput = { where: { id?: string; organizationId?: string } }
type ShadowActionUpdateInput = {
  where: { id: string; organizationId: string; approved: null }
  data: Record<string, unknown>
}
type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const db: {
  action: ShadowActionRow | null
  updated: ShadowActionRow | null
  updateCount: number
  lastUpdate: ShadowActionUpdateInput | null
  authRole: string
} = {
  action: null,
  updated: null,
  updateCount: 1,
  lastUpdate: null,
  authRole: "manager",
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiShadowAction: {
      findMany: vi.fn(async () => [db.action].filter(Boolean)),
      count: vi.fn(async () => (db.action ? 1 : 0)),
      findFirst: vi.fn(async ({ where }: ShadowActionFindInput) => {
        const row = db.updated || db.action
        if (!row) return null
        if (where.id && where.id !== row.id) return null
        if (where.organizationId && where.organizationId !== row.organizationId) return null
        return row
      }),
      updateMany: vi.fn(async (input: ShadowActionUpdateInput) => {
        db.lastUpdate = input
        if (db.updateCount === 1 && db.action) {
          db.updated = { ...db.action, ...input.data }
        }
        return { count: db.updateCount }
      }),
    },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "manager-1", role: db.authRole }),
}))

import { GET, PATCH } from "@/app/api/v1/ai-shadow-actions/route"
import { buildAdvisorShadowActionWhere } from "@/lib/ai/advisor/shadow-action-history"
import { logAudit, prisma } from "@/lib/prisma"

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/ai-shadow-actions", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function getReq(url: string) {
  return new NextRequest(new URL(url, "http://localhost"))
}

function shadowAction(overrides: Record<string, unknown> = {}) {
  return {
    id: "shadow-1",
    organizationId: "org-1",
    featureName: "advisor_signal",
    actionType: "create_task",
    entityType: "deal",
    entityId: "deal-1",
    riskLevel: "high",
    approved: null,
    executionStatus: "pending",
    payload: { advisor: { title: "Deal has no next step" }, title: "Follow up" },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.action = shadowAction()
  db.updated = null
  db.updateCount = 1
  db.lastUpdate = null
  db.authRole = "manager"
})

describe("PATCH /api/v1/ai-shadow-actions", () => {
  it("approves Advisor shadow actions with a tenant-scoped compare-and-set update", async () => {
    const res = await PATCH(req({ actionId: "shadow-1", decision: "approve" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ approved: true, executionStatus: "queued", reviewedBy: "manager-1" })
    expect(prisma.aiShadowAction.updateMany).toHaveBeenCalledWith({
      where: { id: "shadow-1", organizationId: "org-1", approved: null },
      data: expect.objectContaining({
        approved: true,
        reviewedBy: "manager-1",
        executionStatus: "queued",
      }),
    })
    expect(logAudit).toHaveBeenCalledWith(
      "org-1",
      "ai_shadow_approve",
      "ai_shadow_action",
      "shadow-1",
      "Deal has no next step",
      expect.any(Object),
    )
  })

  it("returns 409 and skips audit when another reviewer already claimed the action", async () => {
    db.updateCount = 0

    const res = await PATCH(req({ actionId: "shadow-1", decision: "reject" }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe("Action already reviewed")
    expect(logAudit).not.toHaveBeenCalled()
  })

  it("validates edited payload objects before approving", async () => {
    const res = await PATCH(req({ actionId: "shadow-1", decision: "approve", editedPayload: "not-json-object" }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("editedPayload must be an object")
    expect(prisma.aiShadowAction.updateMany).not.toHaveBeenCalled()
  })

  it("rejects Advisor edited payloads that retarget the original signal", async () => {
    db.action = shadowAction({
      payload: {
        advisor: { title: "Deal has no next step" },
        title: "Follow up",
        description: "Confirm next step",
        relatedType: "deal",
        relatedId: "deal-1",
      },
    })

    const res = await PATCH(req({
      actionId: "shadow-1",
      decision: "approve",
      editedPayload: {
        title: "Follow another deal",
        description: "This should not be allowed",
        relatedType: "deal",
        relatedId: "deal-2",
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toBe("Advisor action target cannot be changed")
    expect(prisma.aiShadowAction.updateMany).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/ai-shadow-actions", () => {
  it("uses safe pagination defaults when page or limit are invalid", async () => {
    const res = await GET(getReq("/api/v1/ai-shadow-actions?page=abc&limit=bogus"))

    expect(res.status).toBe(200)
    expect(prisma.aiShadowAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 0,
      take: 20,
    }))
  })

  it("caps list page size to protect the approval queue", async () => {
    const res = await GET(getReq("/api/v1/ai-shadow-actions?page=3&limit=500"))

    expect(res.status).toBe(200)
    expect(prisma.aiShadowAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 100,
      take: 50,
    }))
  })

  it("builds durable Advisor history filters without dropping rejected actions", async () => {
    const where = buildAdvisorShadowActionWhere({
      organizationId: "org-1",
      status: "reviewed",
      module: "finance",
      owner: "owner-1",
      dateFrom: "2026-06-20T00:00:00.000Z",
      query: "invoice",
    })

    expect(where).toMatchObject({
      organizationId: "org-1",
      AND: expect.arrayContaining([
        { approved: { not: null } },
        expect.objectContaining({
          OR: expect.arrayContaining([
            { payload: { path: ["advisor", "domain"], equals: "finance" } },
          ]),
        }),
        expect.objectContaining({
          OR: expect.arrayContaining([
            { payload: { path: ["advisor", "ownerId"], equals: "owner-1" } },
          ]),
        }),
      ]),
    })
  })

  it("passes module, owner and date filters to the list query", async () => {
    const res = await GET(getReq("/api/v1/ai-shadow-actions?status=reviewed&module=sales&owner=owner-1&from=2026-06-27T00:00:00.000Z"))

    expect(res.status).toBe(200)
    expect(prisma.aiShadowAction.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        AND: expect.arrayContaining([
          { approved: { not: null } },
          expect.objectContaining({
            OR: expect.arrayContaining([
              { payload: { path: ["advisor", "domain"], equals: "sales" } },
            ]),
          }),
          expect.objectContaining({
            OR: expect.arrayContaining([
              { payload: { path: ["advisor", "ownerId"], equals: "owner-1" } },
            ]),
          }),
        ]),
      }),
    }))
  })
})
