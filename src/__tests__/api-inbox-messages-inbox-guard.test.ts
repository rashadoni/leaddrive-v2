import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"

// [P3] — a platform="inbox" SocialConversation is an ensure-created collaborator anchor for an
// email/sms thread, NOT a real send channel. The conversation messages send route must 400 it instead
// of silently no-sending + persisting a phantom channelType:"inbox" outbound row.

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialConversation: { findFirst: vi.fn() },
    channelConfig: { findFirst: vi.fn() },
    channelMessage: { create: vi.fn() },
  },
}))
vi.mock("@/lib/api-auth", () => {
  const getSession = vi.fn()
  return {
    getSession,
    requireSessionAuth: vi.fn(async (req: NextRequest) => {
      const session = await getSession(req)
      return session ?? new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { POST } from "@/app/api/v1/inbox/conversations/[id]/messages/route"
import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/api-auth"

const req = (body: object): NextRequest => ({ json: async () => body }) as unknown as NextRequest
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getSession).mockResolvedValue({
    orgId: "org1", userId: "support-1", role: "support", email: "", name: "",
  } as never)
})

describe("inbox conversation send — platform=inbox guard ([P3])", () => {
  it("400s a platform=inbox anchor + writes NO phantom outbound row", async () => {
    vi.mocked(prisma.socialConversation.findFirst).mockResolvedValue({
      id: "sc1", platform: "inbox", externalId: "e:a@b.com", channelConfigId: null,
    } as never)
    const res = await POST(req({ text: "hi" }), params({ id: "sc1" }))
    expect(res.status).toBe(400)
    expect(prisma.channelMessage.create).not.toHaveBeenCalled()
  })
})
