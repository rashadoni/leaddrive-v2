import { randomUUID, timingSafeEqual } from "node:crypto"
import { z } from "zod"
import { hmacToken } from "@/lib/secure-token"

export const ATTENDANCE_QR_LIFETIME_SECONDS = 60
const PayloadSchema = z.object({ branchId: z.string().uuid(), revisionId: z.string().uuid(), nonce: z.string().uuid(), issued: z.number().int().nonnegative(), expires: z.number().int().positive() }).strict()
type Payload = z.infer<typeof PayloadSchema>
const sign = (segment: string, organizationId: string) => hmacToken(segment, `mtm-branch-qr:v1:${organizationId}`)
/** Separate namespace from withdrawn Workforce QR. Never a login credential. */
export function issueAttendanceQrToken(organizationId: string, branchId: string, revisionId: string, now: Date) {
  const issued = Math.floor(now.getTime() / 1000)
  const payload = PayloadSchema.parse({ branchId, revisionId, nonce: randomUUID(), issued, expires: issued + ATTENDANCE_QR_LIFETIME_SECONDS })
  const segment = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return { token: `mtmq1.${segment}.${sign(segment, organizationId)}`, expiresAt: new Date(payload.expires * 1000) }
}
export function verifyAttendanceQrToken(organizationId: string, token: string, now: Date, claimedAt: Date): { state: "VERIFIED"; payload: Payload } | { state: "INVALID" | "EXPIRED" } {
  if (token.length > 2048) return { state: "INVALID" }
  const [version, segment, signature, extra] = token.split(".")
  if (version !== "mtmq1" || !segment || !/^[A-Za-z0-9_-]+$/.test(segment) || extra !== undefined || !/^[a-f0-9]{64}$/.test(signature ?? "")) return { state: "INVALID" }
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(segment, organizationId), "hex"))) return { state: "INVALID" }
  let payload: Payload
  try { payload = PayloadSchema.parse(JSON.parse(Buffer.from(segment, "base64url").toString("utf8"))) } catch { return { state: "INVALID" } }
  if (payload.expires !== payload.issued + ATTENDANCE_QR_LIFETIME_SECONDS) return { state: "INVALID" }
  const nowMs = now.getTime(), claimMs = claimedAt.getTime()
  if (!Number.isFinite(nowMs)) return { state: "INVALID" }
  // Both receipt and claimed mark must fit the server-issued window. Moving
  // the phone clock backwards cannot revive an expired or future code.
  if (nowMs < payload.issued * 1000 || nowMs >= payload.expires * 1000) return { state: "EXPIRED" }
  if (!Number.isFinite(claimMs) || claimMs < payload.issued * 1000 - 5000 || claimMs >= payload.expires * 1000) return { state: "INVALID" }
  return { state: "VERIFIED", payload }
}
export const attendanceQrNonceFingerprint = (organizationId: string, nonce: string) => hmacToken(nonce, `mtm-branch-qr-nonce:v1:${organizationId}`)
