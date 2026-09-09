import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { updateMany: vi.fn() },
  },
}))

vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn((fn: () => unknown) => fn()),
}))

import { prisma } from "@/lib/prisma"
import {
  TWO_FACTOR_NONCE_TTL_MS,
  applyVerifiedTwoFactorSessionUpdate,
  consumeTwoFactorNonce,
  createTwoFactorNonce,
  twoFactorNonceIsFresh,
} from "@/lib/two-factor-nonce"

describe("two-factor nonce", () => {
  beforeEach(() => vi.clearAllMocks())

  it("creates a backwards-compatible 64-char nonce with a five-minute expiry", () => {
    const now = 1_750_000_000_000
    const nonce = createTwoFactorNonce(now)

    expect(nonce).toMatch(/^[0-9a-f]{64}$/)
    expect(Number.parseInt(nonce.slice(0, 12), 16)).toBe(now + TWO_FACTOR_NONCE_TTL_MS)
    expect(twoFactorNonceIsFresh(nonce, now)).toBe(true)
    expect(twoFactorNonceIsFresh(nonce, now + TWO_FACTOR_NONCE_TTL_MS)).toBe(false)
  })

  it("rejects malformed or expired nonce without touching the database", async () => {
    expect(await consumeTwoFactorNonce("user-1", "not-a-nonce")).toBe(false)
    expect(await consumeTwoFactorNonce("user-1", createTwoFactorNonce(1), Date.now())).toBe(false)
    expect(prisma.user.updateMany).not.toHaveBeenCalled()
  })

  it("atomically consumes a matching nonce", async () => {
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never)
    const nonce = createTwoFactorNonce()

    await expect(consumeTwoFactorNonce("user-1", nonce)).resolves.toBe(true)
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", twoFactorNonce: nonce },
      data: { twoFactorNonce: null },
    })
  })

  it("keeps 2FA flags when the client omits or forges the nonce", async () => {
    const consume = vi.fn().mockResolvedValue(false)
    const token = { sub: "user-1", needs2fa: true, twoFactorMethod: "totp" }

    await applyVerifiedTwoFactorSessionUpdate(token, { needs2fa: false }, consume)
    await applyVerifiedTwoFactorSessionUpdate(
      token,
      { needs2fa: false, twoFactorNonce: "forged" },
      consume,
    )

    expect(token.needs2fa).toBe(true)
    expect(token.twoFactorMethod).toBe("totp")
    expect(consume).toHaveBeenCalledTimes(1)
  })

  it("clears only an active challenge after successful one-time validation", async () => {
    const consume = vi.fn().mockResolvedValue(true)
    const token = {
      sub: "user-1",
      needs2fa: true,
      needsSetup2fa: true,
      twoFactorMethod: "sms",
    }

    await applyVerifiedTwoFactorSessionUpdate(
      token,
      { needs2fa: false, needsSetup2fa: false, twoFactorNonce: "valid" },
      consume,
    )

    expect(consume).toHaveBeenCalledWith("user-1", "valid")
    expect(token.needs2fa).toBeUndefined()
    expect(token.needsSetup2fa).toBeUndefined()
    expect(token.twoFactorMethod).toBeUndefined()
  })
})
