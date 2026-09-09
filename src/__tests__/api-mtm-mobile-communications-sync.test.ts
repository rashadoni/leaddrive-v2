import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { POST } from "@/app/api/v1/mtm/mobile/sync/push/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

const ORG = "org-1"
const AGENT = "agent-1"
const NOW = new Date("2026-07-16T10:00:00.000Z")

function request(operation: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/v1/mtm/mobile/sync/push", {
    method: "POST",
    headers: { Authorization: "Bearer mobile", "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "device-1", operations: [operation] }),
  })
}

describe("MTM communication, document, and HRM sync", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: ORG, agentId: AGENT, name: "Aysel", role: "AGENT" } as never)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({
      id: ORG,
      plan: "enterprise",
      addons: [],
      features: ["mtm"],
      modules: { mtm: true },
    } as never)
    vi.mocked(prisma.mtmSyncOperation.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmSyncOperation.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmSyncOperation.create).mockResolvedValue({} as never)
  })

  afterEach(() => vi.useRealTimers())

  it("creates or reuses one direct thread and pins the message atomically", async () => {
    vi.mocked(prisma.mtmMessage.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmAgent.findFirst)
      .mockResolvedValueOnce({ id: AGENT, managerId: "manager-1", teamId: "team-1" } as never)
      .mockResolvedValueOnce({ id: "manager-1", managerId: null, teamId: "team-1" } as never)
    vi.mocked(prisma.mtmMessageThread.upsert).mockResolvedValue({
      id: "thread-1",
      type: "DIRECT",
      lastMessageAt: new Date("2026-07-16T09:00:00.000Z"),
    } as never)
    vi.mocked(prisma.mtmMessage.create).mockResolvedValue({
      id: "message-1",
      threadId: "thread-1",
      senderAgentId: AGENT,
      senderName: "Aysel",
      clientMessageId: "message-client-1",
      body: "Hello",
      sentAt: NOW,
      attachmentDocument: null,
    } as never)

    const response = await POST(request({
      operationId: "operation-message-1",
      op: "create",
      entity: "messages",
      data: {
        recipientAgentId: "manager-1",
        clientMessageId: "message-client-1",
        body: "Hello",
        sentAt: NOW.toISOString(),
      },
      clientTimestamp: NOW.getTime(),
    }))
    const body = await response.json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "message-1" })
    expect(prisma.mtmMessageThread.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_directKey: { organizationId: ORG, directKey: "agent-1:manager-1" } },
    }))
    expect(prisma.mtmMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: ORG, senderAgentId: AGENT, clientMessageId: "message-client-1" }),
    }))
    expect(prisma.mtmSyncOperation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entity: "messages", status: "ok" }),
    }))
  })

  it("acknowledges a broadcast and also advances read state", async () => {
    vi.mocked(prisma.mtmMessageReceipt.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.mtmMessage.findFirst).mockResolvedValue({
      id: "message-1",
      threadId: "thread-1",
      senderAgentId: "manager-1",
      acknowledgementRequired: true,
    } as never)
    vi.mocked(prisma.mtmMessageReceipt.upsert).mockResolvedValue({
      id: "receipt-1",
      messageId: "message-1",
      type: "ACKNOWLEDGED",
      occurredAt: NOW,
    } as never)

    const body = await (await POST(request({
      operationId: "operation-receipt-1",
      op: "create",
      entity: "messageReceipts",
      data: {
        messageId: "message-1",
        type: "ACKNOWLEDGED",
        clientReceiptId: "receipt-client-1",
        occurredAt: NOW.toISOString(),
      },
      clientTimestamp: NOW.getTime(),
    }))).json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "receipt-1" })
    expect(prisma.mtmMessageReceipt.upsert).toHaveBeenCalledTimes(2)
    expect(prisma.mtmMessageParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, threadId: "thread-1", agentId: AGENT }),
    }))
  })

  it("records assigned-document state without granting access to other documents", async () => {
    vi.mocked(prisma.mtmDocumentAssignment.findFirst).mockResolvedValue({
      id: "assignment-1",
      readAt: null,
      downloadedAt: null,
    } as never)
    vi.mocked(prisma.mtmDocumentAssignment.update).mockResolvedValue({
      id: "assignment-1",
      documentId: "document-1",
      readAt: NOW,
      downloadedAt: null,
    } as never)

    const body = await (await POST(request({
      operationId: "operation-document-state-1",
      op: "update",
      entity: "documentStates",
      data: { documentId: "document-1", state: "READ", occurredAt: NOW.toISOString() },
      clientTimestamp: NOW.getTime(),
    }))).json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "assignment-1" })
    expect(prisma.mtmDocumentAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: ORG, documentId: "document-1", agentId: AGENT }),
    }))
  })

  it("creates a non-overlapping leave request with its durable client id", async () => {
    vi.mocked(prisma.mtmHrmRequest.findFirst)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
    vi.mocked(prisma.mtmHrmRequest.create).mockResolvedValue({
      id: "request-1",
      clientRequestId: "request-client-1",
      type: "LEAVE",
      status: "PENDING",
      startDate: new Date("2026-07-20T00:00:00.000Z"),
      endDate: new Date("2026-07-24T00:00:00.000Z"),
      correctionWorkdayId: null,
      requestedStartAt: null,
      requestedEndAt: null,
      reason: "Annual leave",
      submittedAt: NOW,
    } as never)

    const body = await (await POST(request({
      operationId: "operation-hrm-1",
      op: "create",
      entity: "hrmRequests",
      data: {
        id: "request-1",
        clientRequestId: "request-client-1",
        type: "LEAVE",
        startDate: "2026-07-20",
        endDate: "2026-07-24",
        reason: "Annual leave",
        submittedAt: NOW.toISOString(),
      },
      clientTimestamp: NOW.getTime(),
    }))).json()

    expect(body.results[0]).toMatchObject({ status: "ok", serverId: "request-1" })
    expect(prisma.mtmHrmRequest.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        organizationId: ORG,
        agentId: AGENT,
        clientRequestId: "request-client-1",
        status: "PENDING",
      }),
    }))
  })
})
