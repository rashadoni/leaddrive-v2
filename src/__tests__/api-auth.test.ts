import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock("@/lib/constants", () => ({
  DEFAULT_PIPELINE_STAGES: [{ name: "New", order: 0 }],
  INITIAL_CURRENCIES: [{ code: "USD", name: "US Dollar", symbol: "$" }],
}))

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("hashed-password") },
}))

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))

// The limiter keeps module-level state, so five tests hitting the same route
// from the same synthetic client would start throttling each other. That the
// limits exist is asserted in password-reset-token.test.ts; these tests are
// about the reset flow itself.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(() => true),
  hashForRateLimit: vi.fn(async (v: string) => `hashed:${v}`),
}))

// crypto is deliberately NOT mocked. The old stub returned a fixed token so a
// test could assert the literal value — which only worked while the token was
// stored verbatim. Now the assertion is that the stored digest is the hash of
// the token in the link, which needs the real `createHash` and gains nothing
// from a predictable `randomBytes`.

import { POST as forgotPOST } from "@/app/api/v1/auth/forgot-password/route"
import { POST as resetPOST } from "@/app/api/v1/auth/reset-password/route"
import { prisma } from "@/lib/prisma"
import { sendEmail } from "@/lib/email"
import { hashOneTimeToken } from "@/lib/one-time-token"

function makeRequest(url: string, body: Record<string, unknown>) {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })
}

type ResetTokenWhere = {
  id?: string
  resetToken?: string | null
  resetTokenExp?: { gt?: Date }
  isActive?: boolean
}

function resetTokenWhere(args: unknown): ResetTokenWhere {
  return (args as { where?: ResetTokenWhere }).where ?? {}
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 })
})

// ---------------------------------------------------------------------------
// Forgot Password
// ---------------------------------------------------------------------------
const account = (over: Record<string, unknown> = {}) => ({
  id: "user-1",
  name: "Test",
  organizationId: "org-1",
  organization: { name: "Acme" },
  ...over,
})

describe("POST /api/v1/auth/forgot-password", () => {
  // F-28: every exit answers identically, including a malformed address. A 400
  // on bad input would be a cheap oracle for probing which shapes the system
  // reacts to, so "missing email" is no longer distinguishable from "unknown
  // address" from outside.
  it("answers uniformly when the email is missing", async () => {
    const res = await forgotPOST(makeRequest("/api/v1/auth/forgot-password", {}))
    expect(res.status).toBe(200)
    expect((await res.json()).success).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("returns success even when user does not exist (prevent enumeration)", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    const res = await forgotPOST(makeRequest("/api/v1/auth/forgot-password", { email: "noone@test.com" }))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  // F-28: the column holds a digest, never the token that travels in the email.
  it("stores a digest of the reset token, not the token", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([account({ email: "test@test.com" })] as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)

    const res = await forgotPOST(makeRequest("/api/v1/auth/forgot-password", { email: "test@test.com" }))
    expect((await res.json()).success).toBe(true)

    const stored = vi.mocked(prisma.user.update).mock.calls[0][0].data.resetToken as string
    expect(stored).toMatch(/^[0-9a-f]{64}$/)

    // The link carries the token itself; the digest of that token is what was
    // stored. Anything else means the two halves disagree and no reset works.
    const html = vi.mocked(sendEmail).mock.calls[0][0].html as string
    const tokenInLink = /token=([0-9a-f]{64})/.exec(html)?.[1]
    expect(tokenInLink).toBeTruthy()
    expect(tokenInLink).not.toBe(stored)
    expect(hashOneTimeToken(tokenInLink as string)).toBe(stored)

    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "test@test.com", organizationId: "org-1" })
    )
  })

  // F-28: one address often holds accounts in several tenants. Picking one
  // arbitrarily — and stably — meant a user could never reset the account they
  // were actually locked out of.
  it("issues a link for every account on the address", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      account({ id: "user-1", email: "multi@test.com", organization: { name: "Acme" } }),
      account({ id: "user-2", email: "multi@test.com", organizationId: "org-2", organization: { name: "Globex" } }),
    ] as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)

    await forgotPOST(makeRequest("/api/v1/auth/forgot-password", { email: "multi@test.com" }))

    expect(prisma.user.update).toHaveBeenCalledTimes(2)

    // One message PER TENANT, not one message carrying both links. sendEmail
    // writes the rendered body into EmailLog, and EmailLog is scoped per
    // organization — a combined message would leave tenant B's working reset
    // link sitting in tenant A's mail log, readable by tenant A's operators.
    expect(sendEmail).toHaveBeenCalledTimes(2)

    const calls = vi.mocked(sendEmail).mock.calls.map(c => c[0])
    expect(calls.map(c => c.organizationId).sort()).toEqual(["org-1", "org-2"])

    for (const call of calls) {
      const html = call.html as string
      // Exactly one link per message: the one belonging to that tenant.
      expect(html.match(/token=[0-9a-f]{64}/g)).toHaveLength(1)
    }
    // Each message names its own workspace and only its own.
    const acme = calls.find(c => c.organizationId === "org-1")!.html as string
    const globex = calls.find(c => c.organizationId === "org-2")!.html as string
    expect(acme).toContain("Acme")
    expect(acme).not.toContain("Globex")
    expect(globex).toContain("Globex")
    expect(globex).not.toContain("Acme")
  })

  it("does not send email for inactive users", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([])
    const res = await forgotPOST(makeRequest("/api/v1/auth/forgot-password", { email: "inactive@test.com" }))
    expect(res.status).toBe(200)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it("sets resetTokenExp to approximately 1 hour from now", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([account({ email: "t@t.com" })] as never)
    vi.mocked(prisma.user.update).mockResolvedValue({} as never)

    await forgotPOST(makeRequest("/api/v1/auth/forgot-password", { email: "t@t.com" }))

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0]
    const exp = updateCall.data.resetTokenExp as Date
    const diffMs = exp.getTime() - Date.now()
    // Should be about 1 hour (3600000 ms), allow 5s tolerance
    expect(diffMs).toBeGreaterThan(3595000)
    expect(diffMs).toBeLessThan(3605000)
  })
})

// ---------------------------------------------------------------------------
// Reset Password
// ---------------------------------------------------------------------------
describe("POST /api/v1/auth/reset-password", () => {
  it("returns 400 when token is missing", async () => {
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", { password: "NewPass123!Strong" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 when password is missing", async () => {
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "some-token" }))
    expect(res.status).toBe(400)
  })

  it("returns 400 for the pentest weak password", async () => {
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "tok", password: "12345678" }))
    expect(res.status).toBe(400)
  })

  it("rejects an oversized public reset body before a database lookup", async () => {
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", {
      token: "tok",
      password: `Aa1!${"x".repeat(9_000)}`,
    }))

    expect(res.status).toBe(413)
    expect(prisma.user.findFirst).not.toHaveBeenCalled()
  })

  it("returns 400 when token is invalid or expired", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "bad-token", password: "NewPass123!Strong" }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toMatch(/invalid|expired/i)
  })

  it("resets password, clears token, and sets passwordChangedAt", async () => {
    // F-28: the stored value is the digest; the token only ever exists in the
    // link and in this request.
    vi.mocked(prisma.user.findFirst).mockResolvedValue({
      id: "user-1",
      isActive: true,
      resetToken: hashOneTimeToken("valid-token"),
      resetTokenExp: new Date(Date.now() + 3600000),
    } as never)
    const res = await resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "valid-token", password: "NewPass123!Strong" }))
    const json = await res.json()
    expect(json.success).toBe(true)

    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "user-1",
          resetToken: hashOneTimeToken("valid-token"),
          resetTokenExp: { gt: expect.any(Date) },
          isActive: true,
        }),
        data: expect.objectContaining({
          passwordHash: "hashed-password",
          resetToken: null,
          resetTokenExp: null,
        }),
      })
    )

    const updateData = vi.mocked(prisma.user.updateMany).mock.calls[0][0].data
    expect(updateData.passwordChangedAt).toBeInstanceOf(Date)
    expect(prisma.user.update).not.toHaveBeenCalled()
  })

  it("allows exactly one winner when two requests race on the same token", async () => {
    const resetTokenExp = new Date(Date.now() + 3_600_000)
    let lookupCount = 0
    let releaseLookups!: () => void
    const bothLookedUp = new Promise<void>((resolve) => { releaseLookups = resolve })

    vi.mocked(prisma.user.findFirst).mockImplementation(async () => {
      lookupCount += 1
      if (lookupCount === 2) releaseLookups()
      await bothLookedUp
      return { id: "user-1", isActive: true, resetToken: hashOneTimeToken("race-token"), resetTokenExp } as never
    })

    // The compare-and-set matches on the digest, so the simulated live value is
    // the digest too.
    let liveToken: string | null = hashOneTimeToken("race-token")
    vi.mocked(prisma.user.updateMany).mockImplementation(async (args) => {
      const where = resetTokenWhere(args)
      const stillValid = liveToken === where.resetToken
        && where.resetTokenExp?.gt instanceof Date
        && resetTokenExp > where.resetTokenExp.gt
        && where.id === "user-1"
        && where.isActive === true
      if (!stillValid) return { count: 0 }
      liveToken = null
      return { count: 1 }
    })

    const responses = await Promise.all([
      resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "race-token", password: "NewPass123!Strong" })),
      resetPOST(makeRequest("/api/v1/auth/reset-password", { token: "race-token", password: "OtherPass456!Strong" })),
    ])

    expect(responses.map((response) => response.status).sort()).toEqual([200, 400])
    const loser = responses.find((response) => response.status === 400)
    expect(loser).toBeDefined()
    expect(await loser!.json()).toEqual({ error: "Invalid or expired reset link" })
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(2)
    expect(liveToken).toBeNull()
  })

  it("rejects replay after a successful reset without changing the password again", async () => {
    const resetTokenExp = new Date(Date.now() + 3_600_000)
    // Digest, not the token: the lookup and the compare-and-set both match on it.
    let liveToken: string | null = hashOneTimeToken("single-use-token")
    vi.mocked(prisma.user.findFirst).mockImplementation(async (args) => (
      liveToken === resetTokenWhere(args).resetToken
        ? { id: "user-1", isActive: true, resetToken: liveToken, resetTokenExp } as never
        : null
    ))
    vi.mocked(prisma.user.updateMany).mockImplementation(async (args) => {
      const where = resetTokenWhere(args)
      if (liveToken !== where.resetToken) return { count: 0 }
      liveToken = null
      return { count: 1 }
    })

    const first = await resetPOST(makeRequest("/api/v1/auth/reset-password", {
      token: "single-use-token",
      password: "NewPass123!Strong",
    }))
    const replay = await resetPOST(makeRequest("/api/v1/auth/reset-password", {
      token: "single-use-token",
      password: "OtherPass456!Strong",
    }))

    expect(first.status).toBe(200)
    expect(replay.status).toBe(400)
    expect(await replay.json()).toEqual({ error: "Invalid or expired reset link" })
    expect(prisma.user.updateMany).toHaveBeenCalledTimes(1)
  })
})
