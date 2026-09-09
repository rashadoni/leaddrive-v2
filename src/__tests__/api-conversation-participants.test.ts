import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

// Conversation collaborators (internal participants — model B). Security-critical surface: org scope +
// cross-tenant user guard (mirrors the assignedTo guard), idempotent no-limit add, org-scoped delete.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), findMany: vi.fn() },
    conversationParticipant: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  const authorize = async (req: NextRequest) => {
    const session = await getSession(req)
    return session ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  }
  return {
    getSession,
    requireAuth: authorize,
    requireSessionAuth: authorize,
    isAuthError: (value: unknown) => value instanceof Response,
  }
})
vi.mock("@/lib/inbox-ensure-conversation", () => ({ ensureConversation: vi.fn() }))

import { GET, POST } from "@/app/api/v1/inbox/conversations/[id]/participants/route"
import { DELETE } from "@/app/api/v1/inbox/conversations/[id]/participants/[userId]/route"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"
import { ensureConversation } from "@/lib/inbox-ensure-conversation"

const SESSION = { orgId: "org1", userId: "u1", role: "admin", email: "", name: "" }
const req = (body?: object): NextRequest => ({ json: async () => body ?? {} }) as unknown as NextRequest
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue(SESSION as never)
})

describe("conversation participants API (collaborators, model B)", () => {
  it("POST → 401 when no session", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never)
    expect((await POST(req({ userId: "u2" }), params({ id: "c1" }))).status).toBe(401)
  })

  it("POST → 400 when userId missing", async () => {
    expect((await POST(req({}), params({ id: "c1" }))).status).toBe(400)
  })

  it("POST → 404 when the conversation is not in the caller's org", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u2" } as never) // member check passes first
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue(null as never)
    expect((await POST(req({ userId: "u2" }), params({ id: "c1" }))).status).toBe(404)
  })

  it("POST id=new → ensure-creates a conversation, then attaches the participant ([P3])", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u2" } as never)
    vi.mocked(ensureConversation).mockResolvedValue({ id: "scNew" } as never)
    vi.mocked(prisma.conversationParticipant.upsert).mockResolvedValue({ id: "p1" } as never)
    const res = await POST(
      req({ userId: "u2", channel: "email", contactEmail: "a@b.com", messageIds: ["m1"] }),
      params({ id: "new" }),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(ensureConversation).toHaveBeenCalledWith("org1", expect.objectContaining({ channel: "email", contactEmail: "a@b.com", messageIds: ["m1"] }))
    expect(prisma.conversationParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ socialConversationId: "scNew" }) }),
    )
    expect(json.socialConversationId).toBe("scNew")
    expect(prisma.socialConversation.findFirst).not.toHaveBeenCalled() // id=new skips the existing-conv lookup
  })

  it("POST → 400 when the user is not in the caller's org (cross-tenant guard), no write", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "c1" } as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null as never)
    const res = await POST(req({ userId: "evil" }), params({ id: "c1" }))
    expect(res.status).toBe(400)
    expect(prisma.conversationParticipant.upsert).not.toHaveBeenCalled()
  })

  it("POST → adds an org-scoped participant (idempotent upsert, no limit)", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "c1" } as never)
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u2" } as never)
    vi.mocked(prisma.conversationParticipant.upsert).mockResolvedValue({ id: "p1" } as never)
    const res = await POST(req({ userId: "u2" }), params({ id: "c1" }))
    expect(res.status).toBe(200)
    expect(prisma.conversationParticipant.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { socialConversationId_userId: { socialConversationId: "c1", userId: "u2" } },
        create: expect.objectContaining({ organizationId: "org1", socialConversationId: "c1", userId: "u2", addedBy: "u1" }),
      }),
    )
  })

  it("DELETE → removes a participant, org-scoped", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "c1" } as never)
    vi.mocked(prisma.conversationParticipant.deleteMany).mockResolvedValue({ count: 1 } as never)
    const res = await DELETE(req(), params({ id: "c1", userId: "u2" }))
    expect(res.status).toBe(200)
    expect(prisma.conversationParticipant.deleteMany).toHaveBeenCalledWith({
      where: { socialConversationId: "c1", userId: "u2", organizationId: "org1" },
    })
  })

  it("GET → lists participants decorated with user objects", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({ id: "c1" } as never)
    vi.mocked(prisma.conversationParticipant.findMany).mockResolvedValue([
      { id: "p1", userId: "u2", socialConversationId: "c1", organizationId: "org1", addedBy: "u1" },
    ] as never)
    vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: "u2", name: "Bob", email: "bob@x.com" }] as never)
    const res = await GET(req(), params({ id: "c1" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data[0].user).toEqual({ id: "u2", name: "Bob", email: "bob@x.com" })
  })
})
