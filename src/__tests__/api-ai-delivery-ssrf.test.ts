import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const mockUpdate = vi.fn()
const mockFindUnique = vi.fn()
const mockSendSlackNotification = vi.fn()

type TestAuth = { orgId: string; userId: string; role: string }
type TestRouteHandler = (req: NextRequest, auth: TestAuth) => unknown

vi.mock("@/lib/with-rls", () => ({
  withRls: (handler: TestRouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
  withRlsAuth: (_module: string, _action: string, handler: TestRouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
  withRlsSessionAuth: (handler: TestRouteHandler) => (req: NextRequest) =>
    handler(req, { orgId: "org-1", userId: "user-1", role: "admin" }),
}))

vi.mock("@/lib/constants", () => ({
  isAdmin: () => true,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    organization: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
    user: {
      findFirst: vi.fn(async () => ({ id: "user-1", email: null, name: "Admin" })),
    },
    notification: {
      create: vi.fn(async () => ({})),
    },
  },
}))

vi.mock("@/lib/slack", () => ({
  sendSlackNotification: mockSendSlackNotification,
}))

function jsonReq(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("ai-delivery Slack webhook SSRF hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue({ name: "Acme", settings: {} })
    mockUpdate.mockResolvedValue({})
    mockSendSlackNotification.mockResolvedValue(true)
  })

  it("rejects unsafe Slack webhook URLs before saving settings", async () => {
    const { PATCH } = await import("@/app/api/v1/settings/ai-delivery/route")

    const res = await PATCH(jsonReq("/api/v1/settings/ai-delivery", {
      slackWebhookUrl: "https://169.254.169.254/latest/meta-data/",
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toContain("IP address literal")
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it("uses the guarded Slack sender for digest test deliveries", async () => {
    const { POST } = await import("@/app/api/v1/digest-subscriptions/test/route")

    mockFindUnique.mockResolvedValue({
      name: "Acme",
      settings: {
        aiDelivery: {
          slackWebhookUrl: "https://hooks.slack.com/services/T/B/x",
        },
      },
    })

    const res = await POST(jsonReq("/api/v1/digest-subscriptions/test", {
      userId: "user-1",
      type: "daily_briefing",
    }))

    expect(res.status).toBe(200)
    expect(mockSendSlackNotification).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/x",
      expect.objectContaining({ text: expect.stringContaining("Daily AI Briefing") }),
    )
  })
})
