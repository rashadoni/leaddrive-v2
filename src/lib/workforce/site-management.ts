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

export const WorkforceSiteAssignmentScheduleSchema = z.object({
  agentId: z.string().trim().regex(SITE_ID),
  siteId: z.string().trim().regex(SITE_ID),
  kind: z.enum(["PRIMARY", "SECONDARY", "TEMPORARY"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD")
    .refine(isDateKey, "effectiveFrom must be a real calendar date"),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD")
    .refine(isDateKey, "effectiveTo must be a real calendar date").nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.effectiveTo != null && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must not be earlier than effectiveFrom" })
  }
  if (value.kind === "TEMPORARY" && value.effectiveTo == null) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Temporary site assignment requires an end date" })
  }
})

/**
 * Read-only, bounded review input for a future site-assignment draft. It is
 * intentionally separate from the one-person write schema: a bulk publish
 * needs a durable idempotency/result record and an explicit HR confirmation.
 */
export const WorkforceSiteAssignmentBulkPreviewSchema = z.object({
  agentIds: z.array(z.string().trim().regex(SITE_ID)).min(1).max(200)
    .refine((ids) => new Set(ids).size === ids.length, "agentIds must not contain duplicates"),
  siteId: z.string().trim().regex(SITE_ID),
  kind: z.enum(["PRIMARY", "SECONDARY", "TEMPORARY"]),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveFrom must be YYYY-MM-DD")
    .refine(isDateKey, "effectiveFrom must be a real calendar date"),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "effectiveTo must be YYYY-MM-DD")
    .refine(isDateKey, "effectiveTo must be a real calendar date").nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.effectiveTo != null && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "effectiveTo must not be earlier than effectiveFrom" })
  }
  if (value.kind === "TEMPORARY" && value.effectiveTo == null) {
    context.addIssue({ code: "custom", path: ["effectiveTo"], message: "Temporary site assignment requires an end date" })
  }
})

/**
 * A browser/client supplied operation key makes the explicit bulk-publish
 * confirmation safe to retry. It is intentionally opaque and does not carry
 * employee or location data.
 */
export const WorkforceSiteAssignmentBulkPublishSchema = WorkforceSiteAssignmentBulkPreviewSchema.and(z.object({
  operationId: z.string().trim().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/, "operationId must be opaque"),
}))

export class WorkforceSiteManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_NOT_FOUND"
      | "WORKFORCE_SITE_ALREADY_ARCHIVED"
      | "WORKFORCE_SITE_CODE_DUPLICATE"
      | "WORKFORCE_SITE_SCOPE_INVALID",
    message: string = code,
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
    message: string = code,
  ) {
    super(message)
  }
}

export class WorkforceSiteAssignmentManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_ASSIGNMENT_AGENT_NOT_FOUND"
      | "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND"
      | "WORKFORCE_SITE_ASSIGNMENT_SITE_ARCHIVED"
      | "WORKFORCE_SITE_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE"
      | "WORKFORCE_SITE_ASSIGNMENT_TIMELINE_CONFLICT",
    message: string = code,
  ) {
    super(message)
  }
}

export type WorkforceSiteAssignmentBulkPreview = {
  effectiveFrom: string
  effectiveTo: string | null
  siteId: string
  kind: z.infer<typeof WorkforceSiteAssignmentBulkPreviewSchema>["kind"]
  items: WorkforceSiteAssignmentBulkPreviewItem[]
  summary: Record<WorkforceSiteAssignmentBulkPreviewItem["outcome"], number>
}

export class WorkforceSiteAssignmentBulkPublishError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_SITE_ASSIGNMENT_BULK_OPERATION_MISMATCH"
      | "WORKFORCE_SITE_ASSIGNMENT_BULK_PREVIEW_BLOCKED"
      | "WORKFORCE_SITE_ASSIGNMENT_BULK_WRITE_CONFLICT",
    message: string = code,
    readonly preview?: WorkforceSiteAssignmentBulkPreview,
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

const workforceSiteAssignmentSelect = {
  id: true,
  agentId: true,
  siteId: true,
  kind: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
} satisfies Prisma.WorkforceSiteAssignmentSelect

const workforceSiteAssignmentBulkOperationSelect = {
  id: true,
  organizationId: true,
  operationId: true,
  requestHash: true,
  siteId: true,
  kind: true,
  effectiveFrom: true,
  effectiveTo: true,
  requestedCount: true,
  createdCount: true,
  unchangedCount: true,
  publishedByUserId: true,
} satisfies Prisma.WorkforceSiteAssignmentBulkOperationSelect

export type WorkforceSiteAssignmentBulkPreviewItem = {
  agentId: string
  outcome: "READY" | "NO_CHANGE" | "EMPLOYEE_UNAVAILABLE" | "CONFLICT"
  currentAssignmentId: string | null
  closesAssignmentId: string | null
}

export type WorkforceSiteAssignmentBulkPublishResult = {
  operationId: string
  siteId: string
  kind: z.infer<typeof WorkforceSiteAssignmentBulkPreviewSchema>["kind"]
  effectiveFrom: string
  effectiveTo: string | null
  requestedCount: number
  createdCount: number
  unchangedCount: number
  idempotent: boolean
}

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

function bulkSiteAssignmentRequestHash(input: {
  organizationId: string
  publishedByUserId: string
  publish: z.infer<typeof WorkforceSiteAssignmentBulkPublishSchema>
}): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    organizationId: input.organizationId,
    publishedByUserId: input.publishedByUserId,
    operationId: input.publish.operationId,
    agentIds: [...input.publish.agentIds].sort(),
    siteId: input.publish.siteId,
    kind: input.publish.kind,
    effectiveFrom: input.publish.effectiveFrom,
    effectiveTo: input.publish.effectiveTo ?? null,
  })).digest("hex")
}

function bulkSiteAssignmentOperationResult(input: {
  operationId: string
  siteId: string
  kind: z.infer<typeof WorkforceSiteAssignmentBulkPreviewSchema>["kind"]
  effectiveFrom: Date
  effectiveTo: Date | null
  requestedCount: number
  createdCount: number
  unchangedCount: number
  idempotent: boolean
}): WorkforceSiteAssignmentBulkPublishResult {
  return {
    operationId: input.operationId,
    siteId: input.siteId,
    kind: input.kind,
    effectiveFrom: dateKey(input.effectiveFrom),
    effectiveTo: input.effectiveTo == null ? null : dateKey(input.effectiveTo),
    requestedCount: input.requestedCount,
    createdCount: input.createdCount,
    unchangedCount: input.unchangedCount,
    idempotent: input.idempotent,
  }
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

function siteAssignmentAuditData(assignment: {
  id: string
  agentId: string
  siteId: string
  kind: string
  effectiveFrom: Date
  effectiveTo: Date | null
}, audit: WorkforceConfigurationAuditContext): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    agentId: assignment.agentId,
    siteId: assignment.siteId,
    kind: assignment.kind,
    effectiveFrom: dateKey(assignment.effectiveFrom),
    effectiveTo: assignment.effectiveTo == null ? null : dateKey(assignment.effectiveTo),
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

/**
 * Computes exact bulk site-assignment impact without locks, writes or audit.
 * A future bulk publisher must re-run this review in its own idempotent
 * transaction; this function is never a mutation authorization.
 */
export async function previewWorkforceSiteAssignments(input: {
  organizationId: string
  preview: z.infer<typeof WorkforceSiteAssignmentBulkPreviewSchema>
  currentDateKey: string
  db?: PrismaClient | Prisma.TransactionClient
}): Promise<WorkforceSiteAssignmentBulkPreview> {
  if (!isDateKey(input.currentDateKey) || input.preview.effectiveFrom <= input.currentDateKey) {
    throw new WorkforceSiteAssignmentManagementError(
      "WORKFORCE_SITE_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
      "A Workforce site assignment preview must begin after the organization current date",
    )
  }
  const db = input.db ?? prisma
  const [site, agents, assignments] = await Promise.all([
    db.workforceSite.findFirst({
      where: { id: input.preview.siteId, organizationId: input.organizationId },
      select: { id: true, status: true },
    }),
    db.mtmAgent.findMany({
      where: {
        organizationId: input.organizationId,
        id: { in: input.preview.agentIds },
        status: "ACTIVE",
      },
      select: { id: true },
    }),
    db.workforceSiteAssignment.findMany({
      where: {
        organizationId: input.organizationId,
        agentId: { in: input.preview.agentIds },
        kind: input.preview.kind,
        ...(input.preview.kind === "PRIMARY" ? {} : { siteId: input.preview.siteId }),
      },
      orderBy: [{ agentId: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }],
      select: workforceSiteAssignmentSelect,
    }),
  ])
  if (!site) {
    throw new WorkforceSiteAssignmentManagementError(
      "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND",
      "Workforce site was not found",
    )
  }
  if (site.status !== "ACTIVE") {
    throw new WorkforceSiteAssignmentManagementError(
      "WORKFORCE_SITE_ASSIGNMENT_SITE_ARCHIVED",
      "An active Workforce site is required for assignment preview",
    )
  }

  const activeAgentIds = new Set(agents.map((agent) => agent.id))
  const assignmentsByAgentId = new Map<string, typeof assignments>()
  for (const assignment of assignments) {
    const current = assignmentsByAgentId.get(assignment.agentId) ?? []
    current.push(assignment)
    assignmentsByAgentId.set(assignment.agentId, current)
  }
  const summary: Record<WorkforceSiteAssignmentBulkPreviewItem["outcome"], number> = {
    READY: 0,
    NO_CHANGE: 0,
    EMPLOYEE_UNAVAILABLE: 0,
    CONFLICT: 0,
  }
  const items = input.preview.agentIds.map((agentId): WorkforceSiteAssignmentBulkPreviewItem => {
    if (!activeAgentIds.has(agentId)) {
      summary.EMPLOYEE_UNAVAILABLE += 1
      return { agentId, outcome: "EMPLOYEE_UNAVAILABLE", currentAssignmentId: null, closesAssignmentId: null }
    }
    const scopedAssignments = assignmentsByAgentId.get(agentId) ?? []
    const latest = scopedAssignments.at(-1) ?? null
    if (latest && input.preview.effectiveFrom <= dateKey(latest.effectiveFrom)) {
      summary.CONFLICT += 1
      return { agentId, outcome: "CONFLICT", currentAssignmentId: latest.id, closesAssignmentId: null }
    }
    const requestedEnd = input.preview.effectiveTo
    const alreadyCovered = latest != null
      && latest.siteId === input.preview.siteId
      && dateKey(latest.effectiveFrom) < input.preview.effectiveFrom
      && (requestedEnd == null
        ? latest.effectiveTo == null
        : latest.effectiveTo != null && dateKey(latest.effectiveTo) >= requestedEnd)
    if (alreadyCovered) {
      summary.NO_CHANGE += 1
      return { agentId, outcome: "NO_CHANGE", currentAssignmentId: latest.id, closesAssignmentId: null }
    }
    summary.READY += 1
    return {
      agentId,
      outcome: "READY",
      currentAssignmentId: latest?.id ?? null,
      closesAssignmentId: input.preview.kind === "PRIMARY" && latest != null && latest.effectiveTo == null ? latest.id : null,
    }
  })
  return {
    effectiveFrom: input.preview.effectiveFrom,
    effectiveTo: input.preview.effectiveTo ?? null,
    siteId: site.id,
    kind: input.preview.kind,
    items,
    summary,
  }
}

/**
 * Publishes a reviewed multi-employee site eligibility window atomically.
 * The preview is deliberately recomputed after a tenant-wide operation lock
 * and deterministic per-employee timeline locks. A stale preview cannot turn
 * a later conflict or inactive employee into a partial HR write.
 *
 * This function writes no attendance, Route, payroll or location fact. Its
 * durable operation receipt is intentionally aggregate-only; the individual
 * eligibility history is recorded in the immutable assignment rows.
 */
export async function publishWorkforceSiteAssignments(input: {
  organizationId: string
  publishedByUserId: string
  publish: z.infer<typeof WorkforceSiteAssignmentBulkPublishSchema>
  currentDateKey: string
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}): Promise<WorkforceSiteAssignmentBulkPublishResult> {
  if (!isDateKey(input.currentDateKey) || input.publish.effectiveFrom <= input.currentDateKey) {
    throw new WorkforceSiteAssignmentManagementError(
      "WORKFORCE_SITE_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
      "A Workforce bulk site assignment must begin after the organization current date",
    )
  }
  const db = input.db ?? prisma
  const requestHash = bulkSiteAssignmentRequestHash(input)
  const orderedAgentIds = [...input.publish.agentIds].sort()
  const bulkPreview = {
    agentIds: orderedAgentIds,
    siteId: input.publish.siteId,
    kind: input.publish.kind,
    effectiveFrom: input.publish.effectiveFrom,
    effectiveTo: input.publish.effectiveTo ?? null,
  }

  try {
    return await db.$transaction(async (tx) => {
      // The operation lock turns a same-key retry into deterministic replay
      // before any employee timeline locks or state reads occur.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${[
        "workforce-site-assignment-bulk",
        input.organizationId,
        input.publish.operationId,
      ].join(":")}))`
      const existing = await tx.workforceSiteAssignmentBulkOperation.findUnique({
        where: {
          organizationId_operationId: {
            organizationId: input.organizationId,
            operationId: input.publish.operationId,
          },
        },
        select: workforceSiteAssignmentBulkOperationSelect,
      })
      if (existing) {
        if (
          existing.requestHash !== requestHash
          || existing.publishedByUserId !== input.publishedByUserId
          || existing.siteId !== input.publish.siteId
          || existing.kind !== input.publish.kind
          || dateKey(existing.effectiveFrom) !== input.publish.effectiveFrom
          || (existing.effectiveTo == null ? null : dateKey(existing.effectiveTo)) !== (input.publish.effectiveTo ?? null)
          || existing.requestedCount !== orderedAgentIds.length
        ) {
          throw new WorkforceSiteAssignmentBulkPublishError(
            "WORKFORCE_SITE_ASSIGNMENT_BULK_OPERATION_MISMATCH",
            "operationId was already used for a different Workforce bulk site assignment",
          )
        }
        return bulkSiteAssignmentOperationResult({ ...existing, idempotent: true })
      }

      // Use the same per-agent/key lock shape as the individual writer, in a
      // stable order. This serializes a bulk publish with individual updates
      // without creating a broad organization lock for unrelated employees.
      for (const agentId of orderedAgentIds) {
        const assignmentLock = [
          "workforce-site-assignment",
          input.organizationId,
          agentId,
          input.publish.kind,
          input.publish.kind === "PRIMARY" ? "primary" : input.publish.siteId,
        ].join(":")
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assignmentLock}))`
      }

      const preview = await previewWorkforceSiteAssignments({
        organizationId: input.organizationId,
        preview: bulkPreview,
        currentDateKey: input.currentDateKey,
        db: tx,
      })
      if (preview.summary.CONFLICT > 0 || preview.summary.EMPLOYEE_UNAVAILABLE > 0) {
        throw new WorkforceSiteAssignmentBulkPublishError(
          "WORKFORCE_SITE_ASSIGNMENT_BULK_PREVIEW_BLOCKED",
          "The Workforce bulk site assignment changed and must be reviewed again",
          preview,
        )
      }

      for (const item of preview.items) {
        if (item.outcome !== "READY") continue
        if (item.closesAssignmentId) {
          const changed = await tx.workforceSiteAssignment.updateMany({
            where: {
              id: item.closesAssignmentId,
              organizationId: input.organizationId,
              agentId: item.agentId,
              kind: "PRIMARY",
              effectiveTo: null,
            },
            data: { effectiveTo: new Date(`${previousDateKey(input.publish.effectiveFrom)}T00:00:00.000Z`) },
          })
          if (changed.count !== 1) {
            throw new WorkforceSiteAssignmentBulkPublishError(
              "WORKFORCE_SITE_ASSIGNMENT_BULK_WRITE_CONFLICT",
              "A preceding Workforce primary site assignment changed concurrently",
            )
          }
        }
        await tx.workforceSiteAssignment.create({
          data: {
            organizationId: input.organizationId,
            agentId: item.agentId,
            siteId: input.publish.siteId,
            kind: input.publish.kind,
            effectiveFrom: new Date(`${input.publish.effectiveFrom}T00:00:00.000Z`),
            effectiveTo: input.publish.effectiveTo == null
              ? null
              : new Date(`${input.publish.effectiveTo}T00:00:00.000Z`),
            assignedByUserId: input.publishedByUserId,
          },
          select: { id: true },
        })
      }

      const operation = await tx.workforceSiteAssignmentBulkOperation.create({
        data: {
          organizationId: input.organizationId,
          operationId: input.publish.operationId,
          requestHash,
          siteId: input.publish.siteId,
          kind: input.publish.kind,
          effectiveFrom: new Date(`${input.publish.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: input.publish.effectiveTo == null
            ? null
            : new Date(`${input.publish.effectiveTo}T00:00:00.000Z`),
          requestedCount: orderedAgentIds.length,
          createdCount: preview.summary.READY,
          unchangedCount: preview.summary.NO_CHANGE,
          publishedByUserId: input.publishedByUserId,
        },
        select: workforceSiteAssignmentBulkOperationSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_SITE_ASSIGNMENT_BULK_PUBLISHED",
          entity: "workforce_site_assignment_bulk_operation",
          entityId: operation.id,
          metadataKind: "workforce_configuration",
          newData: {
            actorUserId: input.audit.actorUserId,
            operationId: operation.operationId,
            siteId: operation.siteId,
            kind: operation.kind,
            effectiveFrom: dateKey(operation.effectiveFrom),
            effectiveTo: operation.effectiveTo == null ? null : dateKey(operation.effectiveTo),
            requestedCount: operation.requestedCount,
            createdCount: operation.createdCount,
            unchangedCount: operation.unchangedCount,
          },
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return bulkSiteAssignmentOperationResult({ ...operation, idempotent: false })
    })
  } catch (error) {
    if (error instanceof WorkforceSiteAssignmentManagementError || error instanceof WorkforceSiteAssignmentBulkPublishError) {
      throw error
    }
    if (hasPrismaCode(error, "P2002") || hasPrismaCode(error, "P2004") || hasPrismaCode(error, "P2010")) {
      throw new WorkforceSiteAssignmentBulkPublishError(
        "WORKFORCE_SITE_ASSIGNMENT_BULK_WRITE_CONFLICT",
        "The Workforce bulk site assignment changed concurrently",
      )
    }
    throw error
  }
}

/**
 * Schedule a site eligibility window from server-known organization time. The
 * primary timeline is forward-only; secondary/temporary windows may coexist
 * only at distinct sites. No travel compensation or attendance is inferred.
 */
export async function scheduleWorkforceSiteAssignment(input: {
  organizationId: string
  assignedByUserId: string
  assignment: z.infer<typeof WorkforceSiteAssignmentScheduleSchema>
  currentDateKey: string
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  if (!isDateKey(input.currentDateKey) || input.assignment.effectiveFrom <= input.currentDateKey) {
    throw new WorkforceSiteAssignmentManagementError(
      "WORKFORCE_SITE_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
      "A Workforce site assignment must become effective after the organization current date",
    )
  }
  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      const [agent, site] = await Promise.all([
        tx.mtmAgent.findFirst({
          where: { id: input.assignment.agentId, organizationId: input.organizationId, status: "ACTIVE" },
          select: { id: true },
        }),
        tx.workforceSite.findFirst({
          where: { id: input.assignment.siteId, organizationId: input.organizationId },
          select: { id: true, status: true },
        }),
      ])
      if (!agent) {
        throw new WorkforceSiteAssignmentManagementError(
          "WORKFORCE_SITE_ASSIGNMENT_AGENT_NOT_FOUND",
          "Active Workforce employee is unavailable",
        )
      }
      if (!site) {
        throw new WorkforceSiteAssignmentManagementError(
          "WORKFORCE_SITE_ASSIGNMENT_SITE_NOT_FOUND",
          "Workforce site was not found",
        )
      }
      if (site.status !== "ACTIVE") {
        throw new WorkforceSiteAssignmentManagementError(
          "WORKFORCE_SITE_ASSIGNMENT_SITE_ARCHIVED",
          "An active Workforce site is required for assignment",
        )
      }
      const assignmentLock = [
        "workforce-site-assignment",
        input.organizationId,
        input.assignment.agentId,
        input.assignment.kind,
        input.assignment.kind === "PRIMARY" ? "primary" : input.assignment.siteId,
      ].join(":")
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assignmentLock}))`
      const sameScope = await tx.workforceSiteAssignment.findMany({
        where: {
          organizationId: input.organizationId,
          agentId: input.assignment.agentId,
          kind: input.assignment.kind,
          ...(input.assignment.kind === "PRIMARY" ? {} : { siteId: input.assignment.siteId }),
        },
        orderBy: { effectiveFrom: "asc" },
        select: workforceSiteAssignmentSelect,
      })
      const predecessor = sameScope.at(-1) ?? null
      if (predecessor && input.assignment.effectiveFrom <= dateKey(predecessor.effectiveFrom)) {
        throw new WorkforceSiteAssignmentManagementError(
          "WORKFORCE_SITE_ASSIGNMENT_TIMELINE_CONFLICT",
          "A Workforce site assignment must be scheduled after the latest matching assignment",
        )
      }
      if (input.assignment.kind === "PRIMARY" && predecessor && predecessor.effectiveTo == null) {
        const changed = await tx.workforceSiteAssignment.updateMany({
          where: {
            id: predecessor.id,
            organizationId: input.organizationId,
            agentId: input.assignment.agentId,
            kind: "PRIMARY",
            effectiveTo: null,
          },
          data: { effectiveTo: new Date(`${previousDateKey(input.assignment.effectiveFrom)}T00:00:00.000Z`) },
        })
        if (changed.count !== 1) {
          throw new WorkforceSiteAssignmentManagementError(
            "WORKFORCE_SITE_ASSIGNMENT_TIMELINE_CONFLICT",
            "The preceding primary site assignment changed concurrently",
          )
        }
      }
      const assignment = await tx.workforceSiteAssignment.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.assignment.agentId,
          siteId: input.assignment.siteId,
          kind: input.assignment.kind,
          effectiveFrom: new Date(`${input.assignment.effectiveFrom}T00:00:00.000Z`),
          effectiveTo: input.assignment.effectiveTo == null
            ? null
            : new Date(`${input.assignment.effectiveTo}T00:00:00.000Z`),
          assignedByUserId: input.assignedByUserId,
        },
        select: workforceSiteAssignmentSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.assignment.agentId,
          action: "WORKFORCE_SITE_ASSIGNMENT_SCHEDULED",
          entity: "workforce_site_assignment",
          entityId: assignment.id,
          metadataKind: "workforce_configuration",
          newData: siteAssignmentAuditData(assignment, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return assignment
    })
  } catch (error) {
    if (hasPrismaCode(error, "P2002") || hasPrismaCode(error, "P2004") || hasPrismaCode(error, "P2010")) {
      throw new WorkforceSiteAssignmentManagementError(
        "WORKFORCE_SITE_ASSIGNMENT_TIMELINE_CONFLICT",
        "The Workforce site assignment timeline changed concurrently",
      )
    }
    throw error
  }
}
