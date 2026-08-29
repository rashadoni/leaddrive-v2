import { createHash } from "node:crypto"
import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
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

export const WorkforceSiteGeofenceRevisionCreateSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD")
    .refine(isDateKey, "effectiveFrom must be a real calendar date"),
  centerLatitude: z.number().finite().min(-90).max(90),
  centerLongitude: z.number().finite().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(5_000),
  calibrationReference: z.string().trim().min(1).max(500),
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

export class WorkforceSiteGeofenceManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_GEOFENCE_SITE_NOT_FOUND"
      | "WORKFORCE_SITE_GEOFENCE_SITE_ARCHIVED"
      | "WORKFORCE_SITE_GEOFENCE_EFFECTIVE_DATE_NOT_FUTURE"
      | "WORKFORCE_SITE_GEOFENCE_TIMELINE_CONFLICT",
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

const workforceSiteGeofenceRevisionSelect = {
  id: true,
  siteId: true,
  revision: true,
  kind: true,
  centerLatitude: true,
  centerLongitude: true,
  radiusMeters: true,
  calibrationReference: true,
  definitionHash: true,
  effectiveFrom: true,
  effectiveTo: true,
  createdByUserId: true,
  createdAt: true,
} satisfies Prisma.WorkforceSiteGeofenceRevisionSelect

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

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function previousDateKey(value: string): string {
  return new Date(new Date(`${value}T00:00:00.000Z`).getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

function geofenceDefinitionHash(value: z.infer<typeof WorkforceSiteGeofenceRevisionCreateSchema>): string {
  return createHash("sha256").update(JSON.stringify({
    geometryVersion: 1,
    kind: "CIRCLE",
    centerLatitude: value.centerLatitude,
    centerLongitude: value.centerLongitude,
    radiusMeters: value.radiusMeters,
  })).digest("hex")
}

function geofenceAuditData(revision: {
  id: string
  siteId: string
  revision: number
  kind: string
  radiusMeters: number
  definitionHash: string
  effectiveFrom: Date
  effectiveTo: Date | null
}, audit: WorkforceConfigurationAuditContext): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    siteId: revision.siteId,
    revision: revision.revision,
    kind: revision.kind,
    radiusMeters: revision.radiusMeters,
    definitionHash: revision.definitionHash,
    effectiveFrom: dateKey(revision.effectiveFrom),
    effectiveTo: revision.effectiveTo == null ? null : dateKey(revision.effectiveTo),
  }
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

/**
 * Add the next forward-only calibrated circle revision. Geometry never changes
 * after insertion; scheduling the new future revision closes the preceding
 * window exactly once inside this same transaction.
 */
export async function createWorkforceSiteGeofenceRevision(input: {
  organizationId: string
  siteId: string
  createdByUserId: string
  revision: z.infer<typeof WorkforceSiteGeofenceRevisionCreateSchema>
  currentDateKey: string
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  if (!isDateKey(input.currentDateKey)) {
    throw new WorkforceSiteGeofenceManagementError(
      "WORKFORCE_SITE_GEOFENCE_EFFECTIVE_DATE_NOT_FUTURE",
      "Workforce organization current date is invalid",
    )
  }
  if (input.revision.effectiveFrom <= input.currentDateKey) {
    throw new WorkforceSiteGeofenceManagementError(
      "WORKFORCE_SITE_GEOFENCE_EFFECTIVE_DATE_NOT_FUTURE",
      "A Workforce geofence revision must become effective after the organization current date",
    )
  }
  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      const site = await tx.workforceSite.findFirst({
        where: { id: input.siteId, organizationId: input.organizationId },
        select: { id: true, code: true, status: true },
      })
      if (!site) {
        throw new WorkforceSiteGeofenceManagementError(
          "WORKFORCE_SITE_GEOFENCE_SITE_NOT_FOUND",
          "Workforce site was not found",
        )
      }
      if (site.status !== "ACTIVE") {
        throw new WorkforceSiteGeofenceManagementError(
          "WORKFORCE_SITE_GEOFENCE_SITE_ARCHIVED",
          "A geofence revision requires an active Workforce site",
        )
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-site-geofence:${input.organizationId}:${site.id}`}))`
      const revisions = await tx.workforceSiteGeofenceRevision.findMany({
        where: { organizationId: input.organizationId, siteId: site.id },
        orderBy: { effectiveFrom: "asc" },
        select: workforceSiteGeofenceRevisionSelect,
      })
      const predecessor = revisions.at(-1) ?? null
      if (predecessor && input.revision.effectiveFrom <= dateKey(predecessor.effectiveFrom)) {
        throw new WorkforceSiteGeofenceManagementError(
          "WORKFORCE_SITE_GEOFENCE_TIMELINE_CONFLICT",
          "A geofence revision must be scheduled after the current latest revision",
        )
      }
      if (predecessor) {
        const changed = await tx.workforceSiteGeofenceRevision.updateMany({
          where: {
            id: predecessor.id,
            organizationId: input.organizationId,
            siteId: site.id,
            effectiveTo: null,
          },
          data: { effectiveTo: new Date(`${previousDateKey(input.revision.effectiveFrom)}T00:00:00.000Z`) },
        })
        if (changed.count !== 1) {
          throw new WorkforceSiteGeofenceManagementError(
            "WORKFORCE_SITE_GEOFENCE_TIMELINE_CONFLICT",
            "The preceding Workforce geofence revision changed concurrently",
          )
        }
      }
      const revision = await tx.workforceSiteGeofenceRevision.create({
        data: {
          organizationId: input.organizationId,
          siteId: site.id,
          revision: (predecessor?.revision ?? 0) + 1,
          kind: "CIRCLE",
          centerLatitude: input.revision.centerLatitude,
          centerLongitude: input.revision.centerLongitude,
          radiusMeters: input.revision.radiusMeters,
          calibrationReference: input.revision.calibrationReference,
          definitionHash: geofenceDefinitionHash(input.revision),
          effectiveFrom: new Date(`${input.revision.effectiveFrom}T00:00:00.000Z`),
          createdByUserId: input.createdByUserId,
        },
        select: workforceSiteGeofenceRevisionSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_SITE_GEOFENCE_REVISION_CREATED",
          entity: "workforce_site_geofence_revision",
          entityId: revision.id,
          metadataKind: "workforce_configuration",
          newData: geofenceAuditData(revision, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return revision
    })
  } catch (error) {
    if (hasPrismaCode(error, "P2002") || hasPrismaCode(error, "P2004") || hasPrismaCode(error, "P2010")) {
      throw new WorkforceSiteGeofenceManagementError(
        "WORKFORCE_SITE_GEOFENCE_TIMELINE_CONFLICT",
        "The Workforce geofence revision timeline changed concurrently",
      )
    }
    throw error
  }
}
