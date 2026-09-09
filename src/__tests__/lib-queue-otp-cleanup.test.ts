/**
 * Tests for Q4 BullMQ job queue — extracted otp-cleanup handler.
 * Pure handler logic, no Redis, no BullMQ — Prisma mocked to assert the
 * delete predicates.
 */
import { describe, it, expect, vi } from "vitest"
import { runOtpCleanup } from "@/lib/queue/jobs/otp-cleanup"

function mockPrisma(expired = 5, usedOld = 3) {
  return {
    otpCode: {
      deleteMany: vi.fn()
        .mockResolvedValueOnce({ count: expired })
        .mockResolvedValueOnce({ count: usedOld }),
    },
  }
}

describe("Q4 queue — runOtpCleanup", () => {
  it("returns count of deleted expired + used-old rows", async () => {
    const prisma = mockPrisma(7, 4)
    const result = await runOtpCleanup(prisma as any)
    expect(result).toEqual({
      deletedExpired: 7,
      deletedUsedOld: 4,
      auditWindowDays: 7,
    })
  })

  it("issues two parallel deleteMany calls", async () => {
    const prisma = mockPrisma()
    await runOtpCleanup(prisma as any)
    expect(prisma.otpCode.deleteMany).toHaveBeenCalledTimes(2)
  })

  it("expired predicate: expiresAt < now AND usedAt IS NULL", async () => {
    const prisma = mockPrisma()
    const now = new Date("2026-05-14T10:00:00Z")
    await runOtpCleanup(prisma as any, now)

    const call1 = (prisma.otpCode.deleteMany as any).mock.calls[0][0]
    expect(call1.where.expiresAt).toEqual({ lt: now })
    expect(call1.where.usedAt).toBe(null)
  })

  it("used-old predicate: usedAt < (now - 7 days)", async () => {
    const prisma = mockPrisma()
    const now = new Date("2026-05-14T10:00:00Z")
    await runOtpCleanup(prisma as any, now)

    const call2 = (prisma.otpCode.deleteMany as any).mock.calls[1][0]
    expect(call2.where.usedAt.not).toBe(null)
    const expectedCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    expect(call2.where.usedAt.lt.getTime()).toBe(expectedCutoff.getTime())
  })

  it("accepts custom audit window", async () => {
    const prisma = mockPrisma()
    const now = new Date("2026-05-14T10:00:00Z")
    const result = await runOtpCleanup(prisma as any, now, 14)
    expect(result.auditWindowDays).toBe(14)

    const call2 = (prisma.otpCode.deleteMany as any).mock.calls[1][0]
    const expectedCutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
    expect(call2.where.usedAt.lt.getTime()).toBe(expectedCutoff.getTime())
  })

  it("zero deletions returns zero counts", async () => {
    const prisma = mockPrisma(0, 0)
    const result = await runOtpCleanup(prisma as any)
    expect(result.deletedExpired).toBe(0)
    expect(result.deletedUsedOld).toBe(0)
  })

  it("propagates prisma errors (caller decides retry)", async () => {
    const prisma = {
      otpCode: {
        deleteMany: vi.fn().mockRejectedValue(new Error("db down")),
      },
    }
    await expect(runOtpCleanup(prisma as any)).rejects.toThrow("db down")
  })
})
