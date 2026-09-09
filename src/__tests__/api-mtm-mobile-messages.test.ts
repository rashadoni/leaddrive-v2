import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

import { GET as listMessages } from "@/app/api/v1/mtm/mobile/messages/route"
import { GET as getThread } from "@/app/api/v1/mtm/mobile/messages/[threadId]/route"
import { prisma } from "@/lib/prisma"
import { resolveMobileAuth } from "@/lib/mobile-auth"

function request(path = "/api/v1/mtm/mobile/messages") {
  return new NextRequest(`http://localhost${path}`, { headers: { Authorization: "Bearer mobile" } })
}

describe("MTM mobile messages API", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMobileAuth).mockResolvedValue({ orgId: "org-1", agentId: "agent-1", name: "Aysel" } as never)
    vi.mocked(prisma.mtmMessageParticipant.findMany).mockResolvedValue([])
    vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", managerId: "manager-1", teamId: "team-1" } as never)
    vi.mocked(prisma.mtmAgent.findMany).mockResolvedValue([])
  })

  it("scopes the inbox to the authenticated participant", async () => {
    const response = await listMessages(request())
    expect(response.status).toBe(200)
    const args = vi.mocked(prisma.mtmMessageParticipant.findMany).mock.calls[0][0] as any
    expect(args.where).toEqual({ organizationId: "org-1", agentId: "agent-1", archivedAt: null })
  })

  it("derives unread and acknowledgement state without exposing storage keys", async () => {
    vi.mocked(prisma.mtmMessageParticipant.findMany).mockResolvedValue([{
      id: "membership-1",
      lastReadAt: null,
      thread: {
        id: "thread-1",
        type: "BROADCAST",
        subject: "Cycle meeting",
        lastMessageAt: new Date("2026-07-16T09:00:00.000Z"),
        participants: [{ agentId: "agent-1", role: "MEMBER", agent: { id: "agent-1", name: "Aysel", role: "AGENT", avatar: null } }],
        messages: [{
          id: "message-1",
          senderAgentId: "manager-1",
          senderName: "Manager",
          body: "Please confirm",
          sentAt: new Date("2026-07-16T09:00:00.000Z"),
          acknowledgementRequired: true,
          attachmentDocument: { id: "document-1", fileName: "agenda.pdf", mimeType: "application/pdf", sizeBytes: 1200 },
          receipts: [],
        }],
      },
    }] as never)

    const body = await (await listMessages(request())).json()
    expect(body.data.threads[0]).toMatchObject({ unread: true, needsAcknowledgement: true, title: "Cycle meeting" })
    expect(body.data.threads[0].lastMessage.attachmentDocument).not.toHaveProperty("storageKey")
  })

  it("masks a conversation that is not assigned to the agent", async () => {
    vi.mocked(prisma.mtmMessageParticipant.findFirst).mockResolvedValue(null)
    const response = await getThread(request("/api/v1/mtm/mobile/messages/thread-other"), {
      params: Promise.resolve({ threadId: "thread-other" }),
    })
    expect(response.status).toBe(404)
    const args = vi.mocked(prisma.mtmMessageParticipant.findFirst).mock.calls[0][0] as any
    expect(args.where).toMatchObject({ organizationId: "org-1", agentId: "agent-1", threadId: "thread-other" })
  })
})
