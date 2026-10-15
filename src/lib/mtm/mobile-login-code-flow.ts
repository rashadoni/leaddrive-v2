import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { consumePublicRateLimit } from "@/lib/public-abuse-guard"
import { clientIp } from "@/lib/request-ip"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { findPhoneOwner, maskedPhone, phoneDigits, MOBILE_LOGIN_ORGANIZATION_SELECT } from "@/lib/mtm/mobile-login-phone"
import { mobileAppRefusal, officeEmployeeMaySignIn, type MobileLoginAgent } from "@/lib/mtm/mobile-login-session"

/**
 * What the three sign-in-by-code endpoints share: the request shape, the
 * limits, the company and the one card a number belongs to.
 *
 * The answer to «send me a code» is the same whether or not the number belongs
 * to anybody — a stranger learns nothing about who works where. Only «codes
 * cannot be sent right now» is said aloud, and it is decided before the
 * number is looked at.
 */

export const NO_STORE = { "Cache-Control": "no-store" }
const MAX_BODY_BYTES = 4 * 1024

export const OrganizationSlug = z.string().trim().toLowerCase().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
export const EnteredPhone = z.string().trim().min(1).max(40).refine(value => phoneDigits(value).length >= 8)

export function codeFlowError(status: number, code: string, error: string, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json({ success: false, code, error }, { status, headers: { ...NO_STORE, ...headers } })
}

export async function readCodeFlowBody<T>(req: NextRequest, schema: z.ZodType<T>): Promise<{ ok: true; value: T } | { ok: false; response: NextResponse }> {
  const body = await readJsonRequestWithinLimit(req, MAX_BODY_BYTES)
  if (!body.ok) return { ok: false, response: codeFlowError(body.reason === "too_large" ? 413 : 400, "MTM_LOGIN_CODE_REQUEST_INVALID", "Invalid request") }
  const parsed = schema.safeParse(body.value)
  if (!parsed.success) return { ok: false, response: codeFlowError(400, "MTM_LOGIN_CODE_REQUEST_INVALID", "Invalid request") }
  return { ok: true, value: parsed.data }
}

/**
 * Two buckets, as the password form has: one per network peer and one per
 * number, so neither a single host nor a crowd rotating addresses gets more
 * tries at one number.
 */
export async function codeFlowRateLimit(req: NextRequest, scope: string, principal: string, limits: { ip: [number, number]; principal: [number, number] }): Promise<NextResponse | null> {
  const ip = clientIp(req)
  const [byIp, byPrincipal] = await Promise.all([
    consumePublicRateLimit(`${scope}:ip`, ip, { maxRequests: limits.ip[0], windowSeconds: limits.ip[1] }),
    consumePublicRateLimit(`${scope}:principal`, principal, { maxRequests: limits.principal[0], windowSeconds: limits.principal[1] }),
  ])
  if (byIp.unavailable || byPrincipal.unavailable) {
    return codeFlowError(503, "MTM_LOGIN_CODE_BUSY", "Temporarily unavailable", { "Retry-After": "1" })
  }
  if (!byIp.allowed || !byPrincipal.allowed) {
    const retry = Math.max(byIp.retryAfterSeconds, byPrincipal.retryAfterSeconds, 1)
    return codeFlowError(429, "MTM_LOGIN_CODE_TOO_MANY", "Too many attempts", { "Retry-After": String(retry) })
  }
  return null
}

export async function companyBySlug(slug: string) {
  return await prisma.organization.findUnique({ where: { slug, isActive: true }, select: MOBILE_LOGIN_ORGANIZATION_SELECT })
}

export type CodeHolder =
  | { kind: "agent"; agent: MobileLoginAgent; sendTo: string }
  | { kind: "nobody"; reason: "no_card" | "ambiguous" | "inactive" | "not_admitted" | "national_number" }

/**
 * The card a code for this number is for: the only active card with the
 * number, which could sign in with a password right now, and a number
 * WhatsApp can deliver to.
 */
export async function codeHolder(organization: MobileLoginAgent["organization"], phone: string): Promise<CodeHolder> {
  const owner = await findPhoneOwner(prisma, organization.id, phone)
  if (owner.kind === "none") return { kind: "nobody", reason: "no_card" }
  if (owner.kind === "ambiguous") return { kind: "nobody", reason: "ambiguous" }
  const row = await prisma.mtmAgent.findFirst({ where: { id: owner.agentId, organizationId: organization.id } })
  if (!row || row.status !== "ACTIVE") return { kind: "nobody", reason: "inactive" }
  const agent: MobileLoginAgent = { ...row, organization }
  if (!(await officeEmployeeMaySignIn(agent)) || mobileAppRefusal(agent)) return { kind: "nobody", reason: "not_admitted" }
  if (!owner.sendTo) return { kind: "nobody", reason: "national_number" }
  return { kind: "agent", agent, sendTo: owner.sendTo }
}

export function auditCodeFlow(req: NextRequest, organizationId: string, agentId: string | null, action: string, phone: string, extra: Record<string, unknown> = {}): Promise<void> {
  return writeMtmAudit({
    organizationId,
    agentId,
    action,
    entity: "mobile_auth",
    entityId: agentId,
    metadataKind: "login_code",
    newData: { phone: maskedPhone(phone), ...extra },
    req,
  }).catch(error => console.warn(`[MTM/mobile/auth/code] ${action} audit failed`, error))
}
