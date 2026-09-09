import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    activity: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    formSubmission: { findMany: vi.fn() },
    callLog: { findMany: vi.fn() },
    emailLog: { findMany: vi.fn() },
    channelMessage: { findMany: vi.fn() },
    ticket: { findMany: vi.fn() },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: vi.fn(async (_orgId, _userId, _role, _entity, where) => where),
}))

import { GET } from "@/app/api/v1/leads/[id]/timeline/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"

const AUTH = {
  orgId: "org-1",
  userId: "sales-1",
  role: "sales",
  email: "seller@example.test",
  name: "Seller",
}

const params = { params: Promise.resolve({ id: "l1" }) }
const req = () => new NextRequest("http://localhost:3000/api/v1/leads/l1/timeline")

const SOURCES = [
  prisma.activity, prisma.task, prisma.formSubmission,
  prisma.callLog, prisma.emailLog, prisma.channelMessage, prisma.ticket,
] as const

function resetAll() {
  for (const s of SOURCES) vi.mocked(s.findMany).mockResolvedValue([] as any)
}

describe("GET /api/v1/leads/[id]/timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue(AUTH as never)
    vi.mocked(prisma.lead.findFirst).mockResolvedValue({ id: "l1" } as never)
    resetAll()
  })

  it("preserves the leads read authorization gate", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never,
    )
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
    expect(prisma.lead.findFirst).not.toHaveBeenCalled()
  })

  it("hides an inaccessible lead before reading its timeline", async () => {
    vi.mocked(applyRecordFilter).mockResolvedValueOnce({
      id: "l1",
      organizationId: "org-1",
      OR: [{ assignedTo: "sales-1" }],
    })
    vi.mocked(prisma.lead.findFirst).mockResolvedValueOnce(null)

    const res = await GET(req(), params)

    expect(res.status).toBe(404)
    expect(applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "sales-1",
      "sales",
      "lead",
      { id: "l1", organizationId: "org-1" },
    )
    for (const source of SOURCES) {
      expect(source.findMany).not.toHaveBeenCalled()
    }
  })

  it("merges lead-linkable + channel sources sorted desc", async () => {
    vi.mocked(prisma.activity.findMany).mockResolvedValue([
      { id: "a1", type: "note", subject: "Called back", description: "interested", createdAt: new Date("2026-02-02T10:00:00Z"), createdBy: "u1" },
    ] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "t1", title: "Send brochure", description: "PDF", status: "todo", priority: "high", createdAt: new Date("2026-02-03T10:00:00Z") },
    ] as any)
    vi.mocked(prisma.formSubmission.findMany).mockResolvedValue([
      { id: "f1", source: "landing_page", createdAt: new Date("2026-02-01T10:00:00Z") },
    ] as any)
    // channel source via the new leadId column (Slice 3a)
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      { id: "cl1", direction: "outbound", status: "completed", disposition: "interested", notes: null, transcription: "raw transcript", insights: { summary: "Müştəri təkliflə maraqlandı." }, startedAt: new Date("2026-02-05T10:00:00Z"), createdAt: new Date("2026-02-05T10:00:00Z") },
    ] as any)

    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    const tl = body.data.timeline
    expect(tl).toHaveLength(4)
    // sorted desc: call(05) > task(03) > activity(02) > form(01)
    expect(tl.map((x: any) => x.kind)).toEqual(["call", "task", "activity", "form"])
    expect(tl[0].id).toBe("call:cl1")
    expect(tl[0].title).toBeNull() // i18n-clean: UI localizes "{direction} call"
    expect(tl[0].channel).toBe("phone")
    expect(tl[0].subtitle).toBe("Müştəri təkliflə maraqlandı.")
  })

  it("scopes every source by leadId + organizationId (cross-tenant guard)", async () => {
    await GET(req(), params)
    // lead-linkable sources use relatedType/relatedId or leadId
    expect(vi.mocked(prisma.activity.findMany).mock.calls[0][0]!.where).toEqual({ organizationId: "org-1", relatedType: "lead", relatedId: "l1" })
    expect(vi.mocked(prisma.task.findMany).mock.calls[0][0]!.where).toEqual({ organizationId: "org-1", relatedType: "lead", relatedId: "l1" })
    expect(vi.mocked(prisma.formSubmission.findMany).mock.calls[0][0]!.where).toEqual({ organizationId: "org-1", leadId: "l1" })
    // channel sources use the new leadId column
    for (const m of [prisma.callLog, prisma.emailLog, prisma.channelMessage, prisma.ticket]) {
      expect(vi.mocked(m.findMany).mock.calls[0][0]!.where).toEqual({ organizationId: "org-1", leadId: "l1" })
    }
  })

  it("returns 500 shape on db error", async () => {
    vi.mocked(prisma.ticket.findMany).mockRejectedValue(new Error("db down"))
    const res = await GET(req(), params)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "Internal server error" })
  })
})
