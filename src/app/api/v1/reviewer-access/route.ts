import { randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { z } from "zod"
import bcrypt from "bcryptjs"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/permissions"
import { generateStrongTemporaryPassword } from "@/lib/password-policy"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { USER_HIDEABLE_MODULE_IDS } from "@/lib/user-module-access"
import {
  REVIEWER_ROLE,
  reviewerAccessOpen,
  reviewerHiddenModules,
  reviewerMaxExpiry,
} from "@/lib/reviewer-access"

/**
 * Outside reviewer access (src/lib/reviewer-access.ts). Admins only, from a
 * browser session: an API key must not be able to mint a person's login.
 *
 *   GET  — every grant of the organization, newest first, with how many reads
 *          each reviewer made.
 *   POST — create the reviewer login and its grant; the password is returned
 *          once and never stored in clear.
 */

const MAX_BODY_SIZE = 8 * 1024
// A grant for an end date "today" is created at most a day ahead of the cap,
// so a picked end-of-day 30 days out passes whatever the admin's time zone.
const EXPIRY_SLACK_MS = 24 * 60 * 60 * 1000
const MAX_OPEN_GRANTS = 5

const hideable = new Set<string>(USER_HIDEABLE_MODULE_IDS)

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).email(),
  modules: z.array(z.string().max(50)).min(1).max(50),
  expiresAt: z.string().datetime({ offset: true }),
  reason: z.string().trim().min(3).max(500),
}).strict()

function forbidden() {
  return NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role)) return forbidden()
  const grants = await prisma.reviewerAccessGrant.findMany({
    where: { organizationId: auth.orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, modules: true, reason: true, expiresAt: true, createdAt: true, revokedAt: true,
      user: { select: { id: true, name: true, email: true, lastLogin: true } },
    },
  })
  const counts: Array<{ userId: string | null; _count: { _all: number } }> = grants.length === 0 ? [] : await prisma.complianceAuditLog.groupBy({
    by: ["userId"],
    where: { organizationId: auth.orgId, userId: { in: grants.map((grant: { user: { id: string } }) => grant.user.id) } },
    _count: { _all: true },
  })
  const reads = new Map(counts.map((row) => [row.userId, row._count._all]))
  const now = new Date()
  return NextResponse.json({
    success: true,
    data: grants.map((grant: {
      id: string; modules: string[]; reason: string; expiresAt: Date; createdAt: Date; revokedAt: Date | null
      user: { id: string; name: string; email: string; lastLogin: Date | null }
    }) => ({
      id: grant.id,
      name: grant.user.name,
      email: grant.user.email,
      modules: grant.modules,
      reason: grant.reason,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
      revokedAt: grant.revokedAt,
      lastLogin: grant.user.lastLogin,
      open: reviewerAccessOpen(grant, now),
      reads: reads.get(grant.user.id) ?? 0,
    })),
  })
})

export const POST = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role)) return forbidden()

  const body = await readJsonRequestWithinLimit(req, MAX_BODY_SIZE)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.reason === "too_large" ? "Request body too large" : "Invalid JSON body" },
      { status: body.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = createSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message, code: "REVIEWER_ACCESS_INVALID" }, { status: 400 })
  }
  const { name, email, reason } = parsed.data
  const modules = [...new Set(parsed.data.modules)]
  if (modules.some((id) => !hideable.has(id))) {
    return NextResponse.json({ error: "Unknown section", code: "REVIEWER_ACCESS_UNKNOWN_MODULE" }, { status: 400 })
  }

  const now = new Date()
  const expiresAt = new Date(parsed.data.expiresAt)
  if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > reviewerMaxExpiry(now).getTime() + EXPIRY_SLACK_MS) {
    return NextResponse.json({ error: "End date must be within 30 days", code: "REVIEWER_ACCESS_EXPIRY_RANGE" }, { status: 400 })
  }

  const existing = await prisma.user.findFirst({ where: { organizationId: auth.orgId, email }, select: { id: true } })
  if (existing) {
    return NextResponse.json({ error: "User with this email already exists", code: "REVIEWER_ACCESS_EMAIL_TAKEN" }, { status: 409 })
  }
  const openGrants = await prisma.reviewerAccessGrant.count({
    where: { organizationId: auth.orgId, revokedAt: null, expiresAt: { gt: now } },
  })
  if (openGrants >= MAX_OPEN_GRANTS) {
    return NextResponse.json({ error: "Too many open reviewer grants", code: "REVIEWER_ACCESS_LIMIT" }, { status: 409 })
  }

  const password = generateStrongTemporaryPassword(randomBytes)
  const passwordHash = await bcrypt.hash(password, 12)
  const hiddenModules = reviewerHiddenModules(USER_HIDEABLE_MODULE_IDS, modules)

  const created = await prisma.$transaction(async (tx: typeof prisma) => {
    const user = await tx.user.create({
      data: {
        organizationId: auth.orgId,
        name,
        email,
        passwordHash,
        role: REVIEWER_ROLE,
        isActive: true,
        hiddenModules,
      },
      select: { id: true, email: true },
    })
    const grant = await tx.reviewerAccessGrant.create({
      data: {
        organizationId: auth.orgId,
        userId: user.id,
        modules,
        reason,
        expiresAt,
        grantedByUserId: auth.userId,
      },
      select: { id: true, expiresAt: true },
    })
    return { user, grant }
  })

  await logAudit(auth.orgId, "reviewer_access_granted", "user", created.user.id, created.user.email, {
    userId: auth.userId,
    newValue: { modules, reason, expiresAt: created.grant.expiresAt },
  })

  return NextResponse.json({
    success: true,
    data: { id: created.grant.id, email: created.user.email, password, expiresAt: created.grant.expiresAt },
  }, { status: 201, headers: { "Cache-Control": "no-store" } })
})
