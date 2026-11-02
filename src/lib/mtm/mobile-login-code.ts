import { randomInt } from "node:crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

/**
 * The six digits sent to WhatsApp for signing in to the MTM app. Kept in the
 * same `otp_codes` table as the CRM's SMS codes, under a purpose of its own and
 * always with the organization: the same number may belong to people in two
 * companies, and a code from one never opens the other.
 *
 * Only the code's bcrypt hash is stored. A code lives ten minutes, takes five
 * wrong tries, and works once; asking again replaces it.
 */

export const MOBILE_LOGIN_CODE_PURPOSE = "mtm_app_login"
export const MOBILE_LOGIN_CODE_LENGTH = 6
export const MOBILE_LOGIN_CODE_TTL_SECONDS = 10 * 60
export const MOBILE_LOGIN_CODE_RESEND_SECONDS = 60
export const MOBILE_LOGIN_CODE_MAX_ATTEMPTS = 5

/** Seconds until another code may be sent to this number, 0 when it may now. */
export async function secondsUntilResend(organizationId: string, phone: string, now = new Date()): Promise<number> {
  const latest = await prisma.otpCode.findFirst({
    where: { organizationId, phone, purpose: MOBILE_LOGIN_CODE_PURPOSE },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  })
  if (!latest) return 0
  const elapsed = Math.floor((now.getTime() - latest.createdAt.getTime()) / 1000)
  return Math.max(0, MOBILE_LOGIN_CODE_RESEND_SECONDS - elapsed)
}

/** A fresh code for this number in this organization; any earlier one stops working. */
export async function issueMobileLoginCode(organizationId: string, phone: string, now = new Date()): Promise<{ id: string; code: string }> {
  // Authentication secret: never Math.random().
  let code = ""
  for (let i = 0; i < MOBILE_LOGIN_CODE_LENGTH; i++) code += randomInt(0, 10).toString()
  const codeHash = await bcrypt.hash(code, 8)
  const created = await prisma.$transaction(async tx => {
    await tx.otpCode.updateMany({
      where: { organizationId, phone, purpose: MOBILE_LOGIN_CODE_PURPOSE, usedAt: null },
      data: { usedAt: now },
    })
    return await tx.otpCode.create({
      data: {
        organizationId,
        phone,
        purpose: MOBILE_LOGIN_CODE_PURPOSE,
        codeHash,
        expiresAt: new Date(now.getTime() + MOBILE_LOGIN_CODE_TTL_SECONDS * 1000),
      },
      select: { id: true },
    })
  })
  return { id: created.id, code }
}

/** A code that was issued but could not be delivered must not stay usable. */
export async function withdrawMobileLoginCode(id: string, now = new Date()): Promise<void> {
  await prisma.otpCode.updateMany({ where: { id, usedAt: null }, data: { usedAt: now } })
}

export type MobileLoginCodeCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "locked" }

/**
 * Checks the code against the latest live one for this number. A wrong code
 * spends a try; the fifth wrong try retires the code. The right code is
 * consumed with a compare-and-set, so two requests racing with it cannot both
 * succeed.
 */
export async function checkMobileLoginCode(organizationId: string, phone: string, code: string, now = new Date()): Promise<MobileLoginCodeCheck> {
  if (!new RegExp(`^\\d{${MOBILE_LOGIN_CODE_LENGTH}}$`).test(code)) return { ok: false, reason: "invalid" }
  const record = await prisma.otpCode.findFirst({
    where: { organizationId, phone, purpose: MOBILE_LOGIN_CODE_PURPOSE, usedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, attempts: true, expiresAt: true },
  })
  if (!record) return { ok: false, reason: "expired" }
  if (record.expiresAt <= now) return { ok: false, reason: "expired" }
  if (record.attempts >= MOBILE_LOGIN_CODE_MAX_ATTEMPTS) {
    await prisma.otpCode.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } })
    return { ok: false, reason: "locked" }
  }
  if (!(await bcrypt.compare(code, record.codeHash))) {
    const spent = await prisma.otpCode.updateMany({
      where: { id: record.id, usedAt: null, attempts: { lt: MOBILE_LOGIN_CODE_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    })
    if (spent.count === 1 && record.attempts + 1 >= MOBILE_LOGIN_CODE_MAX_ATTEMPTS) {
      await prisma.otpCode.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: now } })
      return { ok: false, reason: "locked" }
    }
    return { ok: false, reason: "invalid" }
  }
  const consumed = await prisma.otpCode.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: now }, attempts: { lt: MOBILE_LOGIN_CODE_MAX_ATTEMPTS } },
    data: { usedAt: now },
  })
  return consumed.count === 1 ? { ok: true } : { ok: false, reason: "expired" }
}
