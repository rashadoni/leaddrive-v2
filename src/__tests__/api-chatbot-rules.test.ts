import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatbotRule: {
      findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn(),
      updateMany: vi.fn(), deleteMany: vi.fn(),
    },
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

import { GET, POST } from "@/app/api/v1/inbox/chatbot-rules/route"
import { PATCH, DELETE } from "@/app/api/v1/inbox/chatbot-rules/[id]/route"
import { getSession } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

const fn = (x: unknown) => x as ReturnType<typeof vi.fn>
const authed = () => fn(getSession).mockResolvedValue({
  orgId: "org_1", userId: "user_1", role: "support",
  email: "support@example.test", name: "Support",
})
const post = (b: unknown) => new NextRequest("http://localhost/api/v1/inbox/chatbot-rules", { method: "POST", body: JSON.stringify(b) })
const patch = (b: unknown) => new NextRequest("http://localhost/x", { method: "PATCH", body: JSON.stringify(b) })
const del = () => new NextRequest("http://localhost/x", { method: "DELETE" })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

describe("chatbot-rules API — auth + validation", () => {
  beforeEach(() => vi.clearAllMocks())

  it("GET 401 without a session", async () => {
    fn(getSession).mockResolvedValue(null)
    expect((await GET(new NextRequest("http://localhost/x"))).status).toBe(401)
  })

  it("GET scopes findMany to the org", async () => {
    authed(); fn(prisma.chatbotRule.findMany).mockResolvedValue([])
    await GET(new NextRequest("http://localhost/x"))
    expect(prisma.chatbotRule.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: "org_1" } }))
  })

  it("POST 400 on missing name / responseText", async () => {
    authed()
    expect((await POST(post({ responseText: "hi" }))).status).toBe(400)
    expect((await POST(post({ name: "R" }))).status).toBe(400)
  })

  it("POST 400 on invalid triggerType", async () => {
    authed()
    expect((await POST(post({ name: "R", responseText: "hi", triggerType: "regex" }))).status).toBe(400)
  })

  it("POST 400 when a non-always trigger has no triggerValue", async () => {
    authed()
    expect((await POST(post({ name: "R", responseText: "hi", triggerType: "contains" }))).status).toBe(400)
  })

  it("POST 400 on an unknown channel", async () => {
    authed()
    expect((await POST(post({ name: "R", responseText: "hi", triggerType: "always", channelTypes: ["pigeon"] }))).status).toBe(400)
  })

  it("POST 400 on a non-integer priority (mirrors PATCH; no silent coerce-to-0)", async () => {
    authed()
    expect((await POST(post({ name: "R", responseText: "hi", triggerType: "always", priority: 2.5 }))).status).toBe(400)
    expect((await POST(post({ name: "R", responseText: "hi", triggerType: "always", priority: "3" }))).status).toBe(400)
  })

  it("POST 201 — org-scoped, trims, nulls 'always' value, records createdBy", async () => {
    authed(); fn(prisma.chatbotRule.create).mockImplementation((a: { data: unknown }) => ({ id: "new", ...(a.data as object) }))
    const res = await POST(post({ name: "  Greeter ", responseText: " Hi ", triggerType: "always", triggerValue: "ignored", priority: 3 }))
    expect(res.status).toBe(201)
    const data = fn(prisma.chatbotRule.create).mock.calls[0][0].data
    expect(data).toMatchObject({
      organizationId: "org_1", name: "Greeter", responseText: "Hi",
      triggerType: "always", triggerValue: null, priority: 3, createdBy: "user_1",
    })
  })

  it("PATCH 404 on another org's rule — no write (cross-tenant guard)", async () => {
    authed(); fn(prisma.chatbotRule.findFirst).mockResolvedValue(null)
    const res = await PATCH(patch({ name: "x" }), params("other-org-rule"))
    expect(res.status).toBe(404)
    expect(prisma.chatbotRule.updateMany).not.toHaveBeenCalled()
  })

  it("PATCH 400 when switching to a value-needing trigger with no value (existing had none)", async () => {
    authed(); fn(prisma.chatbotRule.findFirst).mockResolvedValue({ id: "r", organizationId: "org_1", triggerType: "always", triggerValue: null })
    expect((await PATCH(patch({ triggerType: "contains" }), params("r"))).status).toBe(400)
  })

  it("PATCH 200 — org-scoped updateMany", async () => {
    authed()
    fn(prisma.chatbotRule.findFirst).mockResolvedValue({ id: "r", organizationId: "org_1", triggerType: "always", triggerValue: null })
    fn(prisma.chatbotRule.updateMany).mockResolvedValue({ count: 1 })
    const res = await PATCH(patch({ status: "active" }), params("r"))
    expect(res.status).toBe(200)
    expect(prisma.chatbotRule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "r", organizationId: "org_1" } }))
  })

  it("DELETE 404 when nothing in this org matched", async () => {
    authed(); fn(prisma.chatbotRule.deleteMany).mockResolvedValue({ count: 0 })
    expect((await DELETE(del(), params("r"))).status).toBe(404)
  })

  it("DELETE 200 — org-scoped", async () => {
    authed(); fn(prisma.chatbotRule.deleteMany).mockResolvedValue({ count: 1 })
    const res = await DELETE(del(), params("r"))
    expect(res.status).toBe(200)
    expect(prisma.chatbotRule.deleteMany).toHaveBeenCalledWith({ where: { id: "r", organizationId: "org_1" } })
  })
})
