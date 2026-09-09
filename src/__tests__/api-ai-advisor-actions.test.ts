import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import type { AdvisorPayload } from "@/lib/ai/advisor/types"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const db = {
  existing: null as Record<string, unknown> | null,
  created: null as Record<string, unknown> | null,
  payload: null as AdvisorPayload | null,
}

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "manager-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(async () => ({ settings: {} })),
    },
    aiShadowAction: {
      findFirst: vi.fn(async () => db.existing),
      create: vi.fn(async ({ data }) => {
        db.created = { id: "shadow-created", ...data }
        return db.created
      }),
    },
  },
}))

vi.mock("@/lib/ai/advisor/service", () => ({
  getAdvisorPayload: vi.fn(async () => db.payload),
}))

import { POST } from "@/app/api/v1/ai/advisor/actions/route"
import { getAdvisorPayload } from "@/lib/ai/advisor/service"
import { prisma } from "@/lib/prisma"

function req(body: unknown) {
  return new NextRequest("http://localhost/api/v1/ai/advisor/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function advisorPayload(overrides: Partial<AdvisorPayload> = {}): AdvisorPayload {
  return {
    capabilities: [],
    collectorHealth: [],
    overview: {
      totalSignals: 1,
      critical: 1,
      high: 0,
      medium: 0,
      low: 0,
      revenueAtRisk: 0,
      pendingActions: 0,
    },
    signals: [
      {
        id: "server-signal-1",
        domain: "sales",
        domainLabel: "Sales",
        entityType: "deal",
        entityId: "deal-1",
        title: "Server-side stalled deal",
        summary: "No activity for 14 days.",
        severity: "critical",
        ownerId: "owner-1",
        ownerLabel: "Owner One",
        detectedAt: "2026-06-27T00:00:00.000Z",
        facts: [{ label: "Days idle", value: "14" }],
        sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
        recommendedActions: [
          {
            actionType: "create_task",
            label: "Create follow-up task",
            risk: "low",
            payload: {
              title: "Server follow-up task",
              description: "Call the customer and confirm next step.",
              relatedType: "deal",
              relatedId: "deal-1",
            },
          },
        ],
      },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  db.existing = null
  db.created = null
  db.payload = advisorPayload()
})

describe("POST /api/v1/ai/advisor/actions", () => {
  it("queues the server-derived Advisor payload instead of trusting client-supplied action data", async () => {
    const res = await POST(req({
      signal: {
        id: "server-signal-1",
        title: "MALICIOUS client title",
      },
      action: {
        actionType: "create_task",
        payload: {
          title: "MALICIOUS task title",
          assignedTo: "attacker",
        },
      },
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.data.payload.title).toBe("Server follow-up task")
    expect(json.data.payload.title).not.toBe("MALICIOUS task title")
    expect(prisma.aiShadowAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        featureName: "advisor_signal",
        entityType: "deal",
        entityId: "deal-1",
        actionType: "create_task",
        sourceSignalId: "server-signal-1",
        evidenceSnapshot: expect.objectContaining({
          title: "Server-side stalled deal",
          sources: [{ label: "Deal", entityType: "deal", entityId: "deal-1", href: "/deals/deal-1" }],
        }),
        payload: expect.objectContaining({
          title: "Server follow-up task",
          advisor: expect.objectContaining({
            signalId: "server-signal-1",
            ownerId: "owner-1",
            ownerLabel: "Owner One",
            title: "Server-side stalled deal",
            actionLabel: "Create follow-up task",
            autonomy: expect.objectContaining({
              actionType: "create_task",
              maxLevel: "L2",
              requiresApproval: true,
            }),
          }),
        }),
      }),
    })
    expect(getAdvisorPayload).toHaveBeenCalledWith("org-1", "manager", "manager-1")
  })

  it("returns the existing pending Advisor action instead of creating duplicates", async () => {
    db.existing = { id: "shadow-existing", organizationId: "org-1", sourceSignalId: "server-signal-1" }

    const res = await POST(req({
      signal: { id: "server-signal-1" },
      action: { actionType: "create_task" },
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ data: db.existing, duplicate: true })
    expect(prisma.aiShadowAction.create).not.toHaveBeenCalled()
  })

  it("rejects stale or out-of-scope Advisor actions without creating a shadow action", async () => {
    const res = await POST(req({
      signal: { id: "missing-signal" },
      action: { actionType: "create_task" },
    }))
    const json = await res.json()

    expect(res.status).toBe(409)
    expect(json.error).toBe("Advisor action is no longer valid for the current scope")
    expect(prisma.aiShadowAction.create).not.toHaveBeenCalled()
  })
})
