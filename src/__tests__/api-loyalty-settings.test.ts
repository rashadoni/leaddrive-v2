/* eslint-disable @typescript-eslint/no-explicit-any -- route handler tests mock Next request/auth types */
/**
 * D8 Loyalty — per-tenant loyalty settings (Slice 3 step 3).
 *
 * GET/PUT /api/v1/loyalty-settings — the admin toggle that flips the
 * loyalty_portal flag in Organization.features (member portal on/off),
 * preserving every other feature.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: { organization: { findFirst: vi.fn(), update: vi.fn() } },
}))
vi.mock("@/lib/api-auth", () => ({
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: any) => r instanceof NextResponse),
}))

import { GET, PUT } from "@/app/api/v1/loyalty-settings/route"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/api-auth"

const AUTH = { orgId: "org-1", userId: "u-1", role: "admin" }
const put = (body: object) => new Request("http://localhost/api/v1/loyalty-settings", { method: "PUT", body: JSON.stringify(body) }) as any

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(AUTH as any)
})

describe("GET /api/v1/loyalty-settings", () => {
  it("reports memberPortalEnabled from features", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp", "loyalty_portal"] } as any)
    expect((await (await GET(new Request("http://x") as any, undefined as any)).json()).memberPortalEnabled).toBe(true)
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp"] } as any)
    expect((await (await GET(new Request("http://x") as any, undefined as any)).json()).memberPortalEnabled).toBe(false)
  })
})

describe("PUT /api/v1/loyalty-settings", () => {
  it("400 on non-boolean", async () => {
    expect((await PUT(put({ memberPortalEnabled: "yes" }), undefined as any)).status).toBe(400)
  })

  it("enabling ADDS loyalty_portal and preserves other features", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp", "campaigns"] } as any)
    const res = await PUT(put({ memberPortalEnabled: true }), undefined as any)
    expect(res.status).toBe(200)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { features: ["whatsapp", "campaigns", "loyalty_portal"] } }),
    )
  })

  it("enabling is idempotent (no duplicate flag)", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["loyalty_portal", "campaigns"] } as any)
    await PUT(put({ memberPortalEnabled: true }), undefined as any)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { features: ["loyalty_portal", "campaigns"] } }),
    )
  })

  it("disabling REMOVES only loyalty_portal", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: ["whatsapp", "loyalty_portal", "campaigns"] } as any)
    await PUT(put({ memberPortalEnabled: false }), undefined as any)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { features: ["whatsapp", "campaigns"] } }),
    )
  })

  it("parses a JSON-string features column too", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: '["whatsapp"]' } as any)
    await PUT(put({ memberPortalEnabled: true }), undefined as any)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { features: ["whatsapp", "loyalty_portal"] } }),
    )
  })

  it("400 when neither flag is provided", async () => {
    expect((await PUT(put({}), undefined as any)).status).toBe(400)
  })
})

describe("PUT /api/v1/loyalty-settings — autoEarnEnabled (settings.loyaltyAutoEarn)", () => {
  it("enabling sets loyaltyAutoEarn=true, clears skipped launch state, preserving other settings, NOT touching features", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: { primaryCurrency: "AZN", loyaltyPointsExpiryDays: 365 } } as any)
    const res = await PUT(put({ autoEarnEnabled: true }), undefined as any)
    expect(res.status).toBe(200)
    expect((await res.json()).autoEarnEnabled).toBe(true)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          settings: {
            primaryCurrency: "AZN",
            loyaltyPointsExpiryDays: 365,
            loyaltyAutoEarn: true,
            loyaltyAutoEarnSkipped: false,
          },
        },
      }),
    )
  })

  it("disabling sets loyaltyAutoEarn=false", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: { loyaltyAutoEarn: true } } as any)
    await PUT(put({ autoEarnEnabled: false }), undefined as any)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { settings: { loyaltyAutoEarn: false } } }),
    )
  })

  it("GET reports autoEarnEnabled from settings", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: [], settings: { loyaltyAutoEarn: true } } as any)
    expect((await (await GET(new Request("http://x") as any, undefined as any)).json()).autoEarnEnabled).toBe(true)
  })

  it("GET reports autoEarnSkipped from settings", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ features: [], settings: { loyaltyAutoEarnSkipped: true } } as any)
    expect((await (await GET(new Request("http://x") as any, undefined as any)).json()).autoEarnSkipped).toBe(true)
  })

  it("can mark auto-earn as skipped for launch when auto-earn is off", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: { loyaltyAutoEarn: false, primaryCurrency: "AZN" } } as any)
    const res = await PUT(put({ autoEarnSkipped: true }), undefined as any)
    expect(res.status).toBe(200)
    expect((await res.json()).autoEarnSkipped).toBe(true)
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { settings: { loyaltyAutoEarn: false, primaryCurrency: "AZN", loyaltyAutoEarnSkipped: true } },
      }),
    )
  })

  it("rejects skipped auto-earn while auto-earn is enabled", async () => {
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ settings: { loyaltyAutoEarn: true } } as any)
    expect((await PUT(put({ autoEarnSkipped: true }), undefined as any)).status).toBe(400)
  })

  it("400 on non-boolean autoEarnEnabled", async () => {
    expect((await PUT(put({ autoEarnEnabled: 1 }), undefined as any)).status).toBe(400)
  })

  it("400 on non-boolean autoEarnSkipped", async () => {
    expect((await PUT(put({ autoEarnSkipped: "yes" }), undefined as any)).status).toBe(400)
  })
})
