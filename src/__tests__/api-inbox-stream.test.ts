import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// The SSE stream route authenticates via getOrgId (cookie/session) — EventSource
// can't set headers, so this gate is the only thing standing between an
// unauthenticated client and the org's message signature. Assert it holds.
vi.mock("@/lib/prisma", () => ({
  prisma: { channelMessage: { aggregate: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => {
  const getOrgId = vi.fn()
  return {
    getOrgId,
    getSession: vi.fn().mockResolvedValue(null),
    requireAuth: vi.fn(async (req: NextRequest) => {
      const orgId = await getOrgId(req)
      return orgId
        ? { orgId, userId: "support-1", role: "support", email: "", name: "" }
        : new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    }),
    isAuthError: (value: unknown) => value instanceof Response,
  }
})

import { GET } from "@/app/api/v1/inbox/stream/route"
import { getOrgId } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

describe("GET /api/v1/inbox/stream — auth gate", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when there is no authenticated org (no session cookie)", async () => {
    ;(getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/stream"))
    expect(res.status).toBe(401)
    // No stream/poll should have started — the aggregate must not be touched.
    expect((prisma.channelMessage.aggregate as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled()
  })

  it("opens an event-stream for an authed org; cancel() tears it down", async () => {
    ;(getOrgId as ReturnType<typeof vi.fn>).mockResolvedValue("org_1")
    ;(prisma.channelMessage.aggregate as ReturnType<typeof vi.fn>).mockResolvedValue({
      _count: { _all: 0 }, _max: { createdAt: null },
    })
    const res = await GET(new NextRequest("http://localhost/api/v1/inbox/stream"))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    expect(res.headers.get("x-accel-buffering")).toBe("no")
    // Cancel triggers the ReadableStream cancel() → clears the poll + heartbeat
    // intervals, so the test leaves no live timers.
    await res.body?.cancel()
  })
})
