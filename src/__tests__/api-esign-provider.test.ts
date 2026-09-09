/**
 * CLM Slice 7d — API tests for:
 *   GET    /api/v1/integrations/esign-provider  (list, creds masked)
 *   POST   /api/v1/integrations/esign-provider  (create/upsert, creds encrypted)
 *   DELETE /api/v1/integrations/esign-provider  (delete, org-scoped)
 *
 * Coverage:
 *   GET:
 *     - Admin can list configs; config column NOT returned (creds masked)
 *     - Non-admin role (e.g. "agent") gets 403
 *     - Unauthenticated → 401 (contracts module gate)
 *
 *   POST:
 *     - Admin can create a docusign config; config encrypted (not plaintext in DB write)
 *     - Response never contains the config/creds field
 *     - Unknown provider → 400
 *     - Missing required docusign fields → 400
 *     - Non-admin role → 403
 *
 *   DELETE:
 *     - Admin can delete own org's config
 *     - Cross-tenant delete → 404
 *     - Missing id param → 400
 *     - Non-admin → 403
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/lib/prisma", () => ({
  prisma: {
    esignProviderConfig: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: (r: unknown) => r && typeof r === "object" && "status" in (r as object),
}))

vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({
  encryptForTenant: vi.fn((orgId: string, plaintext: string) => `ENCRYPTED:${orgId}:${plaintext}`),
  decryptForTenant: vi.fn((orgId: string, cipher: string) => cipher.replace(`ENCRYPTED:${orgId}:`, "")),
}))

import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"
import { encryptForTenant } from "@/lib/crypto/tenant-pii-encryption"
import { GET, POST, DELETE } from "@/app/api/v1/integrations/esign-provider/route"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_SESSION = { orgId: "org1", role: "admin", userId: "user1" }
const AGENT_SESSION = { orgId: "org1", role: "agent", userId: "user1" }

function makeReq(method: string, url = "http://localhost/api/v1/integrations/esign-provider", body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "Content-Type": "application/json" } : {},
  })
}

function mockAuth(session: object) {
  vi.mocked(requireAuth).mockResolvedValue(session as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never)
}

function mockAuth401() {
  const errRes = new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
  vi.mocked(requireAuth).mockResolvedValue(errRes as ReturnType<typeof requireAuth> extends Promise<infer T> ? T : never)
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/v1/integrations/esign-provider", () => {
  it("returns list without config column for admin", async () => {
    mockAuth(ADMIN_SESSION)
    vi.mocked(prisma.esignProviderConfig.findMany).mockResolvedValue([
      { id: "cfg1", provider: "docusign", isActive: true, createdBy: null, createdAt: new Date(), updatedAt: new Date() },
    ] as never)

    const res = await GET(makeReq("GET"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
    // The config (encrypted creds) must NOT be in the response
    expect(json.data[0]).not.toHaveProperty("config")
    expect(json.data[0].provider).toBe("docusign")
  })

  it("returns 403 for non-admin role", async () => {
    mockAuth(AGENT_SESSION)
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(403)
  })

  it("returns 401 when unauthenticated", async () => {
    mockAuth401()
    const res = await GET(makeReq("GET"))
    expect(res.status).toBe(401)
  })
})

// ─── POST ─────────────────────────────────────────────────────────────────────

describe("POST /api/v1/integrations/esign-provider", () => {
  const validDocuSignBody = {
    provider: "docusign",
    creds: {
      clientId: "client-id-1",
      clientSecret: "client-secret-1",
      accountId: "account-id-1",
    },
  }

  it("creates a docusign config with encrypted creds", async () => {
    mockAuth(ADMIN_SESSION)
    vi.mocked(prisma.esignProviderConfig.upsert).mockResolvedValue({
      id: "cfg1",
      provider: "docusign",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const res = await POST(makeReq("POST", undefined, validDocuSignBody))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.success).toBe(true)
    // Creds must NOT be returned in the response
    expect(json.data).not.toHaveProperty("config")
    // encryptForTenant must have been called (creds stored encrypted, not raw JSON)
    expect(encryptForTenant).toHaveBeenCalledWith(
      "org1",
      JSON.stringify(validDocuSignBody.creds)
    )
    // The upsert create.config must use the output of encryptForTenant
    // (not the raw JSON string that was passed in)
    const upsertCall = vi.mocked(prisma.esignProviderConfig.upsert).mock.calls[0][0]
    const rawJson = JSON.stringify(validDocuSignBody.creds)
    // The stored value must NOT be the raw JSON — it must be the output of encryptForTenant
    expect(upsertCall.create.config).not.toBe(rawJson)
    // And it should match the mock's encrypted format
    expect(upsertCall.create.config).toMatch(/^ENCRYPTED:/)
  })

  it("returns 400 for unknown provider", async () => {
    mockAuth(ADMIN_SESSION)
    const res = await POST(makeReq("POST", undefined, { provider: "unknownprovider", creds: {} }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for docusign with missing required creds fields", async () => {
    mockAuth(ADMIN_SESSION)
    const res = await POST(makeReq("POST", undefined, {
      provider: "docusign",
      creds: { clientId: "id-only" }, // missing clientSecret + accountId
    }))
    expect(res.status).toBe(400)
  })

  it("returns 403 for non-admin", async () => {
    mockAuth(AGENT_SESSION)
    const res = await POST(makeReq("POST", undefined, validDocuSignBody))
    expect(res.status).toBe(403)
  })
})

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe("DELETE /api/v1/integrations/esign-provider", () => {
  it("deletes own org's config", async () => {
    mockAuth(ADMIN_SESSION)
    vi.mocked(prisma.esignProviderConfig.findFirst).mockResolvedValue({ id: "cfg1" } as never)
    vi.mocked(prisma.esignProviderConfig.delete).mockResolvedValue({} as never)

    const res = await DELETE(makeReq("DELETE", "http://localhost/api/v1/integrations/esign-provider?id=cfg1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    // Verify org-scope guard was applied
    expect(prisma.esignProviderConfig.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "cfg1", organizationId: "org1" } })
    )
  })

  it("returns 404 for cross-tenant config", async () => {
    mockAuth(ADMIN_SESSION)
    vi.mocked(prisma.esignProviderConfig.findFirst).mockResolvedValue(null)

    const res = await DELETE(makeReq("DELETE", "http://localhost/api/v1/integrations/esign-provider?id=other-org-cfg"))
    expect(res.status).toBe(404)
  })

  it("returns 400 when id missing", async () => {
    mockAuth(ADMIN_SESSION)
    const res = await DELETE(makeReq("DELETE", "http://localhost/api/v1/integrations/esign-provider"))
    expect(res.status).toBe(400)
  })

  it("returns 403 for non-admin", async () => {
    mockAuth(AGENT_SESSION)
    const res = await DELETE(makeReq("DELETE", "http://localhost/api/v1/integrations/esign-provider?id=cfg1"))
    expect(res.status).toBe(403)
  })
})
