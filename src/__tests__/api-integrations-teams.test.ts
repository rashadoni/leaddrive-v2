/**
 * Tests for /api/v1/integrations/teams route — CLM Slice 7a (hardened)
 *
 * Covers:
 *   GET    — list org's Teams configs (org-scoped), requireAuth read
 *   POST   — create a Teams config (admin-gate + SSRF guard)
 *   POST   — test a webhook URL (action:"test", SSRF guard)
 *   PUT    — update a Teams config (admin-gate + strict schema + scoped read)
 *   PUT    — organizationId in body is ignored (can't move org)
 *   PUT    — foreign id → 404
 *   DELETE — delete a Teams config, admin-gate
 *   Admin-gate: viewer → 403 on write operations
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany:   vi.fn(),
      create:     vi.fn(),
      updateMany: vi.fn(),
      findFirst:  vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r && typeof r === "object" && "status" in (r as object),
}))

vi.mock("@/lib/integrations/teams", () => ({
  sendTeamsNotification: vi.fn().mockResolvedValue(true),
}))

// Guard module is real — it must throw on bad URLs
// (no mock — we test actual SSRF rejection via the route)

import { GET, POST, PUT, DELETE } from "@/app/api/v1/integrations/teams/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { sendTeamsNotification } from "@/lib/integrations/teams"
import { NextResponse } from "next/server"

const mockRequireAuth = requireAuth as ReturnType<typeof vi.fn>
const mockFindMany    = prisma.channelConfig.findMany  as ReturnType<typeof vi.fn>
const mockCreate      = prisma.channelConfig.create    as ReturnType<typeof vi.fn>
const mockUpdateMany  = prisma.channelConfig.updateMany as ReturnType<typeof vi.fn>
const mockFindFirst   = prisma.channelConfig.findFirst  as ReturnType<typeof vi.fn>
const mockDeleteMany  = prisma.channelConfig.deleteMany as ReturnType<typeof vi.fn>
const mockSendTeams   = sendTeamsNotification as ReturnType<typeof vi.fn>

const ORG_ID = "org-123"

/** Helper: build a mock AuthResult for requireAuth */
function mockAuthAs(role: string) {
  mockRequireAuth.mockResolvedValue({ orgId: ORG_ID, userId: "u-1", role, email: "a@b.com", name: "A" })
}

function makeReq(url: string, opts?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(url, opts)
}

function makeJsonReq(url: string, body: unknown, method = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } as ConstructorParameters<typeof NextRequest>[1])
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthAs("admin")
})

// ─── GET ─────────────────────────────────────────────────────────────────────

describe("GET /api/v1/integrations/teams", () => {
  it("returns 401 when requireAuth returns a NextResponse (unauthenticated)", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await GET(makeReq("http://localhost/api/v1/integrations/teams"))
    expect(res.status).toBe(401)
  })

  it("returns org's Teams configs", async () => {
    const configs = [
      { id: "t1", configName: "Sales Team", channelType: "teams", webhookUrl: "https://outlook.office.com/webhook/t1", isActive: true, settings: { contractAlerts: true } },
    ]
    mockFindMany.mockResolvedValue(configs)

    const res = await GET(makeReq("http://localhost/api/v1/integrations/teams"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(configs)
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, channelType: "teams" }),
      }),
    )
  })

  it("returns 403 for viewer role (admin-gate — webhook URLs are bearer secrets)", async () => {
    mockAuthAs("viewer")
    const res = await GET(makeReq("http://localhost/api/v1/integrations/teams"))
    expect(res.status).toBe(403)
  })
})

// ─── POST — create ────────────────────────────────────────────────────────────

describe("POST /api/v1/integrations/teams — create", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X", webhookUrl: "https://outlook.office.com/webhook/abc",
    }))
    expect(res.status).toBe(401)
  })

  it("returns 403 for viewer role (admin-gate)", async () => {
    mockAuthAs("viewer")
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X", webhookUrl: "https://outlook.office.com/webhook/abc",
    }))
    expect(res.status).toBe(403)
  })

  it("returns 403 for sales role (admin-gate)", async () => {
    mockAuthAs("sales")
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X", webhookUrl: "https://outlook.office.com/webhook/abc",
    }))
    expect(res.status).toBe(403)
  })

  it("returns 400 on missing configName", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      webhookUrl: "https://outlook.office.com/webhook/abc",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on invalid webhookUrl format", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X",
      webhookUrl: "not-a-url",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on unsafe webhook URL (SSRF — http://10.0.0.1)", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X",
      webhookUrl: "https://10.0.0.1/hook",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on non-allowlisted host (SSRF — example.com)", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "X",
      webhookUrl: "https://webhook.example.com/hook",
    }))
    expect(res.status).toBe(400)
  })

  it("creates a Teams ChannelConfig with contractAlerts toggle", async () => {
    const created = {
      id: "t1",
      configName: "Sales",
      channelType: "teams",
      webhookUrl: "https://outlook.office.com/webhook/abc",
      isActive: true,
      settings: { contractAlerts: true },
      organizationId: ORG_ID,
    }
    mockCreate.mockResolvedValue(created)

    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      configName: "Sales",
      webhookUrl: "https://outlook.office.com/webhook/abc",
      settings: { contractAlerts: true },
    }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    expect(json.data).toEqual(created)
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          channelType: "teams",
          webhookUrl: "https://outlook.office.com/webhook/abc",
          settings: { contractAlerts: true },
        }),
      }),
    )
  })
})

// ─── POST — test ──────────────────────────────────────────────────────────────

describe("POST /api/v1/integrations/teams — test action", () => {
  it("returns 400 on unsafe test URL (SSRF — localhost)", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      action: "test",
      webhookUrl: "http://localhost/hook",
    }))
    expect(res.status).toBe(400)
  })

  it("returns 400 on unsafe test URL (metadata endpoint)", async () => {
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      action: "test",
      webhookUrl: "https://169.254.169.254/hook",
    }))
    expect(res.status).toBe(400)
  })

  it("returns success when sendTeamsNotification returns true", async () => {
    mockSendTeams.mockResolvedValue(true)
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      action: "test",
      webhookUrl: "https://outlook.office.com/webhook/test",
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockSendTeams).toHaveBeenCalledWith(
      "https://outlook.office.com/webhook/test",
      expect.objectContaining({ summary: expect.stringContaining("test") }),
    )
  })

  it("returns success=false when sendTeamsNotification returns false", async () => {
    mockSendTeams.mockResolvedValue(false)
    const res = await POST(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      action: "test",
      webhookUrl: "https://outlook.office.com/webhook/test",
    }))
    const json = await res.json()

    expect(json.success).toBe(false)
  })
})

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe("PUT /api/v1/integrations/teams", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", { id: "t1" }, "PUT"))
    expect(res.status).toBe(401)
  })

  it("returns 403 for viewer role (admin-gate)", async () => {
    mockAuthAs("viewer")
    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", { id: "t1" }, "PUT"))
    expect(res.status).toBe(403)
  })

  it("returns 400 when id missing", async () => {
    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", {}, "PUT"))
    expect(res.status).toBe(400)
  })

  it("returns 404 when config not found in this org", async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      id: "t-notexist",
      settings: { contractAlerts: true },
    }, "PUT"))
    expect(res.status).toBe(404)
  })

  it("organizationId in body is ignored — cannot move to a different org", async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindFirst.mockResolvedValue({ id: "t1", organizationId: ORG_ID, channelType: "teams" })

    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      id: "t1",
      organizationId: "evil-org-999",
      settings: { contractAlerts: false },
    }, "PUT"))

    // Must succeed (the route ignores organizationId from body)
    expect(res.status).toBe(200)
    // updateMany must ALWAYS use the session orgId, never the body one
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    )
    // data must NOT contain organizationId
    const updateCall = mockUpdateMany.mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty("organizationId")
  })

  it("returns 400 on unsafe webhookUrl in PUT (SSRF guard)", async () => {
    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      id: "t1",
      webhookUrl: "https://10.0.0.1/hook",
    }, "PUT"))
    expect(res.status).toBe(400)
  })

  it("updates contractAlerts toggle successfully", async () => {
    const updated = { id: "t1", settings: { contractAlerts: false }, channelType: "teams", organizationId: ORG_ID }
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindFirst.mockResolvedValue(updated)

    const res = await PUT(makeJsonReq("http://localhost/api/v1/integrations/teams", {
      id: "t1",
      settings: { contractAlerts: false },
    }, "PUT"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "t1", organizationId: ORG_ID, channelType: "teams" }),
      }),
    )
    // post-update read must also be org+channel scoped
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "t1", organizationId: ORG_ID, channelType: "teams" }),
      }),
    )
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/integrations/teams", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireAuth.mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await DELETE(makeReq("http://localhost/api/v1/integrations/teams?id=t1", { method: "DELETE" }))
    expect(res.status).toBe(401)
  })

  it("returns 403 for viewer role (admin-gate)", async () => {
    mockAuthAs("viewer")
    const res = await DELETE(makeReq("http://localhost/api/v1/integrations/teams?id=t1", { method: "DELETE" }))
    expect(res.status).toBe(403)
  })

  it("returns 400 when id missing from query", async () => {
    const res = await DELETE(makeReq("http://localhost/api/v1/integrations/teams", { method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when config not found in this org", async () => {
    mockDeleteMany.mockResolvedValue({ count: 0 })
    const res = await DELETE(makeReq("http://localhost/api/v1/integrations/teams?id=t-notexist", { method: "DELETE" }))
    expect(res.status).toBe(404)
  })

  it("deletes a Teams config successfully", async () => {
    mockDeleteMany.mockResolvedValue({ count: 1 })
    const res = await DELETE(makeReq("http://localhost/api/v1/integrations/teams?id=t1", { method: "DELETE" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("t1")
    expect(mockDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "t1", organizationId: ORG_ID, channelType: "teams" }),
      }),
    )
  })
})
