import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(() => Promise.resolve()),
  writeFile: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  readFile: vi.fn(),
  stat: vi.fn(),
}))

import { GET as getOperations } from "@/app/api/v1/mtm/operations/route"
import { POST as sendMessage } from "@/app/api/v1/mtm/operations/messages/route"
import { POST as uploadDocument } from "@/app/api/v1/mtm/operations/documents/route"
import { POST as decideHrm } from "@/app/api/v1/mtm/operations/hrm/[id]/decision/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { mkdir, writeFile } from "node:fs/promises"

const ORG = "org-1"
const adminAuth = {
  orgId: ORG,
  userId: "admin-user",
  role: "admin",
  email: "admin@example.com",
  name: "Field Admin",
}

function jsonRequest(path: string, body: unknown): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function params(id = "hrm-1") {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(adminAuth as never)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
  vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmMessageThread.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmDocument.findMany).mockResolvedValue([])
  vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([])
  vi.mocked(prisma.organization.findUnique).mockResolvedValue({
    plan: "enterprise",
    addons: [],
    features: [],
    modules: { mtm: true },
  } as never)
})

describe("GET /api/v1/mtm/operations", () => {
  it("returns the manager workspace with actionable counters", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Aysel", role: "AGENT", avatar: null, team: null }] as never)
    vi.mocked(prisma.mtmMessageThread.findMany).mockResolvedValue([{
      id: "thread-1",
      type: "BROADCAST",
      subject: "Plan update",
      lastMessageAt: new Date("2026-07-15T08:00:00.000Z"),
      createdByUserId: "admin-user",
      participants: [{ role: "MEMBER", agent: { id: "agent-1", name: "Aysel", role: "AGENT" } }],
      messages: [{
        id: "message-1",
        senderAgentId: null,
        senderUserId: "admin-user",
        senderName: "Field Admin",
        body: "Please acknowledge",
        acknowledgementRequired: true,
        sentAt: new Date("2026-07-15T08:00:00.000Z"),
        attachmentDocument: null,
        receipts: [],
      }],
    }] as never)
    vi.mocked(prisma.mtmDocument.findMany).mockResolvedValue([{
      id: "document-1",
      title: "Price list",
      fileName: "prices.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      checksumSha256: "sum",
      createdAt: new Date(),
      assignments: [{
        id: "assignment-1",
        required: true,
        assignedAt: new Date(),
        expiresAt: null,
        readAt: null,
        downloadedAt: null,
        agent: { id: "agent-1", name: "Aysel" },
      }],
    }] as never)
    vi.mocked(prisma.mtmHrmRequest.findMany).mockResolvedValue([{ id: "hrm-1", status: "PENDING" }] as never)

    const response = await getOperations(new NextRequest("http://localhost:3000/api/v1/mtm/operations"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        counts: { pendingHrm: 1, acknowledgementDue: 1, requiredDocumentsUnread: 1 },
        capabilities: { privateStorage: true, externalCloudStorage: false },
      },
    })
  })

  it("does not expose HRM data from the mixed endpoint when Workforce is disabled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)

    const response = await getOperations(new NextRequest("http://localhost:3000/api/v1/mtm/operations"))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: { hrmRequests: [], counts: { pendingHrm: 0 }, capabilities: { canReviewHrm: false } },
    })
    expect(prisma.mtmHrmRequest.findMany).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/mtm/operations/messages", () => {
  it("creates an acknowledgement-required broadcast and notifications", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([
      { id: "agent-1", name: "Aysel" },
      { id: "agent-2", name: "Murad" },
    ] as never)
    vi.mocked(prisma.mtmMessageThread.create).mockResolvedValue({ id: "thread-1" } as never)
    vi.mocked(prisma.mtmMessage.create).mockResolvedValue({
      id: "message-1",
      threadId: "thread-1",
      body: "Plan changed",
      sentAt: new Date(),
      acknowledgementRequired: true,
    } as never)
    vi.mocked(prisma.mtmMessageThread.update).mockResolvedValue({ id: "thread-1" } as never)
    vi.mocked(prisma.mtmNotification.createMany).mockResolvedValue({ count: 2 } as never)

    const response = await sendMessage(jsonRequest("/api/v1/mtm/operations/messages", {
      type: "BROADCAST",
      subject: "Friday plan",
      body: "Plan changed",
      agentIds: ["agent-1", "agent-2"],
      acknowledgementRequired: true,
    }))

    expect(response.status).toBe(201)
    expect(prisma.mtmMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ acknowledgementRequired: true, senderUserId: "admin-user" }),
    }))
    expect(prisma.mtmNotification.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([expect.objectContaining({ agentId: "agent-1" })]),
    }))
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MESSAGE_BROADCAST" }))
  })

  it("rejects a direct message with more than one recipient", async () => {
    const response = await sendMessage(jsonRequest("/api/v1/mtm/operations/messages", {
      type: "DIRECT",
      body: "Hello",
      agentIds: ["agent-1", "agent-2"],
    }))
    expect(response.status).toBe(400)
    expect(prisma.mtmMessage.create).not.toHaveBeenCalled()
  })

  it("creates a time-bounded localized key message with sanitized notification metadata", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Aysel" }] as never)
    vi.mocked(prisma.mtmMessageThread.create).mockResolvedValue({ id: "thread-key" } as never)
    vi.mocked(prisma.mtmMessage.create).mockResolvedValue({
      id: "message-key",
      threadId: "thread-key",
      body: "Plan changed",
      sentAt: new Date(),
      acknowledgementRequired: true,
    } as never)
    vi.mocked(prisma.mtmMessageThread.update).mockResolvedValue({ id: "thread-key" } as never)
    vi.mocked(prisma.mtmNotification.createMany).mockResolvedValue({ count: 1 } as never)

    const response = await sendMessage(jsonRequest("/api/v1/mtm/operations/messages", {
      type: "BROADCAST",
      subject: "Important",
      body: "<b>Plan changed</b>",
      agentIds: ["agent-1"],
      keyMessage: true,
      effectiveFrom: "2026-07-30T08:00:00.000Z",
      effectiveUntil: "2026-08-06T08:00:00.000Z",
      localizations: { ru: "<script>alert(1)</script>План изменён" },
    }))

    expect(response.status).toBe(201)
    expect(prisma.mtmMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        body: "Plan changed",
        acknowledgementRequired: true,
      }),
    }))
    expect(prisma.mtmNotification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        agentId: "agent-1",
        metadata: expect.objectContaining({
          keyMessage: true,
          messageId: "message-key",
          effectiveFrom: "2026-07-30T08:00:00.000Z",
          effectiveUntil: "2026-08-06T08:00:00.000Z",
          fallbackBody: "Plan changed",
          localizations: { ru: "План изменён" },
        }),
      })],
    })
  })

  it("rejects unavailable recipients before creating a thread", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Aysel" }] as never)
    const response = await sendMessage(jsonRequest("/api/v1/mtm/operations/messages", {
      type: "BROADCAST",
      subject: "Update",
      body: "Hello",
      agentIds: ["agent-1", "missing-agent"],
    }))
    expect(response.status).toBe(400)
    expect(prisma.mtmMessageThread.create).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/mtm/operations/documents", () => {
  it("stores a validated file privately and assigns it to selected agents", async () => {
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([{ id: "agent-1", name: "Aysel" }] as never)
    vi.mocked(prisma.mtmDocument.create).mockResolvedValue({
      id: "document-1",
      title: "Policy",
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      sizeBytes: 8,
      checksumSha256: "sum",
      createdAt: new Date(),
    } as never)
    vi.mocked(prisma.mtmDocumentAssignment.createMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmNotification.createMany).mockResolvedValue({ count: 1 } as never)

    const form = new FormData()
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])], "policy.pdf", { type: "application/pdf" }))
    form.set("title", "Policy")
    form.set("agentIds", JSON.stringify(["agent-1"]))
    form.set("required", "true")
    const response = await uploadDocument(new NextRequest("http://localhost:3000/api/v1/mtm/operations/documents", { method: "POST", body: form }))

    expect(response.status).toBe(201)
    expect(mkdir).toHaveBeenCalled()
    expect(writeFile).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), { flag: "wx" })
    expect(prisma.mtmDocumentAssignment.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ agentId: "agent-1", required: true })],
    }))
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "DOCUMENT_ASSIGN" }))
  })

  it("rejects a calendar date that only looks like YYYY-MM-DD", async () => {
    const form = new FormData()
    form.set("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "policy.pdf", { type: "application/pdf" }))
    form.set("agentIds", JSON.stringify(["agent-1"]))
    form.set("expiresOn", "2026-02-31")

    const response = await uploadDocument(new NextRequest("http://localhost:3000/api/v1/mtm/operations/documents", { method: "POST", body: form }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid expiration date" })
    expect(prisma.mtmDocument.create).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/mtm/operations/hrm/[id]/decision", () => {
  const leaveRequest = {
    id: "hrm-1",
    agentId: "agent-1",
    type: "LEAVE",
    status: "PENDING",
    startDate: new Date("2026-07-20T00:00:00.000Z"),
    endDate: new Date("2026-07-21T00:00:00.000Z"),
    correctionWorkdayId: null,
    requestedStartAt: null,
    requestedEndAt: null,
    reason: "Family leave",
    decisionNote: null,
    decidedAt: null,
    updatedAt: new Date("2026-07-15T08:00:00.000Z"),
    agent: { id: "agent-1", name: "Aysel" },
  }

  beforeEach(() => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue(leaveRequest as never)
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmHrmRequest.updateMany).mockResolvedValue({ count: 1 } as never)
    vi.mocked(prisma.mtmWorkCalendarDay.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmWorkCalendarDay.createMany).mockResolvedValue({ count: 2 } as never)
    vi.mocked(prisma.mtmNotification.create).mockResolvedValue({ id: "notification-1" } as never)
    vi.mocked(prisma.mtmHrmRequest.findUnique).mockResolvedValue({
      id: "hrm-1",
      status: "APPROVED",
      decisionNote: "Approved",
      decidedAt: new Date("2026-07-15T09:00:00.000Z"),
      updatedAt: new Date("2026-07-15T09:00:00.000Z"),
    } as never)
  })

  it("approves leave and blocks route planning for every approved day", async () => {
    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
      note: "Approved",
    }), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmWorkCalendarDay.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ agentId: "agent-1", routePlanningAllowed: false, source: "WORKFORCE_LEAVE" }),
        expect.objectContaining({ agentId: "agent-1", routePlanningAllowed: false, source: "WORKFORCE_LEAVE" }),
      ]),
    })
    expect(prisma.mtmAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "HRM_REQUEST_DECISION", metadataKind: "hrm_request_decision" }),
    }))
  })

  it("keeps the legacy decision URL usable for a Workforce-only tenant", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: ["workforce-hrm"],
      modules: { mtm: false, "workforce-hrm": true },
    } as never)

    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
      note: "Approved",
    }), params())

    expect(response.status).toBe(200)
    expect(prisma.mtmRoute.findMany).not.toHaveBeenCalled()
    expect(prisma.mtmHrmRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, status: "PENDING" }),
    }))
  })

  it("stops approval when active routes overlap until the manager acknowledges it", async () => {
    vi.mocked(prisma.mtmRoute.findMany).mockResolvedValue([{
      id: "route-1",
      name: "Monday route",
      date: new Date("2026-07-20T00:00:00.000Z"),
      status: "PLANNED",
      totalPoints: 8,
    }] as never)
    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "MTM_HRM_ROUTE_CONFLICT", conflicts: [{ id: "route-1" }] })
    expect(prisma.mtmRoute.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        AND: [{
          OR: [
            { agentId: "agent-1" },
            { assignments: { some: { agentId: "agent-1", removedAt: null } } },
          ],
        }],
      }),
    }))
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })

  it("requires a decision note for rejection", async () => {
    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "REJECTED",
    }), params())
    expect(response.status).toBe(400)
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })

  it("preserves the invalid corrected-time code on the legacy adapter", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({
      ...leaveRequest,
      type: "TIME_CORRECTION",
      correctionWorkdayId: "workday-1",
      requestedEndAt: new Date("2026-07-20T07:30:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmAgentWorkday.findFirst).mockResolvedValue({
      id: "workday-1",
      startedAt: new Date("2026-07-20T08:00:00.000Z"),
      completedAt: null,
    } as never)

    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "WORKFORCE_TIME_RANGE_INVALID" })
    expect(prisma.mtmAgentWorkday.update).not.toHaveBeenCalled()
  })

  it("blocks the legacy HRM decision adapter when Workforce is disabled", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      plan: "enterprise",
      addons: [],
      features: [],
      modules: { mtm: true, "workforce-hrm": false },
    } as never)

    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
    }), params())

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      code: "TENANT_CAPABILITY_DISABLED",
      capabilityId: "workforce-hrm",
    })
    expect(prisma.mtmHrmRequest.findFirst).not.toHaveBeenCalled()
  })

  it("keeps the legacy already-decided response for a terminal replay", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst).mockResolvedValue({
      ...leaveRequest,
      status: "APPROVED",
      decisionNote: "Already approved",
      decidedAt: new Date("2026-07-15T09:00:00.000Z"),
    } as never)

    const response = await decideHrm(jsonRequest("/api/v1/mtm/operations/hrm/hrm-1/decision", {
      decision: "APPROVED",
      note: "A later retry must not rewrite this note",
    }), params())

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_HRM_REQUEST_ALREADY_DECIDED",
      status: "APPROVED",
    })
    expect(prisma.mtmHrmRequest.updateMany).not.toHaveBeenCalled()
  })
})
