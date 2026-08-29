import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { isValidTimezone } from "@/lib/timezone"
import type { WorkforceConfigurationAuditContext } from "@/lib/workforce/configuration-management"
import { prisma } from "@/lib/prisma"

const SITE_ID = /^[A-Za-z0-9_-]{1,100}$/

export const WorkforceSiteTypeSchema = z.enum([
  "OFFICE",
  "WAREHOUSE",
  "TEMPORARY",
  "CUSTOMER",
  "HOME_REMOTE",
])

export const WorkforceSiteCreateSchema = z.object({
  code: z.string().trim().min(1).max(64)
    .regex(SITE_ID, "Site code must use letters, numbers, _ or -"),
  name: z.string().trim().min(1).max(160),
  type: WorkforceSiteTypeSchema,
  timezone: z.string().trim().max(64).refine(isValidTimezone, "timezone must be a valid IANA timezone"),
  addressLabel: z.string().trim().min(1).max(500).nullable().optional(),
  responsibleTeamId: z.string().trim().regex(SITE_ID).nullable().optional(),
}).strict()

export const WorkforceSiteArchiveSchema = z.object({
  reason: z.string().trim().min(1).max(500),
}).strict()

export class WorkforceSiteManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_NOT_FOUND"
      | "WORKFORCE_SITE_ALREADY_ARCHIVED"
      | "WORKFORCE_SITE_CODE_DUPLICATE"
      | "WORKFORCE_SITE_SCOPE_INVALID",
    message = code,
  ) {
    super(message)
  }
}

const workforceSiteSelect = {
  id: true,
  code: true,
  name: true,
  type: true,
  timezone: true,
  addressLabel: true,
  responsibleTeamId: true,
  status: true,
  createdByUserId: true,
  archivedByUserId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkforceSiteSelect

function siteAuditData(
  site: {
    id: string
    code: string
    name: string
    type: string
    timezone: string
    addressLabel: string | null
    responsibleTeamId: string | null
    status: string
    archivedAt: Date | null
  },
  audit: WorkforceConfigurationAuditContext,
  reason?: string,
): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    code: site.code,
    name: site.name,
    type: site.type,
    timezone: site.timezone,
    addressLabel: site.addressLabel,
    responsibleTeamId: site.responsibleTeamId,
    status: site.status,
    archivedAt: site.archivedAt?.toISOString() ?? null,
    ...(reason === undefined ? {} : { reason }),
  }
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code
}

/**
 * Create a tenant-owned Workforce site. A site has no attendance effect until
 * later C2/C3 assignment, segment and policy records explicitly select it.
 */
export async function createWorkforceSite(input: {
  organizationId: string
  createdByUserId: string
  site: z.infer<typeof WorkforceSiteCreateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-site:${input.organizationId}:${input.site.code}`}))`
      const site = await tx.workforceSite.create({
        data: {
          organizationId: input.organizationId,
          code: input.site.code,
          name: input.site.name,
          type: input.site.type,
          timezone: input.site.timezone,
          addressLabel: input.site.addressLabel ?? null,
          responsibleTeamId: input.site.responsibleTeamId ?? null,
          createdByUserId: input.createdByUserId,
        },
        select: workforceSiteSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_SITE_CREATED",
          entity: "workforce_site",
          entityId: site.id,
          metadataKind: "workforce_configuration",
          newData: siteAuditData(site, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return site
    })
  } catch (error) {
    if (hasPrismaCode(error, "P2002")) {
      throw new WorkforceSiteManagementError(
        "WORKFORCE_SITE_CODE_DUPLICATE",
        "This Workforce site code already exists",
      )
    }
    if (hasPrismaCode(error, "P2003")) {
      throw new WorkforceSiteManagementError(
        "WORKFORCE_SITE_SCOPE_INVALID",
        "The responsible Workforce team or administrator is unavailable in this tenant",
      )
    }
    throw error
  }
}

/** Archive instead of delete so historical assignment/snapshot references stay explainable. */
export async function archiveWorkforceSite(input: {
  organizationId: string
  siteId: string
  archivedByUserId: string
  reason: string
  audit: WorkforceConfigurationAuditContext
  now?: Date
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  const archivedAt = input.now ?? new Date()
  return db.$transaction(async (tx) => {
    const existing = await tx.workforceSite.findFirst({
      where: { id: input.siteId, organizationId: input.organizationId },
      select: workforceSiteSelect,
    })
    if (!existing) {
      throw new WorkforceSiteManagementError("WORKFORCE_SITE_NOT_FOUND", "Workforce site was not found")
    }
    if (existing.status !== "ACTIVE") {
      throw new WorkforceSiteManagementError(
        "WORKFORCE_SITE_ALREADY_ARCHIVED",
        "Workforce site is already archived",
      )
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-site:${input.organizationId}:${existing.code}`}))`
    const changed = await tx.workforceSite.updateMany({
      where: { id: existing.id, organizationId: input.organizationId, status: "ACTIVE" },
      data: { status: "ARCHIVED", archivedByUserId: input.archivedByUserId, archivedAt },
    })
    if (changed.count !== 1) {
      throw new WorkforceSiteManagementError(
        "WORKFORCE_SITE_ALREADY_ARCHIVED",
        "Workforce site changed concurrently",
      )
    }
    const site = await tx.workforceSite.findFirst({
      where: { id: existing.id, organizationId: input.organizationId },
      select: workforceSiteSelect,
    })
    if (!site) {
      throw new WorkforceSiteManagementError("WORKFORCE_SITE_NOT_FOUND")
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: null,
        action: "WORKFORCE_SITE_ARCHIVED",
        entity: "workforce_site",
        entityId: site.id,
        metadataKind: "workforce_configuration",
        oldData: siteAuditData(existing, input.audit),
        newData: siteAuditData(site, input.audit, input.reason),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
    return site
  })
}
