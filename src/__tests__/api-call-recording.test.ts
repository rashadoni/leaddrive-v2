import { describe, expect, it, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"
import type { Role } from "@/lib/permissions"

const authState = vi.hoisted(() => ({
  role: "ticketing" as Role,
}))

type RecordingRouteHandler = (
  req: NextRequest,
  auth: {
    orgId: string
    session: {
      orgId: string
      userId: string
      role: Role
      email: string
      name: string
    }
  },
  ctx: { params: Promise<{ id: string }> },
) => Promise<Response> | Response

type RecordingCallRow = {
  id: string
  organizationId: string
  recordingUrl: string | null
  ticketId: string | null
  conversationId: string | null
  dealId: string | null
  leadId: string | null
  companyId: string | null
  contactId: string | null
  callMode?: string | null
  userId?: string | null
}

function mockCall(row: RecordingCallRow) {
  vi.mocked(prisma.callLog.findFirst).mockResolvedValue(row as Awaited<ReturnType<typeof prisma.callLog.findFirst>>)
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    callLog: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: unknown) => (
    req: NextRequest,
    ctx: { params: Promise<{ id: string }> },
  ) => (handler as RecordingRouteHandler)(req, {
    orgId: "org_1",
    session: {
      orgId: "org_1",
      userId: "user_1",
      role: authState.role,
      email: "user@example.com",
      name: "Test User",
    },
  }, ctx),
}))

import { prisma } from "@/lib/prisma"
import { GET } from "@/app/api/v1/calls/[id]/recording/route"

function req(id = "call_1") {
  return new NextRequest(`http://localhost:3000/api/v1/calls/${id}/recording`)
}

function ctx(id = "call_1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  authState.role = "ticketing"
})

describe("GET /api/v1/calls/[id]/recording", () => {
  it("lets ticketing users play ticket-scoped recordings through the protected endpoint", async () => {
    mockCall({
      id: "call_1",
      organizationId: "org_1",
      recordingUrl: "https://recordings.example/ticket-call.mp3",
      ticketId: "ticket_1",
      conversationId: null,
      dealId: null,
      leadId: null,
      companyId: null,
      contactId: null,
    })

    const res = await GET(req(), ctx())

    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://recordings.example/ticket-call.mp3")
  })

  it("blocks ticketing-only users from inbox-scoped call recordings", async () => {
    mockCall({
      id: "call_1",
      organizationId: "org_1",
      recordingUrl: "https://recordings.example/inbox-call.mp3",
      ticketId: null,
      conversationId: "conversation_1",
      dealId: null,
      leadId: null,
      companyId: null,
      contactId: null,
    })

    const res = await GET(req(), ctx())

    expect(res.status).toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("does not redirect when an otherwise readable call has no recording", async () => {
    mockCall({
      id: "call_1",
      organizationId: "org_1",
      recordingUrl: null,
      ticketId: "ticket_1",
      conversationId: null,
      dealId: null,
      leadId: null,
      companyId: null,
      contactId: null,
    })

    const res = await GET(req(), ctx())

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: "Recording is not available for this call" })
  })

  it("does not expose another salesperson's AI-call recording", async () => {
    authState.role = "sales"
    mockCall({
      id: "call_1",
      organizationId: "org_1",
      recordingUrl: "https://recordings.example/ai-call.mp3",
      ticketId: null,
      conversationId: null,
      dealId: null,
      leadId: "lead_1",
      companyId: null,
      contactId: null,
      callMode: "ai",
      userId: "other_salesperson",
    })

    const res = await GET(req(), ctx())

    expect(res.status).toBe(403)
    expect(res.headers.get("location")).toBeNull()
  })

  it("keeps call lookup tenant-scoped before evaluating playback permissions", async () => {
    vi.mocked(prisma.callLog.findFirst).mockResolvedValue(null)

    const res = await GET(req("cross_tenant_call"), ctx("cross_tenant_call"))

    expect(res.status).toBe(404)
    expect(prisma.callLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cross_tenant_call", organizationId: "org_1" },
    }))
  })
})
