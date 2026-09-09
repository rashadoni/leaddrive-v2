import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockPrisma = vi.hoisted(() => ({
  socialAccount: { update: vi.fn() },
}))

const deps = vi.hoisted(() => ({
  decryptToken: vi.fn(),
  encryptToken: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }))
vi.mock("@/lib/secure-token", () => ({
  decryptToken: deps.decryptToken,
  encryptToken: deps.encryptToken,
}))
vi.mock("@/lib/social/ingest-mention", () => ({
  ingestMention: vi.fn(),
  findMatchedKeyword: vi.fn(),
}))

import { refreshYouTubeToken } from "@/lib/social/youtube-poller"

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client")
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret")
  deps.decryptToken.mockReturnValue("expired-access::refresh-token")
  deps.encryptToken.mockReturnValue("encrypted-fresh-token")
  mockPrisma.socialAccount.update.mockResolvedValue({ id: "account-1" })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("YouTube OAuth provider timeout boundary", () => {
  it("passes an AbortSignal through the token refresh fetch and parses the body inside it", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return new Response(JSON.stringify({ access_token: "fresh-access", expires_in: 3600 }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await expect(refreshYouTubeToken({
      id: "account-1",
      accessToken: "encrypted-token",
      tokenExpiresAt: new Date(Date.now() - 60_000),
    })).resolves.toBe("fresh-access")

    expect(fetchMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})
