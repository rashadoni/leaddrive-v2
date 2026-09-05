import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { PAGE_SIZE } from "@/lib/constants"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { issuePortalPasswordLink } from "@/lib/portal-password-link"
import { passwordPolicyError } from "@/lib/password-policy"
import bcrypt from "bcryptjs"
import { z } from "zod"
import type { Prisma } from "@prisma/client"

const portalUserProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().max(320).email().nullable(),
  phone: z.string().trim().max(50).nullable(),
  portalAccessEnabled: z.boolean(),
}).strict()

const administratorPasswordSchema = z.object({
  password: z.string().max(1024),
  confirmPassword: z.string().max(1024),
  acknowledged: z.literal(true),
}).strict()

const portalUsersPatchSchema = z.object({
  contactIds: z.array(z.string().trim().min(1).max(128)).min(1).max(200).optional(),
  action: z.enum(["enable", "disable"]).optional(),
  contactId: z.string().trim().min(1).max(128).optional(),
  profile: portalUserProfileSchema.optional(),
  sendPasswordLink: z.boolean().optional(),
  administratorPassword: administratorPasswordSchema.optional(),
  // Kept for existing clients. It now sends a one-time link instead of
  // clearing the hash and leaving the customer without a recovery path.
  resetPassword: z.boolean().optional(),
  portalAccessEnabled: z.boolean().optional(),
  clearChatHistory: z.boolean().optional(),
  removeFromPortal: z.boolean().optional(),
}).strict()

function requirePortalAdministrator(role: string) {
  if (role === "admin" || role === "superadmin") return null
  return NextResponse.json(
    { error: "Administrator access required", code: "PORTAL_USERS_ADMIN_REQUIRED" },
    { status: 403 },
  )
}

// GET /api/v1/portal-users — list contacts with portal info
export const GET = withRlsSessionAuth(async (req, auth) => {
  const denied = requirePortalAdministrator(auth.role)
  if (denied) return denied
  const { orgId } = auth

  const url = new URL(req.url)
  const requestedFilter = url.searchParams.get("filter") || "all"
  const filter = ["all", "enabled", "registered", "pending", "disabled"].includes(requestedFilter) ? requestedFilter : "all"
  const search = (url.searchParams.get("search") || "").trim().slice(0, 120)

  const where: Prisma.ContactWhereInput = { organizationId: orgId }

  if (filter === "enabled") where.portalAccessEnabled = true
  else if (filter === "registered") {
    where.portalAccessEnabled = true
    where.portalPasswordHash = { not: null }
  } else if (filter === "pending") {
    where.portalAccessEnabled = true
    where.portalPasswordHash = null
  } else if (filter === "disabled") {
    where.portalAccessEnabled = false
    where.email = { not: null }
  }

  if (search) {
    where.OR = [
      { fullName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }

  const contactRows = await prisma.contact.findMany({
    where,
    include: { company: { select: { name: true } } },
    orderBy: [{ portalAccessEnabled: "desc" }, { portalLastLoginAt: "desc" }, { fullName: "asc" }],
    take: PAGE_SIZE.PORTAL_USERS + 1,
  })
  const truncated = contactRows.length > PAGE_SIZE.PORTAL_USERS
  const contacts = contactRows.slice(0, PAGE_SIZE.PORTAL_USERS)

  const data = contacts.map((c) => ({
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    companyName: c.company?.name || null,
    isActive: c.isActive,
    portalAccessEnabled: c.portalAccessEnabled,
    hasPassword: !!c.portalPasswordHash,
    portalLastLoginAt: c.portalLastLoginAt,
    recoveryExpiresAt: c.portalVerificationExpires,
  }))

  // Stats
  const allContacts = await prisma.contact.findMany({
    where: { organizationId: orgId, email: { not: null } },
    select: { portalAccessEnabled: true, portalPasswordHash: true, portalLastLoginAt: true },
  })

  const totalWithEmail = allContacts.length
  const enabled = allContacts.filter((c) => c.portalAccessEnabled).length
  const registered = allContacts.filter((c) => c.portalAccessEnabled && c.portalPasswordHash).length
  const weekAgo = new Date(Date.now() - 7 * 86400000)
  const recentLogins = allContacts.filter((c) => c.portalLastLoginAt && c.portalLastLoginAt > weekAgo).length

  return NextResponse.json({
    success: true,
    data: {
      contacts: data,
      stats: { totalWithEmail, enabled, registered, recentLogins },
      scope: { shown: data.length, limit: PAGE_SIZE.PORTAL_USERS, truncated },
    },
    permissions: { canWrite: true, role: auth.role },
  })
})

async function clearPortalChatHistory(orgId: string, contactId: string) {
  const sessions = await prisma.aiChatSession.findMany({
    where: { organizationId: orgId, portalUserId: contactId },
    select: { id: true },
  })
  if (sessions.length === 0) return 0

  const sessionIds = sessions.map((session: { id: string }) => session.id)
  await prisma.$transaction([
    prisma.aiChatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } }),
    prisma.aiChatSession.deleteMany({ where: { id: { in: sessionIds } } }),
  ])
  return sessions.length
}

function revokePortalCredentials() {
  return {
    portalPasswordHash: null,
    portalVerificationToken: null,
    portalVerificationExpires: null,
    portalLastLoginAt: null,
  }
}

async function writePortalAudit(params: {
  orgId: string
  action: string
  contactId: string
  contactName: string
  actorUserId: string
  details?: Record<string, string | number | boolean | null>
}) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: params.orgId,
        action: params.action,
        entityType: "contact",
        entityId: params.contactId,
        entityName: params.contactName,
        details: { ...(params.details || {}), actorUserId: params.actorUserId },
      },
    })
    return true
  } catch {
    // Access changes remain authoritative even if the secondary audit sink is
    // unavailable, but the response must tell the UI not to claim an audit.
    return false
  }
}

// PATCH /api/v1/portal-users — manage one portal contact or bulk access state.
export const PATCH = withRlsSessionAuth(async (req, auth) => {
  const denied = requirePortalAdministrator(auth.role)
  if (denied) return denied
  const { orgId } = auth

  const requestBody = await readJsonRequestWithinLimit(req, 64 * 1024)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid JSON" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = portalUsersPatchSchema.safeParse(requestBody.value)
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  const {
    contactIds,
    action,
    contactId,
    profile,
    sendPasswordLink,
    administratorPassword,
    resetPassword,
    portalAccessEnabled,
    clearChatHistory,
    removeFromPortal,
  } = parsed.data

  // Single contact update
  if (contactId) {
    const target = await prisma.contact.findFirst({
      where: { id: contactId, organizationId: orgId },
      include: { organization: { select: { name: true } } },
    })
    if (!target) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

    const requestedActions = [
      Boolean(profile),
      Boolean(sendPasswordLink || resetPassword),
      Boolean(administratorPassword),
      Boolean(clearChatHistory),
      Boolean(removeFromPortal),
      typeof portalAccessEnabled === "boolean",
    ].filter(Boolean).length
    if (requestedActions !== 1) return NextResponse.json({ error: "Choose one portal action" }, { status: 400 })

    if (profile) {
      if (profile.portalAccessEnabled && !profile.email) {
        return NextResponse.json({ error: "An email address is required for portal access", code: "PORTAL_EMAIL_REQUIRED" }, { status: 400 })
      }
      if (profile.portalAccessEnabled && !target.isActive) {
        return NextResponse.json({ error: "Activate the CRM contact before enabling portal access", code: "PORTAL_CONTACT_INACTIVE" }, { status: 409 })
      }
      const emailChanged = target.email !== profile.email
      const accessRevoked = !profile.portalAccessEnabled || emailChanged
      const updated = await prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: {
          fullName: profile.fullName,
          email: profile.email,
          phone: profile.phone,
          portalAccessEnabled: profile.portalAccessEnabled,
          ...(accessRevoked ? revokePortalCredentials() : {}),
        },
      })
      if (updated.count !== 1) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

      const auditRecorded = await writePortalAudit({
        orgId,
        action: "portal_user_updated",
        contactId,
        contactName: profile.fullName,
        actorUserId: auth.userId,
        details: { emailChanged, accessRevoked },
      })
      return NextResponse.json({ success: true, data: { credentialsRevoked: accessRevoked }, auditRecorded })
    }

    if (sendPasswordLink || resetPassword) {
      if (!target.portalAccessEnabled || !target.isActive) {
        return NextResponse.json({ error: "Enable portal access before sending a password link" }, { status: 409 })
      }
      const issued = await issuePortalPasswordLink(target)
      if (!issued.ok) {
        return NextResponse.json({ error: "Password link could not be delivered" }, { status: 502 })
      }
      const auditRecorded = await writePortalAudit({
        orgId,
        action: "portal_password_link_sent_by_admin",
        contactId,
        contactName: target.fullName,
        actorUserId: auth.userId,
        details: { mode: issued.mode, expiresAt: issued.expiresAt },
      })
      return NextResponse.json({ success: true, data: { mode: issued.mode, expiresAt: issued.expiresAt }, auditRecorded })
    }

    if (administratorPassword) {
      if (!target.portalAccessEnabled || !target.isActive || !target.email) {
        return NextResponse.json({ error: "Enable portal access with an email address before setting a password" }, { status: 409 })
      }
      const passwordError = passwordPolicyError(administratorPassword.password)
      if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })
      if (administratorPassword.password !== administratorPassword.confirmPassword) {
        return NextResponse.json({ error: "Passwords do not match" }, { status: 400 })
      }

      const passwordHash = await bcrypt.hash(administratorPassword.password, 12)
      const updated = await prisma.contact.updateMany({
        where: { id: contactId, organizationId: orgId },
        data: {
          portalPasswordHash: passwordHash,
          portalVerificationToken: null,
          portalVerificationExpires: null,
          portalLastLoginAt: null,
        },
      })
      if (updated.count !== 1) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

      const auditRecorded = await writePortalAudit({
        orgId,
        action: "portal_password_set_by_admin",
        contactId,
        contactName: target.fullName,
        actorUserId: auth.userId,
        details: { source: "manual" },
      })
      return NextResponse.json({ success: true, auditRecorded })
    }

    if (removeFromPortal) {
      const sessions = await prisma.aiChatSession.findMany({
        where: { organizationId: orgId, portalUserId: contactId },
        select: { id: true },
      })
      const sessionIds = sessions.map((session: { id: string }) => session.id)
      const operations = [
        ...(sessionIds.length > 0 ? [
          prisma.aiChatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } }),
          prisma.aiChatSession.deleteMany({ where: { id: { in: sessionIds } } }),
        ] : []),
        prisma.contact.updateMany({
          where: { id: contactId, organizationId: orgId },
          data: { portalAccessEnabled: false, ...revokePortalCredentials() },
        }),
      ]
      const results = await prisma.$transaction(operations)
      const removed = results.at(-1) as { count: number }
      if (removed.count !== 1) return NextResponse.json({ error: "Contact not found" }, { status: 404 })
      const auditRecorded = await writePortalAudit({ orgId, action: "portal_user_removed", contactId, contactName: target.fullName, actorUserId: auth.userId, details: { cleared: sessions.length } })
      return NextResponse.json({ success: true, removed: true, auditRecorded })
    }

    if (clearChatHistory) {
      const cleared = await clearPortalChatHistory(orgId, contactId)
      const auditRecorded = await writePortalAudit({ orgId, action: "portal_chat_history_cleared", contactId, contactName: target.fullName, actorUserId: auth.userId, details: { cleared } })
      return NextResponse.json({ success: true, cleared, auditRecorded })
    }

    const updateData: Prisma.ContactUpdateManyMutationInput = {}
    if (typeof portalAccessEnabled === "boolean") {
      if (portalAccessEnabled && !target.email) {
        return NextResponse.json({ error: "An email address is required for portal access", code: "PORTAL_EMAIL_REQUIRED" }, { status: 400 })
      }
      if (portalAccessEnabled && !target.isActive) {
        return NextResponse.json({ error: "Activate the CRM contact before enabling portal access", code: "PORTAL_CONTACT_INACTIVE" }, { status: 409 })
      }
      updateData.portalAccessEnabled = portalAccessEnabled
      if (!portalAccessEnabled) Object.assign(updateData, revokePortalCredentials())
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }
    const updated = await prisma.contact.updateMany({
      where: { id: contactId, organizationId: orgId },
      data: updateData,
    })
    if (updated.count !== 1) return NextResponse.json({ error: "Contact not found" }, { status: 404 })

    const auditRecorded = await writePortalAudit({
      orgId,
      action: portalAccessEnabled ? "portal_access_enabled" : "portal_access_disabled",
      contactId,
      contactName: target.fullName,
      actorUserId: auth.userId,
    })

    return NextResponse.json({ success: true, auditRecorded })
  }

  // Bulk action
  if (contactIds && action) {
    const enableValue = action === "enable"
    const uniqueContactIds = [...new Set(contactIds)]
    if (enableValue) {
      const ineligibleContacts = await prisma.contact.count({
        where: {
          id: { in: uniqueContactIds },
          organizationId: orgId,
          OR: [{ email: null }, { isActive: false }],
        },
      })
      if (ineligibleContacts > 0) {
        return NextResponse.json({ error: "Every selected contact must be active and have an email address", code: "PORTAL_BULK_INELIGIBLE" }, { status: 400 })
      }
    }
    const result = await prisma.contact.updateMany({
      where: { id: { in: uniqueContactIds }, organizationId: orgId },
      data: {
        portalAccessEnabled: enableValue,
        ...(!enableValue ? revokePortalCredentials() : {}),
      },
    })
    const auditRecorded = await writePortalAudit({
      orgId,
      action: enableValue ? "portal_access_bulk_enabled" : "portal_access_bulk_disabled",
      contactId: "batch",
      contactName: `${result.count} portal users`,
      actorUserId: auth.userId,
      details: { requested: uniqueContactIds.length, updated: result.count },
    })
    return NextResponse.json({ success: true, updated: result.count, auditRecorded })
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
})
