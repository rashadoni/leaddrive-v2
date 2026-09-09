import { describe, it, expect, vi, beforeEach } from "vitest"

// Bulk inbox actions — a thin batch over executeConversationAction (the action
// layer is unit-tested in its own suite, so it is mocked here) + direct
// updateMany writes. Pattern mirrors api-deals-bulk.test.ts.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    channelMessage: { findFirst: vi.fn().mockResolvedValue(null) },
    webChatSession: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    webChatMessage: { create: vi.fn().mockResolvedValue({ id: "wm-1" }) },
    user: { findFirst: vi.fn() },
    inboxFolder: { findFirst: vi.fn(), create: vi.fn() },
    contact: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    $executeRaw: vi.fn().mockResolvedValue(0),
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => {
  const requireAuth = vi.fn()
  return {
    requireAuth,
    requireSessionAuth: requireAuth,
    isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof Response),
  }
})

vi.mock("@/lib/inbox/conversation-actions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/inbox/conversation-actions")>("@/lib/inbox/conversation-actions")
  return { ...actual, executeConversationAction: vi.fn() }
})

vi.mock("@/lib/inbox-ensure-conversation", () => ({
  ensureConversation: vi.fn().mockResolvedValue({ id: "sc-ensured", assignedTo: null, wasCreated: true }),
}))

vi.mock("@/lib/inbox/customer-stage", () => ({
  setCustomerStage: vi.fn().mockResolvedValue({ changed: true, previous: null }),
}))

import { POST } from "@/app/api/v1/inbox/conversations/bulk/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { executeConversationAction } from "@/lib/inbox/conversation-actions"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"
import { setCustomerStage } from "@/lib/inbox/customer-stage"

const findConversations = vi.mocked(prisma.socialConversation.findMany)
const findConversationForLedger = vi.mocked(prisma.socialConversation.findFirst)
const updateConversations = vi.mocked(prisma.socialConversation.updateMany)
const findUnresolvedMessage = vi.mocked(prisma.channelMessage.findFirst)
const findSessions = vi.mocked(prisma.webChatSession.findMany)
const updateSessions = vi.mocked(prisma.webChatSession.updateMany)
const createWebChatMessage = vi.mocked(prisma.webChatMessage.create)
const findUser = vi.mocked(prisma.user.findFirst)
const findContacts = vi.mocked(prisma.contact.findMany)
const findFolder = vi.mocked(prisma.inboxFolder.findFirst)
const createFolder = vi.mocked(prisma.inboxFolder.create)
const execAction = vi.mocked(executeConversationAction)
const OPERATION_ID = "00000000-0000-4000-8000-000000000001"
const OTHER_OPERATION_ID = "00000000-0000-4000-8000-000000000002"
const ledgerMetadata = new Map<string, Record<string, unknown>>()
const ledgerVersion = new Map<string, number>()

function makeRequest(body: unknown) {
  return new Request("http://localhost/api/v1/inbox/conversations/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  }) as never
}

function convo(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, contactId: null, contactName: "Aysel", platform: "telegram", externalId: `tg-${id}`,
    channelConfigId: null, lastMessage: "salam", status: "open", assignedTo: null,
    metadata: null, tags: [], ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ledgerMetadata.clear()
  ledgerVersion.clear()
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "u-1", role: "admin" } as never)
  vi.mocked(prisma.$transaction).mockImplementation(async (operation: any) => operation(prisma))
  vi.mocked(prisma.$executeRaw).mockResolvedValue(0 as never)
  findConversations.mockResolvedValue([])
  findConversationForLedger.mockImplementation(async (args: any) => {
    const id = args.where.id as string
    const version = ledgerVersion.get(id) ?? 0
    return {
      metadata: ledgerMetadata.get(id) ?? {},
      updatedAt: new Date(Date.UTC(2026, 7, 13, 0, 0, version)),
    } as never
  })
  findUnresolvedMessage.mockResolvedValue(null)
  findSessions.mockResolvedValue([])
  findContacts.mockResolvedValue([])
  updateConversations.mockImplementation(async (args: any) => {
    if (args.data && Object.prototype.hasOwnProperty.call(args.data, "metadata")) {
      const id = args.where.id as string
      ledgerMetadata.set(id, args.data.metadata as Record<string, unknown>)
      ledgerVersion.set(id, (ledgerVersion.get(id) ?? 0) + 1)
    }
    return { count: 1 } as never
  })
  updateSessions.mockResolvedValue({ count: 1 } as never)
  execAction.mockResolvedValue({ ok: true, action: "send_reply" } as never)
})

describe("POST /api/v1/inbox/conversations/bulk", () => {
  it("rejects more than 50 ids", async () => {
    const res = await POST(makeRequest({ action: "close", ids: Array.from({ length: 51 }, (_, i) => `c${i}`) }))
    expect(res.status).toBe(400)
    expect(updateConversations).not.toHaveBeenCalled()
  })

  it("reports cross-org/unknown ids as not_found without writing", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    const res = await POST(makeRequest({ action: "close", ids: ["c1", "c-foreign"] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.results).toContainEqual({ id: "c-foreign", kind: "conversation", ok: false, error: "not_found" })
    expect(json.data.summary).toMatchObject({ requested: 2, updated: 1, notFound: 1 })
    // the close write targets only the FOUND id
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["c1"] }, organizationId: "org-1" }),
      data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }),
    }))
  })

  it("close without message never calls the send action", async () => {
    findConversations.mockResolvedValue([convo("c1"), convo("c2")] as never)
    const res = await POST(makeRequest({ action: "close", ids: ["c1", "c2"] }))

    expect(res.status).toBe(200)
    expect(execAction).not.toHaveBeenCalled()
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }) }))
  })

  it("requires a client operationId when close includes a farewell", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)

    const res = await POST(makeRequest({ action: "close", ids: ["c1"], message: "bye" }))

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("operationId") })
    expect(execAction).not.toHaveBeenCalled()
    expect(updateConversations).not.toHaveBeenCalled()
  })

  it("maps a won close outcome to the sold customer stage", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)

    const res = await POST(makeRequest({ action: "close", ids: ["c1"], closeOutcome: "won" }))

    expect(res.status).toBe(200)
    expect(setCustomerStage).toHaveBeenCalledWith(prisma, expect.objectContaining({
      organizationId: "org-1",
      conversationId: "c1",
      stage: "sold",
      source: "system",
      changedBy: "u-1",
    }))
  })

  it("close with message sends the farewell through the action layer BEFORE closing", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    const order: string[] = []
    execAction.mockImplementation(async () => { order.push("send"); return { ok: true, action: "send_reply" } as never })
    updateConversations.mockImplementation(async (args: any) => {
      if (args.data && Object.prototype.hasOwnProperty.call(args.data, "metadata")) {
        const id = args.where.id as string
        ledgerMetadata.set(id, args.data.metadata as Record<string, unknown>)
        ledgerVersion.set(id, (ledgerVersion.get(id) ?? 0) + 1)
      } else {
        order.push("close")
      }
      return { count: 1 } as never
    })

    const res = await POST(makeRequest({
      action: "close",
      ids: ["c1"],
      message: "Спасибо за обращение!",
      operationId: OPERATION_ID,
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(execAction).toHaveBeenCalledWith(
      { type: "send_reply", config: { text: "Спасибо за обращение!" } },
      expect.objectContaining({ organizationId: "org-1", conversationId: "c1", actorUserId: "u-1" }),
    )
    expect(order).toEqual(["send", "close"])
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "c1", ok: true, sent: true }))
  })

  it("a failed farewell still closes the conversation and reports sent:false", async () => {
    findConversations.mockResolvedValue([convo("c1"), convo("c2")] as never)
    execAction.mockImplementation(async (_action, ctx) =>
      ctx.conversationId === "c1"
        ? ({ ok: false, action: "send_reply", error: "outside_window_no_template" } as never)
        : ({ ok: true, action: "send_reply" } as never),
    )

    const res = await POST(makeRequest({
      action: "close",
      ids: ["c1", "c2"],
      message: "bye",
      operationId: OPERATION_ID,
    }))
    const json = await res.json()

    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "c1", ok: true, sent: false, error: "outside_window_no_template" }))
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "c2", ok: true, sent: true }))
    expect(json.data.summary.sendFailed).toBe(1)
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["c1", "c2"] } }),
      data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }),
    }))
  })

  it("replays the durable result for the same operationId without calling the send action twice", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    const body = { action: "close", ids: ["c1"], message: "bye", operationId: OPERATION_ID }

    const first = await POST(makeRequest(body))
    const second = await POST(makeRequest(body))
    const secondJson = await second.json()

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(execAction).toHaveBeenCalledTimes(1)
    expect(secondJson.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      ok: true,
      sent: true,
      replayed: true,
    }))
  })

  it("does not reuse an operationId for different farewell text", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)

    await POST(makeRequest({ action: "close", ids: ["c1"], message: "first", operationId: OPERATION_ID }))
    const conflict = await POST(makeRequest({ action: "close", ids: ["c1"], message: "changed", operationId: OPERATION_ID }))
    const json = await conflict.json()

    expect(execAction).toHaveBeenCalledTimes(1)
    expect(json.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      sent: false,
      error: "idempotency_conflict",
      replayed: true,
    }))
    expect(json.data.summary).toMatchObject({ sendFailed: 1, deliveryUnknown: 0 })
  })

  it("labels an ambiguous farewell separately and never sends it again", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    execAction.mockResolvedValue({
      ok: false,
      action: "send_reply",
      error: "delivery_unknown",
      detail: { deliveryUnknown: true },
      terminal: true,
    } as never)
    const body = { action: "close", ids: ["c1"], message: "bye", operationId: OPERATION_ID }

    const first = await POST(makeRequest(body))
    const firstJson = await first.json()
    const replay = await POST(makeRequest(body))
    const replayJson = await replay.json()

    expect(firstJson.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      sent: false,
      error: "delivery_unknown",
      deliveryUnknown: true,
    }))
    expect(firstJson.data.summary).toMatchObject({ sendFailed: 0, deliveryUnknown: 1 })
    expect(replayJson.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      sent: false,
      deliveryUnknown: true,
      replayed: true,
    }))
    expect(execAction).toHaveBeenCalledTimes(1)
  })

  it("treats a thrown send as delivery-unknown instead of reporting a false success", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    execAction.mockRejectedValue(new Error("provider response lost"))

    const res = await POST(makeRequest({
      action: "close",
      ids: ["c1"],
      message: "bye",
      operationId: OPERATION_ID,
    }))
    const json = await res.json()

    expect(json.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      sent: false,
      deliveryUnknown: true,
    }))
    expect(json.data.summary).toMatchObject({ sendFailed: 0, deliveryUnknown: 1 })
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "resolved" }),
    }))
  })

  it("does not resend when the provider succeeded but final ledger persistence was lost", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    let metadataWrites = 0
    updateConversations.mockImplementation(async (args: any) => {
      if (args.data && Object.prototype.hasOwnProperty.call(args.data, "metadata")) {
        metadataWrites += 1
        if (metadataWrites === 1) {
          const id = args.where.id as string
          ledgerMetadata.set(id, args.data.metadata as Record<string, unknown>)
          ledgerVersion.set(id, 1)
          return { count: 1 } as never
        }
        return { count: 0 } as never
      }
      return { count: 1 } as never
    })
    const body = { action: "close", ids: ["c1"], message: "bye", operationId: OPERATION_ID }

    const first = await POST(makeRequest(body))
    const firstJson = await first.json()
    const replay = await POST(makeRequest(body))
    const replayJson = await replay.json()

    expect(firstJson.data.results).toContainEqual(expect.objectContaining({ sent: false, deliveryUnknown: true }))
    expect(replayJson.data.results).toContainEqual(expect.objectContaining({ sent: false, deliveryUnknown: true, replayed: true }))
    expect(execAction).toHaveBeenCalledTimes(1)
  })

  it("blocks a new farewell while an earlier ChannelMessage delivery is unresolved", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    findUnresolvedMessage.mockResolvedValue({ id: "m-ambiguous" } as never)

    const res = await POST(makeRequest({
      action: "close",
      ids: ["c1"],
      message: "bye",
      operationId: OTHER_OPERATION_ID,
    }))
    const json = await res.json()

    expect(execAction).not.toHaveBeenCalled()
    expect(json.data.results).toContainEqual(expect.objectContaining({
      id: "c1",
      sent: false,
      deliveryUnknown: true,
    }))
    expect(json.data.summary).toMatchObject({ sendFailed: 0, deliveryUnknown: 1 })
  })

  it("rejects a cross-org assignee with 400", async () => {
    findUser.mockResolvedValue(null as never)
    const res = await POST(makeRequest({ action: "assign", ids: ["c1"], assignedTo: "intruder" }))
    expect(res.status).toBe(400)
    expect(updateConversations).not.toHaveBeenCalled()
  })

  it("validates the folder in-org and moves conversations", async () => {
    findFolder.mockResolvedValue({ id: "f1" } as never)
    findConversations.mockResolvedValue([convo("c1")] as never)
    const res = await POST(makeRequest({ action: "folder", ids: ["c1"], folderId: "f1" }))

    expect(res.status).toBe(200)
    expect(findFolder).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "f1", organizationId: "org-1" },
    }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({ data: { folderId: "f1" } }))
  })

  it("moves a conversation to the system Gözləmədə folder without closing it", async () => {
    findFolder.mockResolvedValue(null as never)
    createFolder.mockResolvedValue({ id: "pending-folder" } as never)
    findConversations.mockResolvedValue([convo("c1")] as never)
    const followUpAt = "2026-07-25T10:00:00.000Z"

    const res = await POST(makeRequest({ action: "pending", ids: ["c1"], followUpAt }))

    expect(res.status).toBe(200)
    expect(createFolder).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ organizationId: "org-1", name: "Gözləmədə" }),
    }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "open",
        closedAt: null,
        closeOutcome: null,
        folderId: "pending-folder",
        snoozedUntil: new Date(followUpAt),
      }),
    }))
  })

  it("web-chat close writes an agent farewell message and closes the session", async () => {
    findSessions.mockResolvedValue([{ id: "ws-1", assignedUserId: null, visitorName: "Guest" }] as never)
    const res = await POST(makeRequest({
      action: "close",
      webChatSessionIds: ["ws-1"],
      message: "bye",
      operationId: OPERATION_ID,
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(createWebChatMessage).toHaveBeenCalledWith({
      data: expect.objectContaining({ sessionId: "ws-1", fromRole: "agent", authorUserId: "u-1", text: "bye" }),
    })
    expect(updateSessions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "ws-1" }),
      data: expect.objectContaining({ status: "closed", closedAt: expect.any(Date) }),
    }))
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "ws-1", kind: "webChatSession", ok: true, sent: true }))
  })

  it("web-chat close replays the same operationId without creating a second message", async () => {
    findSessions.mockResolvedValue([{ id: "ws-1", assignedUserId: null, visitorName: "Guest" }] as never)
    const body = {
      action: "close",
      webChatSessionIds: ["ws-1"],
      message: "bye",
      operationId: OPERATION_ID,
    }

    await POST(makeRequest(body))
    const replay = await POST(makeRequest(body))
    const json = await replay.json()

    expect(createWebChatMessage).toHaveBeenCalledTimes(1)
    expect(json.data.results).toContainEqual(expect.objectContaining({
      id: "ws-1",
      kind: "webChatSession",
      sent: true,
      replayed: true,
    }))
  })

  it("web-chat assign sets assignedUserId and pauses AI", async () => {
    findUser.mockResolvedValue({ id: "u-2" } as never)
    findSessions.mockResolvedValue([{ id: "ws-1", assignedUserId: null, visitorName: null }] as never)
    const res = await POST(makeRequest({ action: "assign", webChatSessionIds: ["ws-1"], assignedTo: "u-2" }))

    expect(res.status).toBe(200)
    expect(updateSessions).toHaveBeenCalledWith(expect.objectContaining({
      data: { assignedUserId: "u-2", aiPaused: true },
    }))
  })

  it("web-chat folder files the session through its ensured w:<sessionId> shell", async () => {
    findFolder.mockResolvedValue({ id: "f1" } as never)
    findSessions.mockResolvedValue([{ id: "ws-1", assignedUserId: null, visitorName: "Guest" }] as never)
    const res = await POST(makeRequest({ action: "folder", webChatSessionIds: ["ws-1"], folderId: "f1" }))

    expect(res.status).toBe(200)
    expect(ensureConversation).toHaveBeenCalledWith("org-1", expect.objectContaining({ webChatSessionId: "ws-1", channel: "web-chat" }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "sc-ensured" }),
      data: { folderId: "f1" },
    }))
  })

  it("web-chat tags are written to the ensured w:<sessionId> shell (not rejected)", async () => {
    findSessions.mockResolvedValue([{ id: "ws-1", assignedUserId: null, visitorName: "Guest" }] as never)
    // second findMany call = the shell tags read
    findConversations.mockResolvedValue([{ id: "sc-ensured", tags: ["vip"] }] as never)

    const res = await POST(makeRequest({ action: "tags", webChatSessionIds: ["ws-1"], tags: ["urgent"] }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(ensureConversation).toHaveBeenCalledWith("org-1", expect.objectContaining({ webChatSessionId: "ws-1" }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "sc-ensured" }),
      data: { tags: expect.arrayContaining(["vip", "urgent"]) },
    }))
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "ws-1", kind: "webChatSession", ok: true }))
  })

  it("close/assign refuse web-chat SHELL conversation ids (session semantics live on WebChatSession)", async () => {
    findConversations.mockResolvedValue([
      convo("sc-shell", { platform: "inbox", externalId: "w:ws-9" }),
      convo("c1"),
    ] as never)

    const res = await POST(makeRequest({ action: "close", ids: ["sc-shell", "c1"] }))
    const json = await res.json()

    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "sc-shell", ok: false, error: "web_chat_session_required" }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["c1"] } }),
      data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }),
    }))
  })

  it("tags union caps the merged set at 25", async () => {
    const existing = Array.from({ length: 20 }, (_, i) => `old${i}`)
    findConversations.mockResolvedValue([convo("c1", { tags: existing })] as never)
    const res = await POST(makeRequest({ action: "tags", ids: ["c1"], tags: Array.from({ length: 10 }, (_, i) => `new${i}`) }))

    expect(res.status).toBe(200)
    const call = updateConversations.mock.calls.find(
      (c: [{ where?: { id?: unknown }; data?: { tags?: string[] } }]) => c[0]?.data?.tags,
    )
    expect(call![0].data!.tags!.length).toBeLessThanOrEqual(25)
  })

  it("tags are UNION-added per conversation and rejected when invalid", async () => {
    findConversations.mockResolvedValue([convo("c1", { tags: ["vip"] })] as never)
    const res = await POST(makeRequest({ action: "tags", ids: ["c1"], tags: ["urgent", "VIP"] }))

    expect(res.status).toBe(200)
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "c1" }),
      data: { tags: expect.arrayContaining(["vip", "urgent"]) },
    }))

    const bad = await POST(makeRequest({ action: "tags", ids: ["c1"], tags: [] }))
    expect(bad.status).toBe(400)
  })

  it("persists the close outcome on both conversation and web-chat session", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    findSessions.mockResolvedValue([{ id: "s1", assignedUserId: null, visitorName: "Visitor" }] as never)

    const res = await POST(makeRequest({ action: "close", ids: ["c1"], webChatSessionIds: ["s1"], closeOutcome: "won" }))
    expect(res.status).toBe(200)
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "resolved", closeOutcome: "won", closedAt: expect.any(Date) }),
    }))
    expect(updateSessions).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "s1" }),
      data: expect.objectContaining({ status: "closed", closeOutcome: "won", closedAt: expect.any(Date) }),
    }))
  })

  it("rejects an unknown close outcome with 400", async () => {
    const res = await POST(makeRequest({ action: "close", ids: ["c1"], closeOutcome: "maybe" }))
    expect(res.status).toBe(400)
    expect(updateConversations).not.toHaveBeenCalled()
  })

  it("omits closeOutcome from the write when none is supplied (stays unclassified)", async () => {
    findConversations.mockResolvedValue([convo("c1")] as never)
    await POST(makeRequest({ action: "close", ids: ["c1"] }))
    const data = updateConversations.mock.calls.at(-1)![0].data as Record<string, unknown>
    expect(data).not.toHaveProperty("closeOutcome")
    expect(data).toMatchObject({ status: "resolved" })
  })
})

describe("threadRefs — каналы без persisted-разговора (WhatsApp/SMS/Telegram/Email)", () => {
  it("материализует thread в shell и закрывает его; результат под ключом клиента", async () => {
    findContacts.mockResolvedValue([{ id: "ct-1" }] as never)
    vi.mocked(ensureConversation).mockResolvedValue({ id: "sc-ensured", assignedTo: null, wasCreated: true })
    findConversations.mockResolvedValue([
      { id: "sc-ensured", contactId: "ct-1", contactName: "Aysel", platform: "inbox", externalId: "c:ct-1",
        channelConfigId: null, lastMessage: "salam", status: "open", assignedTo: null, metadata: { channel: "whatsapp" }, tags: [] },
    ] as never)

    const res = await POST(makeRequest({
      action: "close",
      threadRefs: [{ key: "thread-wa-1", channel: "whatsapp", contactId: "ct-1", contactName: "Aysel", messageIds: ["m1", "m2"] }],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(ensureConversation).toHaveBeenCalledWith("org-1", expect.objectContaining({
      channel: "whatsapp", contactId: "ct-1", messageIds: ["m1", "m2"],
    }))
    expect(updateConversations).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ["sc-ensured"] } }),
      data: expect.objectContaining({ status: "resolved", closedAt: expect.any(Date) }),
    }))
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "thread-wa-1", kind: "thread", ok: true }))
    expect(json.data.summary).toMatchObject({ requested: 1, updated: 1 })
  })

  it("чужой contactId из другого org — not_found, ensure не вызывается", async () => {
    findContacts.mockResolvedValue([] as never)

    const res = await POST(makeRequest({
      action: "assign", assignedTo: null,
      threadRefs: [{ key: "thread-x", channel: "sms", contactId: "ct-foreign", messageIds: [] }],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(ensureConversation).not.toHaveBeenCalled()
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "thread-x", kind: "thread", ok: false, error: "not_found" }))
  })

  it("threadRef без стабильной идентичности отклоняется схемой", async () => {
    const res = await POST(makeRequest({
      action: "tags", tags: ["vip"],
      threadRefs: [{ key: "thread-anon", channel: "email", messageIds: ["m1"] }],
    }))
    expect(res.status).toBe(400)
  })

  it("лимит 50 считает и threadRefs", async () => {
    const res = await POST(makeRequest({
      action: "close",
      ids: Array.from({ length: 30 }, (_, i) => `c${i}`),
      threadRefs: Array.from({ length: 21 }, (_, i) => ({ key: `t${i}`, channel: "sms", contactPhone: `+994${i}`, messageIds: [] })),
    }))
    expect(res.status).toBe(400)
  })

  it("telegram-тред без контакта идёт по telegramChatId", async () => {
    vi.mocked(ensureConversation).mockResolvedValue({ id: "sc-tg", assignedTo: null, wasCreated: true })
    findConversations.mockResolvedValue([
      { id: "sc-tg", contactId: null, contactName: "TG User", platform: "inbox", externalId: "t:12345",
        channelConfigId: null, lastMessage: "salam", status: "open", assignedTo: null, metadata: { channel: "telegram" }, tags: [] },
    ] as never)

    const res = await POST(makeRequest({
      action: "folder", folderId: null,
      threadRefs: [{ key: "thread-tg", channel: "telegram", telegramChatId: "12345", messageIds: ["m9"] }],
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(ensureConversation).toHaveBeenCalledWith("org-1", expect.objectContaining({ telegramChatId: "12345" }))
    expect(json.data.results).toContainEqual(expect.objectContaining({ id: "thread-tg", kind: "thread", ok: true }))
  })
})
