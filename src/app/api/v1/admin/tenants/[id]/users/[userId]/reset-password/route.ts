import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { runWithRlsBypass } from "@/lib/rls-context"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { checkRateLimit } from "@/lib/rate-limit"
import { passwordPolicyError } from "@/lib/password-policy"
import { clientIp } from "@/lib/request-ip"
import { logAudit, prisma } from "@/lib/prisma"

const MAX_BODY_BYTES = 8 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const ACTOR_RATE_LIMIT = { maxRequests: 20, windowMs: RATE_LIMIT_WINDOW_MS }
const TARGET_RATE_LIMIT = { maxRequests: 5, windowMs: RATE_LIMIT_WINDOW_MS }

const routeParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
  userId: z.string().trim().min(1).max(128),
}).strict()

const resetPasswordSchema = z.object({
  password: z.string().min(1).max(72),
  confirmPassword: z.string().min(1).max(72),
}).strict().refine((value) => value.password === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  // Authentication and the superadmin role gate must precede every cross-tenant
  // lookup. requireSuperAdmin also enters the explicit RLS bypass context.
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  // This is an interactive browser operation. Refuse API keys/bearer tokens,
  // non-JSON bodies, and explicit cross-origin mutation requests.
  const mutationGuard = guardInteractiveJsonMutation(req)
  if (mutationGuard) return mutationGuard

  const parsedParams = routeParamsSchema.safeParse(await params)
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid tenant or user id" }, { status: 400 })
  }
  const { id: tenantId, userId } = parsedParams.data

  // Bound both a compromised superadmin session and repeated work against one
  // account before the deliberately expensive bcrypt operation.
  const actorAllowed = checkRateLimit(
    `superadmin-password-reset:actor:${auth.userId}`,
    ACTOR_RATE_LIMIT,
  )
  const targetAllowed = checkRateLimit(
    `superadmin-password-reset:target:${tenantId}:${userId}`,
    TARGET_RATE_LIMIT,
  )
  if (!actorAllowed || !targetAllowed) {
    return NextResponse.json(
      { error: "Too many password reset attempts. Try again in one minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }

  const requestBody = await readJsonRequestWithinLimit(req, MAX_BODY_BYTES)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }

  const parsed = resetPasswordSchema.safeParse(requestBody.value)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Invalid password" },
      { status: 400 },
    )
  }

  const policyError = passwordPolicyError(parsed.data.password)
  if (policyError) {
    return NextResponse.json({ error: policyError }, { status: 400 })
  }

  return runWithRlsBypass(async () => {
    try {
      const tenant = await prisma.organization.findUnique({
        where: { id: tenantId },
        select: { id: true, isActive: true },
      })
      if (!tenant) {
        return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
      }

      // Exact tenant + user + role scoping prevents this endpoint from ever
      // becoming a generic cross-tenant user or superadmin credential writer.
      const target = await prisma.user.findFirst({
        where: { id: userId, organizationId: tenantId, role: "admin" },
        select: {
          id: true,
          email: true,
          isActive: true,
          passwordChangedAt: true,
        },
      })
      if (!target) {
        return NextResponse.json({ error: "Tenant administrator not found" }, { status: 404 })
      }

      const changedAt = new Date()
      const passwordHash = await bcrypt.hash(parsed.data.password, 12)
      const updated = await prisma.user.updateMany({
        where: { id: userId, organizationId: tenantId, role: "admin" },
        data: {
          passwordHash,
          passwordChangedAt: changedAt,
          resetToken: null,
          resetTokenExp: null,
        },
      })
      if (updated.count !== 1) {
        return NextResponse.json({ error: "Tenant administrator not found" }, { status: 404 })
      }

      // Never persist the plaintext or hash. passwordChangedAt documents the
      // exact credential epoch that invalidated every existing session.
      await logAudit(
        tenantId,
        "superadmin_password_reset",
        "user",
        target.id,
        target.email,
        {
          userId: auth.userId,
          ipAddress: clientIp(req),
          userAgent: req.headers.get("user-agent")?.slice(0, 512),
          oldValue: {
            passwordChangedAt: target.passwordChangedAt,
            isActive: target.isActive,
          },
          newValue: {
            passwordChangedAt: changedAt,
            sessionsInvalidated: true,
            isActive: target.isActive,
            tenantActive: tenant.isActive,
          },
        },
      )

      return NextResponse.json({
        success: true,
        data: {
          userId: target.id,
          passwordChangedAt: changedAt,
          isActive: target.isActive,
          tenantActive: tenant.isActive,
          sessionsInvalidated: true,
        },
      })
    } catch (error) {
      console.error("[admin tenant user reset-password]", error)
      return NextResponse.json({ error: "Internal server error" }, { status: 500 })
    }
  })
}
