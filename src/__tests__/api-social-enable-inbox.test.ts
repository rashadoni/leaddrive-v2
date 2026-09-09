import { describe, it, expect, vi, beforeEach } from "vitest"
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"

/**
 * FB/IG inbox backfill (Slice 3) — POST /api/v1/social/enable-inbox. Wires already-connected
 * Social-Monitoring FB/IG accounts into inbox channels, idempotent + per-account fail-soft.
 */
vi.mock("@/lib/prisma", () => ({ prisma: { socialAccount: { findMany: vi.fn(), count: vi.fn() }, channelConfig: { findMany: vi.fn() } } }))
// POST теперь идёт через withRlsAuth("inbox","write") — включение инбокс-канала
// требует модуля Omni-Channel даже на соц-роуте (разделение модулей 2026-08-01).
// GET (статус для баннера соцмониторинга) остался на withRls/getOrgId.
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(),
  isAuthError: vi.fn().mockImplementation((r: unknown) => r instanceof NextResponse),
}))
vi.mock("@/lib/secure-token", () => ({ decryptToken: vi.fn((t: string) => `dec(${t})`) }))
vi.mock("@/lib/social/inbox-channel", () => ({ ensureInboxChannelForPage: vi.fn() }))

import { POST, GET } from "@/app/api/v1/social/enable-inbox/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, requireAuth } from "@/lib/api-auth"
import { ensureInboxChannelForPage } from "@/lib/social/inbox-channel"

const req = () => ({}) as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org1")
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org1", userId: "u1", role: "admin", email: "a@b.c", name: "A" } as never)
  vi.mocked(ensureInboxChannelForPage).mockResolvedValue({ created: true, subscribed: true })
})

describe("POST /api/v1/social/enable-inbox", () => {
  it("401 when unauthenticated", async () => {
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as never,
    )
    expect((await POST(req())).status).toBe(401)
  })

  it("403 when requireAuth rejects on the omnichannel module gate", async () => {
    // Соц-тенант БЕЗ Omni-Channel не должен заводить инбокс-каналы: requireAuth
    // получает scope "inbox" → модульный гейт omnichannel.
    vi.mocked(requireAuth).mockResolvedValue(
      NextResponse.json({ error: "Forbidden" }, { status: 403 }) as never,
    )
    expect((await POST(req())).status).toBe(403)
    expect(vi.mocked(requireAuth).mock.calls[0]?.slice(1, 3)).toEqual(["inbox", "write"])
  })

  it("wires each FB/IG SocialAccount into an inbox channel (decrypts the token first)", async () => {
    vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([
      { platform: "facebook", handle: "PAGE1", displayName: "Nokaut", accessToken: "enc1" },
      { platform: "instagram", handle: "IG1", displayName: "Kishi", accessToken: "enc2" },
    ] as never)
    const json = await (await POST(req())).json()
    expect(json.wired).toBe(2)
    expect(json.total).toBe(2)
    expect(ensureInboxChannelForPage).toHaveBeenCalledWith("org1", "facebook", "PAGE1", "Nokaut", "dec(enc1)")
    expect(ensureInboxChannelForPage).toHaveBeenCalledWith("org1", "instagram", "IG1", "Kishi", "dec(enc2)")
  })

  it("is per-account fail-soft — one bad token doesn't abort the rest", async () => {
    vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([
      { platform: "facebook", handle: "P1", displayName: "A", accessToken: "e1" },
      { platform: "facebook", handle: "P2", displayName: "B", accessToken: "e2" },
    ] as never)
    vi.mocked(ensureInboxChannelForPage).mockRejectedValueOnce(new Error("expired token"))
    const json = await (await POST(req())).json()
    expect(json.total).toBe(2)
    expect(json.wired).toBe(1)
    expect(json.results.some((r: { error?: string }) => r.error)).toBe(true)
  })

  it("returns wired:0 when the org has no FB/IG accounts", async () => {
    vi.mocked(prisma.socialAccount.findMany).mockResolvedValue([] as never)
    const json = await (await POST(req())).json()
    expect(json.wired).toBe(0)
    expect(ensureInboxChannelForPage).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/social/enable-inbox (inbox status / reconnect banner)", () => {
  beforeEach(() => vi.mocked(getOrgId).mockResolvedValue("org1"))

  it("401 when unauthenticated", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null)
    expect((await GET(req())).status).toBe(401)
  })

  it("needsReconnect=true when pages are wired but not all have inboxSubscribed", async () => {
    vi.mocked(prisma.socialAccount.count).mockResolvedValue(2 as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { settings: { inboxSubscribed: true } },
      { settings: { inboxSubscribed: false } },
    ] as never)
    const json = await (await GET(req())).json()
    expect(json.wired).toBe(2)
    expect(json.subscribed).toBe(1)
    expect(json.needsReconnect).toBe(true)
  })

  it("needsReconnect=false when every wired page is subscribed", async () => {
    vi.mocked(prisma.socialAccount.count).mockResolvedValue(1 as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([{ settings: { inboxSubscribed: true } }] as never)
    expect((await (await GET(req())).json()).needsReconnect).toBe(false)
  })

  it("needsReconnect=false when no pages are wired", async () => {
    vi.mocked(prisma.socialAccount.count).mockResolvedValue(0 as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([] as never)
    expect((await (await GET(req())).json()).needsReconnect).toBe(false)
  })

  it("needsReconnect=false for legacy/manual configs with NO inboxSubscribed flag (only explicit false flags it)", async () => {
    vi.mocked(prisma.socialAccount.count).mockResolvedValue(2 as never)
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { settings: { inboxSubscribed: true } },
      { settings: null }, // legacy manual config — undefined flag must NOT stick the banner
    ] as never)
    expect((await (await GET(req())).json()).needsReconnect).toBe(false)
  })
})
