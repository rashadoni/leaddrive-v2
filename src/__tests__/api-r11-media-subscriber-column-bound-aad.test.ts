/**
 * Phase 7 slice-3 — R11 Media subscribers wired to the column-bound
 * AAD helpers. Pattern parallels R8 PR-1/PR-2 tests. R11 is the
 * smallest entity in the sweep: 1 PII column (`displayName`).
 *
 * Strategy: mock the entire encryption module. Each helper is a spy.
 * Assert calls to bound helpers with the `(media_subscribers,
 * "displayName")` tuple, and assert the legacy helpers are NOT
 * called on the new paths.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const ORG = "org-test-r11"
const TEST_KEK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

beforeEach(() => {
  process.env.TENANT_PII_MASTER_KEY = TEST_KEK
  vi.resetModules()
  vi.clearAllMocks()
})

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mediaSubscriber: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockReturnValue(false),
}))

vi.mock("@/lib/media/state-machine", () => ({
  transitionSubscriber: vi.fn().mockImplementation(
    (_existing: unknown, target: string) => ({ ok: true, next: target }),
  ),
}))

vi.mock("@/lib/audit/compliance-audit", () => ({
  recordPiiAccessFromRequest: vi.fn(),
  recordPiiAccess: vi.fn(),
}))

vi.mock("@/lib/crypto/tenant-pii-encryption", () => ({
  encryptForTenant: vi.fn((_orgId: string, v: string) => `LEGACY:${v}`),
  encryptForTenantOrNull: vi.fn((_orgId: string, v: string | null) =>
    v == null || v === "" ? null : `LEGACY:${v}`,
  ),
  softDecryptForTenant: vi.fn((_orgId: string, v: string | null) =>
    v == null ? null : v.replace(/^LEGACY:|^BOUND:[^:]+:[^:]+:/, ""),
  ),
  decryptForTenant: vi.fn((_orgId: string, v: string) =>
    v.replace(/^LEGACY:|^BOUND:[^:]+:[^:]+:/, ""),
  ),
  encryptForTenantBound: vi.fn(
    (_orgId: string, table: string, column: string, v: string) =>
      `BOUND:${table}:${column}:${v}`,
  ),
  encryptForTenantBoundOrNull: vi.fn(
    (_orgId: string, table: string, column: string, v: string | null) =>
      v == null || v === "" ? null : `BOUND:${table}:${column}:${v}`,
  ),
  softDecryptForTenantBound: vi.fn(
    (
      _orgId: string,
      _table: string,
      _column: string,
      v: string | null,
    ) => (v == null ? null : v.replace(/^BOUND:[^:]+:[^:]+:|^LEGACY:/, "")),
  ),
  blindIndexForTenant: vi.fn(
    (_orgId: string, v: string | null) =>
      v == null || v === "" ? null : `bi:${v}`,
  ),
  normalizeForBlindIndex: vi.fn((v: string) => v.toLowerCase().trim()),
}))

function makeReq(url: string, method: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("Phase 7 slice-3 — media-subscribers POST uses column-bound AAD", () => {
  it("displayName encrypted via encryptForTenantBound with right tuple; legacy NOT called", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.mediaSubscriber.create).mockImplementation(
      async (args: { data: Record<string, unknown> }) =>
        ({
          id: "s-1",
          subscriberNumber: args.data.subscriberNumber,
          displayName: args.data.displayName,
          email: null,
          tierSlug: args.data.tierSlug ?? "free",
          billingRegion: null,
          status: "trial",
          trialStartedAt: new Date(),
          createdAt: new Date(),
        }) as never,
    )

    const { POST } = await import("@/app/api/v1/media-subscribers/route")
    const res = await POST(
      makeReq("/api/v1/media-subscribers", "POST", {
        subscriberNumber: "SUB-1",
        displayName: "Charlie Subscriber",
      }),
    )
    expect(res.status).toBe(201)

    expect(enc.encryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "media_subscribers",
      "displayName",
      "Charlie Subscriber",
    )
    expect(enc.encryptForTenant).not.toHaveBeenCalled()
  })
})

describe("Phase 7 slice-3 — media-subscribers GET [id] uses column-bound soft-decrypt", () => {
  it("displayName decrypted via softDecryptForTenantBound with right tuple; legacy NOT called", async () => {
    const { prisma } = await import("@/lib/prisma")
    const { requireAuth } = await import("@/lib/api-auth")
    const enc = await import("@/lib/crypto/tenant-pii-encryption")

    vi.mocked(requireAuth).mockResolvedValue({
      orgId: ORG,
      userId: "u-1",
      role: "admin",
    } as never)
    vi.mocked(prisma.mediaSubscriber.findFirst).mockResolvedValue({
      id: "s-1",
      organizationId: ORG,
      subscriberNumber: "SUB-1",
      displayName: "BOUND:media_subscribers:displayName:Charlie",
      email: null,
      tierSlug: "free",
      billingRegion: null,
      status: "trial",
      trialStartedAt: new Date(),
      activatedAt: null,
      cancelledAt: null,
      expiredAt: null,
      contactId: null,
      userId: null,
      subscriptionId: null,
      lifetimeRevenueCents: BigInt(0),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never)

    const { GET } = await import("@/app/api/v1/media-subscribers/[id]/route")
    const res = await GET(
      new NextRequest("http://localhost/api/v1/media-subscribers/s-1"),
      { params: Promise.resolve({ id: "s-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.subscriber.displayName).toBe("Charlie")

    expect(enc.softDecryptForTenantBound).toHaveBeenCalledWith(
      ORG,
      "media_subscribers",
      "displayName",
      "BOUND:media_subscribers:displayName:Charlie",
    )
    expect(enc.softDecryptForTenant).not.toHaveBeenCalled()
  })
})
