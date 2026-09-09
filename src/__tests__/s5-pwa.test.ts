/**
 * S5 PWA — test suite
 *
 * Group A: sendPushToUser server helper (mocked web-push + Prisma)
 *   — module-level state (vapidConfigured) is reset per test via vi.resetModules()
 * Group B: POST/DELETE /api/v1/push/subscribe routes (mocked Prisma + auth)
 * Group C: GET /api/v1/push/vapid-key route (env-based)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Module-level mock refs ───────────────────────────────────────────────────
// These are captured before vi.mock() hoisting so factories can close over them.
const mockSendNotification = vi.fn()
const mockSetVapidDetails = vi.fn()

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: mockSetVapidDetails,
    sendNotification: mockSendNotification,
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    pushSubscription: {
      findMany:   vi.fn(),
      upsert:     vi.fn(),
      create:     vi.fn(),
      deleteMany: vi.fn(),
      delete:     vi.fn(),
      update:     vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn().mockResolvedValue({
    orgId: "org1",
    userId: "user1",
    role: "admin",
    email: "user@example.com",
    name: "User",
  }),
  requireSessionAuth: vi.fn().mockResolvedValue({
    orgId: "org1",
    userId: "user1",
    role: "admin",
    email: "user@example.com",
    name: "User",
  }),
  isAuthError: (value: unknown) => value instanceof Response,
  getOrgId:     vi.fn().mockResolvedValue("org1"),
  orgHasModule: vi.fn().mockResolvedValue(true),
  moduleDisabledResponse: vi.fn((moduleId: string) =>
    Response.json({ error: "Forbidden", moduleId }, { status: 403 })),
}))

vi.mock("@/lib/permissions", () => ({
  checkPermission: vi.fn().mockReturnValue(true),
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" }
    init.body    = JSON.stringify(body)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(url, init as any)
}

// ─── Group A: sendPushToUser ──────────────────────────────────────────────────

describe("sendPushToUser", () => {
  beforeEach(() => {
    vi.resetModules()   // fresh vapidConfigured state for each test
    vi.clearAllMocks()
    process.env.VAPID_PUBLIC_KEY  = "pk_test"
    process.env.VAPID_PRIVATE_KEY = "sk_test"
    process.env.VAPID_SUBJECT     = "mailto:test@example.com"
  })

  afterEach(() => {
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
    delete process.env.VAPID_SUBJECT
  })

  it("returns {sent:0, removed:0} when no subscriptions found", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce([])

    const result = await sendPushToUser("org1", "u1", { title: "Test", body: "Body" })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })

  it("sends to all matching subscriptions and returns correct sent count", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    const subs = [
      { id: "s1", endpoint: "https://ep1", p256dh: "pk1", auth: "ak1" },
      { id: "s2", endpoint: "https://ep2", p256dh: "pk2", auth: "ak2" },
    ]
    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce(subs as any)
    mockSendNotification.mockResolvedValue({})
    vi.mocked(prisma.pushSubscription.update).mockResolvedValue({} as any)

    const result = await sendPushToUser("org1", "u1", { title: "Hello", body: "World" })
    expect(result).toEqual({ sent: 2, removed: 0 })
    expect(mockSendNotification).toHaveBeenCalledTimes(2)
  })

  it("removes expired subscription (HTTP 410) and reports removed count", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce([
      { id: "s1", endpoint: "https://ep1", p256dh: "pk1", auth: "ak1" },
    ] as any)
    const err: any = new Error("Gone")
    err.statusCode = 410
    mockSendNotification.mockRejectedValueOnce(err)
    vi.mocked(prisma.pushSubscription.delete).mockResolvedValue({} as any)

    const result = await sendPushToUser("org1", "u1", { title: "Hi", body: "there" })
    expect(result).toEqual({ sent: 0, removed: 1 })
    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: "s1" } })
  })

  it("removes expired subscription on HTTP 404 as well", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce([
      { id: "s2", endpoint: "https://ep2", p256dh: "pk2", auth: "ak2" },
    ] as any)
    const err: any = new Error("Not Found")
    err.statusCode = 404
    mockSendNotification.mockRejectedValueOnce(err)
    vi.mocked(prisma.pushSubscription.delete).mockResolvedValue({} as any)

    const result = await sendPushToUser("org1", "u1", { title: "T", body: "B" })
    expect(result.removed).toBe(1)
    expect(prisma.pushSubscription.delete).toHaveBeenCalled()
  })

  it("queries all org subscriptions when userId is null", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce([])

    await sendPushToUser("org1", null, { title: "Broadcast", body: "!" })

    expect(prisma.pushSubscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org1" } }),
    )
    // userId key must NOT be present in the where clause
    const call = vi.mocked(prisma.pushSubscription.findMany).mock.calls[0][0] as any
    expect(call.where.userId).toBeUndefined()
  })

  it("queries only specific userId when provided", async () => {
    const { prisma }       = await import("@/lib/prisma")
    const { sendPushToUser } = await import("@/lib/push-send")

    vi.mocked(prisma.pushSubscription.findMany).mockResolvedValueOnce([])

    await sendPushToUser("org1", "u42", { title: "Personal", body: "msg" })

    const call = vi.mocked(prisma.pushSubscription.findMany).mock.calls[0][0] as any
    expect(call.where.userId).toBe("u42")
  })

  it("returns {sent:0, removed:0} when VAPID env vars not configured", async () => {
    // Delete env vars BEFORE importing the fresh module so configureVapid() sees them absent
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY

    const { sendPushToUser } = await import("@/lib/push-send")

    const result = await sendPushToUser("org1", "u1", { title: "Test", body: "Body" })
    expect(result).toEqual({ sent: 0, removed: 0 })
    expect(mockSendNotification).not.toHaveBeenCalled()
  })
})

// ─── Group B: POST/DELETE /api/v1/push/subscribe ─────────────────────────────

describe("POST /api/v1/push/subscribe", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects API-key/mobile-style callers because a push subscription is personal", async () => {
    const { requireSessionAuth } = await import("@/lib/api-auth")
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(requireSessionAuth).mockResolvedValueOnce(
      Response.json({ error: "Unauthorized" }, { status: 401 }) as any,
    )

    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const res = await POST(makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      endpoint: "https://push.example.com/sub/abc",
      keys: { p256dh: "dGVzdA==", auth: "dGVzdA==" },
    }))

    expect(res.status).toBe(401)
    expect(prisma.pushSubscription.deleteMany).not.toHaveBeenCalled()
    expect(prisma.pushSubscription.create).not.toHaveBeenCalled()
  })

  it("returns 200 and subscription id on success", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValueOnce({ count: 0 } as any)
    vi.mocked(prisma.pushSubscription.create).mockResolvedValueOnce({ id: "sub1" } as any)

    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      endpoint: "https://push.example.com/sub/abc",
      keys: { p256dh: "dGVzdA==", auth: "dGVzdA==" },
    })
    const res  = await POST(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.id).toBe("sub1")
  })

  it("returns 400 when endpoint is missing", async () => {
    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      keys: { p256dh: "pk", auth: "ak" },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("returns 400 when keys are missing", async () => {
    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      endpoint: "https://push.example.com/sub/abc",
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it("transfers only an exact endpoint-and-key match before creating fresh", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValueOnce({ count: 1 } as any)
    vi.mocked(prisma.pushSubscription.create).mockResolvedValueOnce({ id: "sub1" } as any)

    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      endpoint: "https://push.example.com/sub/abc",
      keys: { p256dh: "dGVzdA==", auth: "dGVzdA==" },
    })
    await POST(req)

    // Cross-tenant transfer requires proof of the complete browser subscription;
    // an endpoint URL by itself must not delete another user's record.
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        endpoint: "https://push.example.com/sub/abc",
        p256dh: "dGVzdA==",
        auth: "dGVzdA==",
      },
    })
    // The create carries the caller's org so RLS WITH CHECK passes.
    expect(prisma.pushSubscription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: "org1", userId: "user1", endpoint: "https://push.example.com/sub/abc" }),
      }),
    )
    // Ordering: clear BEFORE create.
    const delOrder = vi.mocked(prisma.pushSubscription.deleteMany).mock.invocationCallOrder[0]
    const createOrder = vi.mocked(prisma.pushSubscription.create).mock.invocationCallOrder[0]
    expect(delOrder).toBeLessThan(createOrder)
  })

  it("does not overwrite an endpoint registered with different encryption keys", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValueOnce({ count: 0 } as any)
    const collision: any = new Error("unique endpoint")
    collision.code = "P2002"
    vi.mocked(prisma.pushSubscription.create).mockRejectedValueOnce(collision)

    const { POST } = await import("@/app/api/v1/push/subscribe/route")
    const res = await POST(makeReq("POST", "http://localhost/api/v1/push/subscribe", {
      endpoint: "https://push.example.com/sub/owned-by-someone-else",
      keys: { p256dh: "new-key", auth: "new-auth" },
    }))

    expect(res.status).toBe(409)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        endpoint: "https://push.example.com/sub/owned-by-someone-else",
        p256dh: "new-key",
        auth: "new-auth",
      },
    })
  })
})

describe("DELETE /api/v1/push/subscribe", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 on successful unsubscribe", async () => {
    const { prisma } = await import("@/lib/prisma")
    vi.mocked(prisma.pushSubscription.deleteMany).mockResolvedValueOnce({ count: 1 } as any)

    const { DELETE } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("DELETE", "http://localhost/api/v1/push/subscribe?endpoint=https%3A%2F%2Fpush.example.com%2Fsub%2Fabc")
    const res  = await DELETE(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endpoint: "https://push.example.com/sub/abc",
          userId: "user1",
          organizationId: "org1",
        }),
      }),
    )
  })

  it("returns 400 when endpoint query param is missing", async () => {
    const { DELETE } = await import("@/app/api/v1/push/subscribe/route")
    const req = makeReq("DELETE", "http://localhost/api/v1/push/subscribe")
    const res = await DELETE(req)
    expect(res.status).toBe(400)
  })
})

// ─── Group C: GET /api/v1/push/vapid-key ─────────────────────────────────────

describe("GET /api/v1/push/vapid-key", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 200 with publicKey when VAPID_PUBLIC_KEY is configured", async () => {
    process.env.VAPID_PUBLIC_KEY = "pk_live"

    const { GET } = await import("@/app/api/v1/push/vapid-key/route")
    const req  = makeReq("GET", "http://localhost/api/v1/push/vapid-key")
    const res  = await GET(req)
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.data.publicKey).toBe("pk_live")

    delete process.env.VAPID_PUBLIC_KEY
  })

  it("returns 503 when VAPID_PUBLIC_KEY is not set", async () => {
    const orig = process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PUBLIC_KEY

    const { GET } = await import("@/app/api/v1/push/vapid-key/route")
    const req = makeReq("GET", "http://localhost/api/v1/push/vapid-key")
    const res = await GET(req)

    expect(res.status).toBe(503)

    if (orig) process.env.VAPID_PUBLIC_KEY = orig
  })
})
