import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ── Mocks ────────────────────────────────────────────────
vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    callLog: { findMany: vi.fn() },
    emailLog: { findMany: vi.fn() },
    channelMessage: { findMany: vi.fn() },
    ticket: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
}))

// ── Imports ──────────────────────────────────────────────
import { GET } from "@/app/api/v1/contacts/[id]/timeline/route"
import { prisma } from "@/lib/prisma"
import { getOrgId } from "@/lib/api-auth"

const params = { params: Promise.resolve({ id: "c1" }) }
const req = () => new NextRequest("http://localhost:3000/api/v1/contacts/c1/timeline")

function resetAll() {
  vi.mocked(prisma.activity.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.emailLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as any)
}

describe("GET /api/v1/contacts/[id]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getOrgId).mockResolvedValue("org-1")
    resetAll()
  })

  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it("merges all sources into one timeline sorted by date desc", async () => {
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "a1", type: "note", subject: "Met at expo", description: "Good chat", createdAt: new Date("2026-01-01T10:00:00Z"), createdBy: "u1" },
    ] as any)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      { id: "cl1", direction: "inbound", status: "completed", disposition: "interested", notes: null, transcription: null, createdAt: new Date("2026-01-05T10:00:00Z"), startedAt: new Date("2026-01-05T10:00:00Z") },
    ] as any)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([
      { id: "e1", direction: "outbound", subject: "Proposal", body: "Here is our offer", status: "opened", createdAt: new Date("2026-01-03T10:00:00Z") },
    ] as any)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      { id: "m1", direction: "inbound", channelType: "whatsapp", subject: null, body: "Hi there", status: "read", createdAt: new Date("2026-01-04T10:00:00Z") },
    ] as any)
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([
      { id: "t1", ticketNumber: "TK-1", subject: "Login issue", description: "cannot log in", status: "open", priority: "high", createdAt: new Date("2026-01-02T10:00:00Z") },
    ] as any)

    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    const tl = body.data.timeline
    expect(tl).toHaveLength(5)
    // sorted desc: call(05) > message(04) > email(03) > ticket(02) > activity(01)
    expect(tl.map((x: any) => x.kind)).toEqual(["call", "message", "email", "ticket", "activity"])
    // ids are namespaced by kind to avoid cross-source collisions
    expect(tl[0].id).toBe("call:cl1")
    expect(tl[2].id).toBe("email:e1")
    // call carries no English chrome — UI localizes from kind+direction
    expect(tl[0].title).toBeNull()
    expect(tl[0].direction).toBe("inbound")
    expect(tl[0].channel).toBe("phone")
    // content-bearing entries keep their raw content
    expect(tl[2].title).toBe("Proposal")
    expect(tl[3].title).toBe("Login issue")
    // message channel surfaced for UI
    expect(tl[1].channel).toBe("whatsapp")
  })

  it("includes Task events related to the contact (relatedType=contact) — parity with lead timeline", async () => {
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "tk1", title: "Call back Thursday", description: "follow up", status: "open", priority: "medium", createdAt: new Date("2026-01-06T10:00:00Z") },
    ] as any)
    const res = await GET(req(), params)
    const body = await res.json()
    const task = body.data.timeline.find((x: any) => x.kind === "task")
    expect(task).toBeTruthy()
    expect(task.title).toBe("Call back Thursday")
    expect(task.id).toBe("task:tk1")
    const where = vi.mocked(prisma.task.findMany).mock.calls[0][0]!.where as any
    expect(where).toEqual({ organizationId: "org-1", relatedType: "contact", relatedId: "c1" })
  })

  it("excludes call/email Activity types to avoid double-counting canonical sources", async () => {
    vi.mocked(prisma.activity.findMany).mockResolvedValue([] as any)
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    // the Activity query must filter out call/email types (canonical = CallLog/EmailLog)
    const where = vi.mocked(prisma.activity.findMany).mock.calls[0][0]!.where as any
    expect(where.contactId).toBe("c1")
    expect(where.organizationId).toBe("org-1")
    expect(where.type).toEqual({ notIn: ["call", "email"] })
  })

  it("scopes every source by organizationId (cross-tenant guard)", async () => {
    await GET(req(), params)
    for (const m of [prisma.callLog, prisma.emailLog, prisma.channelMessage, prisma.ticket]) {
      const where = vi.mocked(m.findMany).mock.calls[0][0]!.where as any
      expect(where.contactId).toBe("c1")
      expect(where.organizationId).toBe("org-1")
    }
  })

  it("returns 500 shape on db error", async () => {
    vi.mocked(prisma.ticket.findMany).mockRejectedValue(new Error("db down"))
    const res = await GET(req(), params)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ error: "Internal server error" })
  })
})
