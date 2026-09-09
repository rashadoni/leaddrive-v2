/**
 * Tests for D5 Payments — /api/v1/payment-providers CRUD routes.
 *
 * Focus: vault guard (P0) that blocks live credentials until NamedCredentials
 * vault is wired (Phase 5 N17). Also covers GET list/detail, POST create,
 * PATCH update, DELETE.
 *
 * No real DB — prisma is fully mocked.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

/* ─── Mocks ─────────────────────────────────────────────────────────── */

vi.mock("@/lib/prisma", () => ({
  prisma: {
    paymentProvider: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}))

vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn((r: unknown) => r instanceof NextResponse),
}))

import { GET as ListProviders, POST as CreateProvider } from "@/app/api/v1/payment-providers/route"
import {
  GET as GetProvider,
  PATCH as UpdateProvider,
  DELETE as DeleteProvider,
} from "@/app/api/v1/payment-providers/[id]/route"
import { requireAuth } from "@/lib/api-auth"
import { prisma } from "@/lib/prisma"

// Typed accessor so tests can configure individual mock methods
const pp = () => vi.mocked(prisma.paymentProvider)

/* ─── Helpers ───────────────────────────────────────────────────────── */

const AUTH_OK = { orgId: "org_1", userId: "user_1" }

function makeReq(url: string, method = "GET", body?: unknown): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3001"), {
    method,
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }
      : {}),
  })
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  vi.clearAllMocks()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(requireAuth).mockResolvedValue(AUTH_OK as any)
})

/* ─── GET list ──────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-providers", () => {
  it("returns provider list", async () => {
    const rows = [
      { id: "p1", type: "stripe", name: "Stripe Test", isActive: true, isTestMode: true, createdAt: new Date(), updatedAt: new Date() },
    ]
    pp().findMany.mockResolvedValue(rows)

    const res = await ListProviders(makeReq("/api/v1/payment-providers"))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.providers).toHaveLength(1)
    expect(json.total).toBe(1)
  })

  it("returns 401 when auth fails", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    )
    const res = await ListProviders(makeReq("/api/v1/payment-providers"))
    expect(res.status).toBe(401)
  })
})

/* ─── GET single ────────────────────────────────────────────────────── */

describe("GET /api/v1/payment-providers/[id]", () => {
  it("returns provider with redacted credentials", async () => {
    pp().findFirst.mockResolvedValue({
      id: "p1",
      type: "stripe",
      name: "Stripe Test",
      isActive: true,
      isTestMode: true,
      credentials: { secretKey: "sk_test_abc123" },
      webhookSecret: "whsec_test_abc",
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const res = await GetProvider(makeReq("/api/v1/payment-providers/p1"), makeParams("p1"))
    const json = await res.json()

    expect(res.status).toBe(200)
    // Secrets must be redacted
    expect(json.provider.credentials.secretKey).toBe("***")
    expect(json.provider.webhookSecret).toBe("***")
  })

  it("returns 404 for unknown provider", async () => {
    pp().findFirst.mockResolvedValue(null)
    const res = await GetProvider(makeReq("/api/v1/payment-providers/nope"), makeParams("nope"))
    expect(res.status).toBe(404)
  })
})

/* ─── POST create — vault guard (P0) ───────────────────────────────── */

describe("POST /api/v1/payment-providers — vault guard", () => {
  it("blocks isTestMode:false (live mode)", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Live",
        isTestMode: false,
        credentials: { secretKey: "sk_test_abc" },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("VAULT_NOT_WIRED")
  })

  it("blocks sk_live_* even when isTestMode is omitted (defaults true)", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Bad",
        credentials: { secretKey: "sk_live_REAL_PRODUCTION_KEY" },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("LIVE_KEY_DETECTED")
  })

  it("blocks pk_live_* in credentials", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Pub Live",
        credentials: { publishableKey: "pk_live_xyz" },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("LIVE_KEY_DETECTED")
  })

  it("blocks rk_live_* in credentials", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Restricted Live",
        credentials: { restrictedKey: "rk_live_abc" },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("LIVE_KEY_DETECTED")
  })

  it("allows sk_test_* credentials with isTestMode:true (default)", async () => {
    const created = {
      id: "p_new",
      type: "stripe",
      name: "Stripe Sandbox",
      isActive: true,
      isTestMode: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    pp().create.mockResolvedValue(created)

    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Sandbox",
        credentials: { secretKey: "sk_test_abc123", publishableKey: "pk_test_xyz" },
      }),
    )
    const json = await res.json()
    expect(res.status).toBe(201)
    expect(json.provider.id).toBe("p_new")
  })

  it("rejects unknown provider type", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "bitcoin",
        name: "Bitcoin",
        credentials: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("rejects missing name", async () => {
    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        credentials: {},
      }),
    )
    expect(res.status).toBe(400)
  })

  it("returns 409 on duplicate (type, isTestMode) per org", async () => {
    pp().create.mockRejectedValue(new Error("Unique constraint violated"))

    const res = await CreateProvider(
      makeReq("/api/v1/payment-providers", "POST", {
        type: "stripe",
        name: "Stripe Dupe",
        credentials: { secretKey: "sk_test_abc" },
      }),
    )
    expect(res.status).toBe(409)
  })
})

/* ─── PATCH update — vault guard (P0) ──────────────────────────────── */

describe("PATCH /api/v1/payment-providers/[id] — vault guard", () => {
  beforeEach(() => {
    // Default: existing is test-mode
    pp().findFirst.mockResolvedValue({
      id: "p1",
      type: "stripe",
      isTestMode: true,
      credentials: { secretKey: "sk_test_old" },
    })
  })

  it("returns 400 when `type` is included (immutable post-create)", async () => {
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", { type: "paypal", name: "New Name" }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toMatch(/immutable/)
  })

  it("blocks switching to isTestMode:false", async () => {
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", { isTestMode: false }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("VAULT_NOT_WIRED")
  })

  it("blocks updating credentials with sk_live_*", async () => {
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", {
        credentials: { secretKey: "sk_live_PRODUCTION" }, // gitleaks:allow -- synthetic test/public display literal
      }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("LIVE_KEY_DETECTED")
  })

  it("allows updating name without touching credentials", async () => {
    const updated = {
      id: "p1",
      type: "stripe",
      name: "Stripe New Name",
      isActive: true,
      isTestMode: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    pp().update.mockResolvedValue(updated)

    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", { name: "Stripe New Name" }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.provider.name).toBe("Stripe New Name")
  })

  it("effective-state merge: existing test-mode + PATCH credentials sk_live_* → 403", async () => {
    // existing.isTestMode = true, patch only changes credentials to include live key
    // Guard must see effective(isTestMode=true, credentials=new_live) → LIVE_KEY_DETECTED
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", {
        credentials: { secretKey: "sk_live_MERGED_LIVE_KEY" },
      }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("LIVE_KEY_DETECTED")
  })

  it("effective-state merge: existing has test credentials + PATCH only isTestMode:false → 403", async () => {
    // existing.credentials = {secretKey: "sk_test_old"}, patch only flips isTestMode
    // Guard must see effective(isTestMode=false, credentials=existing) → VAULT_NOT_WIRED
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/p1", "PATCH", { isTestMode: false }),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.code).toBe("VAULT_NOT_WIRED")
  })

  it("returns 404 when provider not found", async () => {
    pp().findFirst.mockResolvedValue(null)
    const res = await UpdateProvider(
      makeReq("/api/v1/payment-providers/ghost", "PATCH", { name: "x" }),
      makeParams("ghost"),
    )
    expect(res.status).toBe(404)
  })
})

/* ─── DELETE ────────────────────────────────────────────────────────── */

describe("DELETE /api/v1/payment-providers/[id]", () => {
  it("deletes an existing provider", async () => {
    pp().findFirst.mockResolvedValue({ id: "p1" })
    pp().delete.mockResolvedValue({})

    const res = await DeleteProvider(
      makeReq("/api/v1/payment-providers/p1", "DELETE"),
      makeParams("p1"),
    )
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
  })

  it("returns 404 when provider not found", async () => {
    pp().findFirst.mockResolvedValue(null)
    const res = await DeleteProvider(
      makeReq("/api/v1/payment-providers/ghost", "DELETE"),
      makeParams("ghost"),
    )
    expect(res.status).toBe(404)
  })

  it("returns 409 when provider has associated PaymentIntents (FK Restrict)", async () => {
    pp().findFirst.mockResolvedValue({ id: "p1" })
    pp().delete.mockRejectedValue(new Error("P2003 foreign key constraint"))

    const res = await DeleteProvider(
      makeReq("/api/v1/payment-providers/p1", "DELETE"),
      makeParams("p1"),
    )
    expect(res.status).toBe(409)
  })
})
