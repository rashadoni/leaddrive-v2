import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

/**
 * Company timeline — Slice 3b feature: company-card click-to-call (CallLog tagged
 * with companyId) now surfaces in the company timeline. Additive — Activity/Deal/
 * Ticket rows are unchanged.
 */

vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => "org-1"),
  getSession: vi.fn(async () => null),
  requireAuth: vi.fn(async () => ({
    orgId: "org-1",
    userId: "user-1",
    role: "admin",
    email: "a@b.com",
    name: "Test",
  })),
  isAuthError: vi.fn((value: unknown) => value instanceof Response),
}))
vi.mock("@/lib/prisma", () => ({
  prisma: {
    activity: { findMany: vi.fn(async () => []) },
    deal: { findMany: vi.fn(async () => []) },
    ticket: { findMany: vi.fn(async () => []) },
    callLog: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    emailLog: { findMany: vi.fn() },
    channelMessage: { findMany: vi.fn() },
  },
}))

import { GET } from "@/app/api/v1/companies/[id]/timeline/route"
import { prisma } from "@/lib/prisma"

const makeReq = () => new NextRequest("https://example.com/api/v1/companies/co-1/timeline")
const ctx = { params: Promise.resolve({ id: "co-1" }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.activity.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.deal.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.contact.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.emailLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([] as any)
})

describe("GET /api/v1/companies/[id]/timeline — calls", () => {
  it("includes CallLog entries (type=call), org+company scoped", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      { id: "cl1", direction: "outbound", fromNumber: "+100", toNumber: "+994501112233", status: "initiated", duration: 0, startedAt: new Date("2026-01-02"), createdAt: new Date("2026-01-02") },
    ] as any)

    const res = await GET(makeReq(), ctx)
    const json = await res.json()
    expect(res.status).toBe(200)

    const call = json.data.timeline.find((e: any) => e.type === "call")
    expect(call).toBeTruthy()
    expect(call.title).toBe("+994501112233") // outbound → callee number
    expect(call.subtitle).toBe("Outgoing call")

    // org + company scoped, and de-duped (only calls NOT already mirrored by an Activity)
    expect(vi.mocked(prisma.callLog.findMany).mock.calls[0][0]!.where).toEqual({ companyId: "co-1", organizationId: "org-1", activityId: null })
  })

  it("de-dups against the webhook-created call Activity: only un-mirrored calls (activityId: null) are fetched", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as any)
    await GET(makeReq(), ctx)
    // A completed Twilio call has CallLog.activityId set + a call Activity (already shown);
    // filtering activityId: null at the DB layer prevents a duplicate timeline row.
    expect(vi.mocked(prisma.callLog.findMany).mock.calls[0][0]!.where).toMatchObject({ activityId: null })
  })

  it("inbound call titles use the caller number", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([
      { id: "cl2", direction: "inbound", fromNumber: "+994700000000", toNumber: "+100", status: "completed", duration: 42, startedAt: new Date("2026-01-03"), createdAt: new Date("2026-01-03") },
    ] as any)

    const res = await GET(makeReq(), ctx)
    const json = await res.json()
    const call = json.data.timeline.find((e: any) => e.type === "call")
    expect(call.title).toBe("+994700000000")
    expect(call.subtitle).toBe("Incoming call")
  })

  it("does not break when there are no calls (additive)", async () => {
    vi.mocked(prisma.callLog.findMany).mockResolvedValue([] as any)
    const res = await GET(makeReq(), ctx)
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.data.timeline).toEqual([])
  })

  it("aggregates the company's contacts' emails + messages (company-360, by contactId)", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "c1" }, { id: "c2" }] as any)
    vi.mocked(prisma.emailLog.findMany).mockResolvedValue([
      { id: "em1", direction: "inbound", subject: "Re: quote", fromEmail: "a@x.com", toEmail: "b@y.com", createdAt: new Date("2026-02-01") },
    ] as any)
    vi.mocked(prisma.channelMessage.findMany).mockResolvedValue([
      { id: "msg1", direction: "inbound", channelType: "whatsapp", body: "hi there", createdAt: new Date("2026-02-02") },
    ] as any)

    const res = await GET(makeReq(), ctx)
    const json = await res.json()
    expect(res.status).toBe(200)
    const email = json.data.timeline.find((e: any) => e.type === "email")
    const message = json.data.timeline.find((e: any) => e.type === "message")
    expect(email?.title).toBe("Re: quote")
    expect(message?.title).toBe("hi there")
    // queried by the company's contact ids (email/msg are contact-level — no companyId)
    expect(vi.mocked(prisma.emailLog.findMany).mock.calls[0][0]!.where).toEqual({ contactId: { in: ["c1", "c2"] }, organizationId: "org-1" })
    expect(vi.mocked(prisma.channelMessage.findMany).mock.calls[0][0]!.where).toEqual({ contactId: { in: ["c1", "c2"] }, organizationId: "org-1" })
  })

  it("includes the company's contacts' calls (companyId:null, via contacts) — call parity with email/msg", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([{ id: "c1" }] as any)
    vi.mocked(prisma.callLog.findMany).mockImplementation(async (args: any) =>
      (args?.where?.contactId
        ? [{ id: "cc1", direction: "inbound", fromNumber: "+99", toNumber: "+1", status: "completed", duration: 5, startedAt: new Date("2026-03-01"), createdAt: new Date("2026-03-01") }]
        : []) as any,
    )
    const res = await GET(makeReq(), ctx)
    const json = await res.json()
    expect(res.status).toBe(200)
    const call = json.data.timeline.find((e: any) => e.id === "cc1")
    expect(call?.type).toBe("call")
    // contact-aggregated call query: contactId IN contacts, companyId null, NO activityId filter
    const contactCallWhere = vi.mocked(prisma.callLog.findMany).mock.calls.find((c: any) => c[0]?.where?.contactId)![0]!.where
    expect(contactCallWhere).toEqual({ contactId: { in: ["c1"] }, organizationId: "org-1", companyId: null })
  })

  it("skips email/message queries when the company has no contacts", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([] as any)
    const res = await GET(makeReq(), ctx)
    expect(res.status).toBe(200)
    expect(prisma.emailLog.findMany).not.toHaveBeenCalled()
    expect(prisma.channelMessage.findMany).not.toHaveBeenCalled()
  })
})
