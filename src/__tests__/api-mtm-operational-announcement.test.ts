import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", async () => {
  const { makeMtmPrismaMock } = await import("./mocks/mtm-prisma")
  return { prisma: makeMtmPrismaMock() }
})

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (value: unknown) => value instanceof Response,
}))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

vi.mock("@/lib/mtm-audit", () => ({
  writeMtmAudit: vi.fn(() => Promise.resolve()),
}))

import { GET, POST } from "@/app/api/v1/mtm/operational-announcement/route"
import { requireAuth } from "@/lib/api-auth"
import { getMobileAuth, resolveMobileAuth } from "@/lib/mobile-auth"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { prisma } from "@/lib/prisma"

const AUTH = {
  orgId: "org-1",
  agentId: "agent-1",
  userId: "",
  role: "AGENT",
  email: "agent@example.com",
  name: "Aysel",
}

function request(path = "?locale=ru", method = "GET", body?: unknown) {
  return new NextRequest(`http://localhost:3000/api/v1/mtm/operational-announcement${path}`, {
    method,
    headers: {
      authorization: "Bearer mobile-token",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const activeMetadata = {
  keyMessage: true,
  messageId: "message-1",
  threadId: "thread-1",
  effectiveFrom: "2026-07-29T00:00:00.000Z",
  effectiveUntil: "2026-08-05T00:00:00.000Z",
  fallbackBody: "Fallback",
  localizations: { ru: "План изменён", en: "Plan changed" },
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date("2026-07-29T12:00:00.000Z"))
  vi.clearAllMocks()
  vi.mocked(getMobileAuth).mockReturnValue(AUTH as never)
  vi.mocked(resolveMobileAuth).mockResolvedValue(AUTH as never)
  vi.mocked(requireAuth).mockResolvedValue(new Response(null, { status: 401 }) as never)
  vi.mocked(prisma.mtmAgent.findFirst).mockResolvedValue({ id: "agent-1", role: "AGENT" } as never)
  vi.mocked(prisma.mtmSetting.findMany).mockResolvedValue([
    { key: "supportEmail", value: "support@swissmed.example" },
    { key: "supportPhone", value: "+994 12 555 01 01" },
  ] as never)
  vi.mocked(prisma.mtmNotification.findMany).mockResolvedValue([{
    id: "notification-1",
    title: "Important",
    body: "Fallback",
    metadata: activeMetadata,
    createdAt: new Date("2026-07-29T08:00:00.000Z"),
  }] as never)
  vi.mocked(prisma.mtmMessageReceipt.findFirst).mockResolvedValue(null)
  vi.mocked(writeMtmAudit).mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("MTM operational announcement API", () => {
  it("returns 401 when the mobile principal is no longer valid", async () => {
    vi.mocked(resolveMobileAuth).mockResolvedValue(null)

    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(prisma.mtmNotification.findMany).not.toHaveBeenCalled()
  })

  it("returns the localized active message and tenant support to its mobile audience", async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        announcement: {
          messageId: "message-1",
          body: "План изменён",
          acknowledgementRequired: true,
          acknowledgedAt: null,
        },
        support: {
          email: "support@swissmed.example",
          phone: "+994 12 555 01 01",
        },
        timezone: "Asia/Baku",
      },
    })
    expect(requireAuth).not.toHaveBeenCalled()
    expect(prisma.mtmNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: "org-1", agentId: "agent-1", type: "announcement" },
    }))
  })

  it("does not expose an agent announcement to an organization administrator without an agent identity", async () => {
    vi.mocked(getMobileAuth).mockReturnValue(null)
    vi.mocked(requireAuth).mockResolvedValue({
      orgId: "org-1",
      userId: "admin-user",
      role: "admin",
      email: "admin@example.com",
      name: "Admin",
    } as never)

    const response = await GET(new NextRequest(
      "http://localhost:3000/api/v1/mtm/operational-announcement?locale=ru",
    ))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      data: {
        announcement: null,
        support: { email: "support@swissmed.example" },
        timezone: "Asia/Baku",
      },
    })
    expect(prisma.mtmNotification.findMany).not.toHaveBeenCalled()
  })

  it("does not display an expired key message", async () => {
    vi.mocked(prisma.mtmNotification.findMany).mockResolvedValue([{
      id: "notification-old",
      title: "Expired",
      body: "Old",
      metadata: {
        ...activeMetadata,
        effectiveFrom: "2026-07-20T00:00:00.000Z",
        effectiveUntil: "2026-07-28T00:00:00.000Z",
      },
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
    }] as never)

    const response = await GET(request())
    expect(await response.json()).toMatchObject({
      data: { announcement: null },
    })
    expect(prisma.mtmMessageReceipt.findFirst).not.toHaveBeenCalled()
  })

  it("persists an idempotent acknowledgement and writes its audit record", async () => {
    const occurredAt = new Date("2026-07-29T12:00:00.000Z")
    vi.mocked(prisma.mtmMessageReceipt.upsert).mockResolvedValue({ occurredAt } as never)

    const response = await POST(request("", "POST", { messageId: "message-1" }))
    expect(response.status).toBe(200)
    expect(prisma.mtmMessageReceipt.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        messageId_agentId_type: {
          messageId: "message-1",
          agentId: "agent-1",
          type: "ACKNOWLEDGED",
        },
      },
      update: {},
    }))
    expect(writeMtmAudit).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-1",
      agentId: "agent-1",
      action: "OPERATIONAL_ANNOUNCEMENT_ACKNOWLEDGE",
      entityId: "message-1",
    }))
  })

  it("rejects acknowledgement after the active message changes", async () => {
    const response = await POST(request("", "POST", { messageId: "another-message" }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      code: "MTM_OPERATIONAL_ANNOUNCEMENT_EXPIRED",
    })
    expect(prisma.mtmMessageReceipt.upsert).not.toHaveBeenCalled()
  })
})
