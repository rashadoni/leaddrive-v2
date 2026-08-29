import { Prisma, type PrismaClient } from "@prisma/client"
import { z } from "zod"
import { isDateKey } from "@/lib/mtm/mobile-week"
import {
  WorkforcePolicyCalculationDefinitionSchema,
  canonicalWorkforcePolicyJson,
  workforcePolicyDefinitionHash,
} from "@/lib/workforce/policy-definition"
import {
  WorkforceShiftDefinitionSchema,
  canonicalWorkforceShiftJson,
  workforceShiftDefinitionHash,
} from "@/lib/workforce/shift-definition"
import { prisma } from "@/lib/prisma"

const WorkforceDateKeySchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine(isDateKey, "Date must be a real calendar date")
const WorkforceScopeIdSchema = z.string().trim().min(1).max(191)
const WorkforceNameSchema = z.string().trim().min(1).max(160)
const WorkforceShiftCodeSchema = z.string().trim().min(1).max(80)
  .regex(/^[A-Za-z0-9_-]+$/, "Shift code must use letters, numbers, _ or -")
const WorkforceLocalTimeSchema = z.string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "time must be HH:mm")

export const WorkforceShiftSegmentModeSchema = z.enum([
  "SITE",
  "REMOTE",
  "FIELD",
  "TRAVEL",
  "ON_CALL",
  "EXCEPTION",
])

export const WorkforceShiftSegmentDraftSchema = z.object({
  mode: WorkforceShiftSegmentModeSchema,
  siteId: WorkforceScopeIdSchema.nullable().optional(),
  startTime: WorkforceLocalTimeSchema,
  endTime: WorkforceLocalTimeSchema,
  lateGraceSeconds: z.number().int().min(0).max(2 * 60 * 60).default(0),
  proofPolicyReference: z.string().trim().min(1).max(64).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.endTime <= value.startTime) {
    context.addIssue({
      code: "custom",
      path: ["endTime"],
      message: "segment endTime must be after startTime",
    })
  }
  if (value.mode === "SITE" && value.siteId == null) {
    context.addIssue({
      code: "custom",
      path: ["siteId"],
      message: "SITE segment requires a Workforce site",
    })
  }
  if (value.mode !== "SITE" && value.siteId != null) {
    context.addIssue({
      code: "custom",
      path: ["siteId"],
      message: "only a SITE segment may reference a Workforce site",
    })
  }
})

type WorkforceShiftSegmentDraft = z.infer<typeof WorkforceShiftSegmentDraftSchema>

function validateShiftSegmentTimeline(
  segments: readonly WorkforceShiftSegmentDraft[],
  definition: z.infer<typeof WorkforceShiftDefinitionSchema>,
): string | null {
  let previous: WorkforceShiftSegmentDraft | null = null
  for (const segment of segments) {
    if (segment.startTime < definition.startTime || segment.endTime > definition.endTime) {
      return "every segment must be inside the planned shift window"
    }
    if (previous && segment.startTime < previous.endTime) {
      return "segments must be chronological and non-overlapping"
    }
    if ((definition.plannedBreaks ?? []).some((plannedBreak) => (
      segment.startTime < plannedBreak.endTime && plannedBreak.startTime < segment.endTime
    ))) {
      return "segments must not overlap a planned break"
    }
    previous = segment
  }
  return null
}

export const WorkforcePolicyDraftCreateSchema = z.object({
  name: WorkforceNameSchema,
  teamId: WorkforceScopeIdSchema.nullable().optional(),
  effectiveFrom: WorkforceDateKeySchema,
  effectiveTo: WorkforceDateKeySchema.nullable().optional(),
  definition: WorkforcePolicyCalculationDefinitionSchema,
}).strict().superRefine((value, context) => {
  if (value.effectiveTo != null && value.effectiveTo < value.effectiveFrom) {
    context.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "effectiveTo must not be earlier than effectiveFrom",
    })
  }
})

export const WorkforcePolicyDraftUpdateSchema = z.object({
  name: WorkforceNameSchema.optional(),
  effectiveFrom: WorkforceDateKeySchema.optional(),
  effectiveTo: WorkforceDateKeySchema.nullable().optional(),
  definition: WorkforcePolicyCalculationDefinitionSchema.optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({
      code: "custom",
      message: "At least one draft field is required",
    })
  }
  if (
    value.effectiveFrom != null
    && value.effectiveTo != null
    && value.effectiveTo < value.effectiveFrom
  ) {
    context.addIssue({
      code: "custom",
      path: ["effectiveTo"],
      message: "effectiveTo must not be earlier than effectiveFrom",
    })
  }
})

export const WorkforceShiftTemplateDraftCreateSchema = z.object({
  code: WorkforceShiftCodeSchema,
  name: WorkforceNameSchema,
  teamId: WorkforceScopeIdSchema.nullable().optional(),
  definition: WorkforceShiftDefinitionSchema,
  // Omitted preserves the established single-window template contract. When
  // supplied, a non-empty ordered list explicitly models one multi-site day.
  segments: z.array(WorkforceShiftSegmentDraftSchema).min(1).max(24).optional(),
}).strict().superRefine((value, context) => {
  if (value.segments == null) return
  const issue = validateShiftSegmentTimeline(value.segments, value.definition)
  if (issue != null) {
    context.addIssue({ code: "custom", path: ["segments"], message: issue })
  }
})

export const WorkforceShiftTemplateDraftUpdateSchema = z.object({
  name: WorkforceNameSchema.optional(),
  definition: WorkforceShiftDefinitionSchema.optional(),
  // Replaces the complete ordered draft timeline atomically; published
  // templates never accept this mutation.
  segments: z.array(WorkforceShiftSegmentDraftSchema).min(1).max(24).optional(),
}).strict().superRefine((value, context) => {
  if (Object.keys(value).length === 0) {
    context.addIssue({
      code: "custom",
      message: "At least one draft field is required",
    })
  }
})

/**
 * An individual assignment is the only schedule selection exposed in this
 * slice. Defaults have no effective-date timeline, so they remain untouched.
 */
export const WorkforceShiftAssignmentScheduleSchema = z.object({
  agentId: WorkforceScopeIdSchema,
  templateId: WorkforceScopeIdSchema,
  effectiveFrom: WorkforceDateKeySchema,
}).strict()

export class WorkforceConfigurationManagementError extends Error {
  constructor(
    readonly code:
      | "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND"
      | "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT"
      | "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_DATE_NOT_FUTURE"
      | "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS"
      | "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_RANGE_NOT_OPEN_ENDED"
      | "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND"
      | "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT"
      | "WORKFORCE_CONFIGURATION_SHIFT_ACTIVE_EXISTS"
      | "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_INVALID"
      | "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_SITE_INVALID"
      | "WORKFORCE_CONFIGURATION_ASSIGNMENT_AGENT_NOT_FOUND"
      | "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND"
      | "WORKFORCE_CONFIGURATION_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE"
      | "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEAM_INVALID"
      | "WORKFORCE_CONFIGURATION_ASSIGNMENT_CONFLICT"
      | "WORKFORCE_CONFIGURATION_TEAM_INVALID"
      | "WORKFORCE_CONFIGURATION_VERSION_CONFLICT"
      | "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
    message: string = code,
  ) {
    super(message)
  }
}

const workforcePolicySelect = {
  id: true,
  teamId: true,
  version: true,
  status: true,
  name: true,
  effectiveFrom: true,
  effectiveTo: true,
  definition: true,
  definitionHash: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkforcePolicySelect

const workforceShiftTemplateSelect = {
  id: true,
  teamId: true,
  code: true,
  isDefault: true,
  version: true,
  status: true,
  name: true,
  timezone: true,
  definition: true,
  definitionHash: true,
  createdAt: true,
  updatedAt: true,
  segments: {
    orderBy: { sequence: "asc" },
    select: {
      id: true,
      sequence: true,
      mode: true,
      siteId: true,
      startTime: true,
      endTime: true,
      lateGraceSeconds: true,
      proofPolicyReference: true,
      createdAt: true,
    },
  },
} satisfies Prisma.WorkforceShiftTemplateSelect

const workforceShiftAssignmentSelect = {
  id: true,
  agentId: true,
  templateId: true,
  effectiveFrom: true,
  effectiveTo: true,
  assignedByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WorkforceShiftAssignmentSelect

function asDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function previousDateKey(value: string): string {
  return dateKey(new Date(asDate(value).getTime() - 24 * 60 * 60 * 1000))
}

function assertDateRange(effectiveFrom: string, effectiveTo: string | null): void {
  if (effectiveTo != null && effectiveTo < effectiveFrom) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
      "effectiveTo must not be earlier than effectiveFrom",
    )
  }
}

function asPolicyDefinition(definition: unknown): {
  definition: Prisma.InputJsonValue
  definitionHash: string
} {
  const parsed = WorkforcePolicyCalculationDefinitionSchema.safeParse(definition)
  if (!parsed.success) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
      parsed.error.issues[0]?.message ?? "Invalid Workforce policy definition",
    )
  }
  const canonical = JSON.parse(canonicalWorkforcePolicyJson(parsed.data)) as Prisma.InputJsonValue
  return {
    definition: canonical,
    definitionHash: workforcePolicyDefinitionHash(canonical),
  }
}

function asShiftDefinition(definition: unknown): {
  definition: Prisma.InputJsonValue
  definitionHash: string
  timezone: string
} {
  const parsed = WorkforceShiftDefinitionSchema.safeParse(definition)
  if (!parsed.success) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
      parsed.error.issues[0]?.message ?? "Invalid Workforce shift definition",
    )
  }
  const canonical = JSON.parse(canonicalWorkforceShiftJson(parsed.data)) as Prisma.InputJsonValue
  return {
    definition: canonical,
    definitionHash: workforceShiftDefinitionHash(canonical),
    timezone: parsed.data.timezone,
  }
}

function parseShiftDefinitionForSegments(definition: unknown): z.infer<typeof WorkforceShiftDefinitionSchema> {
  const parsed = WorkforceShiftDefinitionSchema.safeParse(definition)
  if (!parsed.success) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_INVALID",
      parsed.error.issues[0]?.message ?? "Workforce shift segment requires a valid shift definition",
    )
  }
  return parsed.data
}

async function assertShiftSegmentSitesAreActive(input: {
  db: Pick<PrismaClient, "workforceSite">
  organizationId: string
  segments: readonly WorkforceShiftSegmentDraft[]
}): Promise<void> {
  const siteIds = [...new Set(input.segments.flatMap((segment) => (
    segment.siteId == null ? [] : [segment.siteId]
  )))]
  if (siteIds.length === 0) return
  const sites = await input.db.workforceSite.findMany({
    where: {
      organizationId: input.organizationId,
      id: { in: siteIds },
      status: "ACTIVE",
    },
    select: { id: true },
  })
  if (sites.length !== siteIds.length) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_SITE_INVALID",
      "Every SITE segment must reference an active Workforce site in this tenant",
    )
  }
}

function shiftSegmentCreateData(input: {
  organizationId: string
  segments: readonly WorkforceShiftSegmentDraft[]
}) {
  return input.segments.map((segment, index) => ({
    organizationId: input.organizationId,
    sequence: index + 1,
    mode: segment.mode,
    siteId: segment.siteId ?? null,
    startTime: segment.startTime,
    endTime: segment.endTime,
    lateGraceSeconds: segment.lateGraceSeconds,
    proofPolicyReference: segment.proofPolicyReference ?? null,
  }))
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (error as { code?: unknown } | null)?.code === code
}

function isWindowConstraintError(error: unknown): boolean {
  // PostgreSQL exclusion and trigger violations are surfaced by different
  // Prisma versions as P2002, P2004, or P2010. Each caller only invokes this
  // helper around one locked effective-date write, where all three mean that
  // the requested future window lost a race or violates an immutable fact.
  return isPrismaCode(error, "P2002")
    || isPrismaCode(error, "P2004")
    || isPrismaCode(error, "P2010")
}

function configurationLock(parts: readonly string[]): string {
  return ["workforce-configuration", ...parts].join(":")
}

export type WorkforceConfigurationAuditContext = {
  actorUserId: string
  ipAddress?: string | null
  userAgent?: string | null
}

function workforcePolicyAuditData(input: {
  id: string
  teamId: string | null
  version: number
  status: string
  name: string
  effectiveFrom: Date
  effectiveTo: Date | null
  definitionHash: string
}, audit: WorkforceConfigurationAuditContext): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    teamId: input.teamId,
    version: input.version,
    status: input.status,
    name: input.name,
    effectiveFrom: dateKey(input.effectiveFrom),
    effectiveTo: input.effectiveTo == null ? null : dateKey(input.effectiveTo),
    definitionHash: input.definitionHash,
  }
}

function workforceShiftTemplateAuditData(input: {
  id: string
  teamId: string | null
  code: string
  isDefault: boolean
  version: number
  status: string
  name: string
  timezone: string
  definitionHash: string
  segments?: readonly {
    sequence: number
    mode: string
    siteId: string | null
    startTime: string
    endTime: string
    lateGraceSeconds: number
    proofPolicyReference: string | null
  }[]
}, audit: WorkforceConfigurationAuditContext): Prisma.InputJsonObject {
  const segments = input.segments?.map((segment) => ({
    sequence: segment.sequence,
    mode: segment.mode,
    siteId: segment.siteId,
    startTime: segment.startTime,
    endTime: segment.endTime,
    lateGraceSeconds: segment.lateGraceSeconds,
    proofPolicyReference: segment.proofPolicyReference,
  }))
  return {
    actorUserId: audit.actorUserId,
    teamId: input.teamId,
    code: input.code,
    isDefault: input.isDefault,
    version: input.version,
    status: input.status,
    name: input.name,
    timezone: input.timezone,
    definitionHash: input.definitionHash,
    ...(segments === undefined ? {} : {
      segmentCount: segments.length,
      segmentDefinitionHash: workforceShiftDefinitionHash({ segments }),
      segments,
    }),
  }
}

function workforceShiftAssignmentAuditData(input: {
  id: string
  agentId: string
  templateId: string
  effectiveFrom: Date
  effectiveTo: Date | null
  assignedByUserId: string
}, audit: WorkforceConfigurationAuditContext): Prisma.InputJsonObject {
  return {
    actorUserId: audit.actorUserId,
    agentId: input.agentId,
    templateId: input.templateId,
    effectiveFrom: dateKey(input.effectiveFrom),
    effectiveTo: input.effectiveTo == null ? null : dateKey(input.effectiveTo),
    assignedByUserId: input.assignedByUserId,
  }
}

function workforceActivationAuditData(
  data: Prisma.InputJsonObject,
  activatedAt: Date,
): Prisma.InputJsonObject {
  return {
    ...data,
    activatedAt: activatedAt.toISOString(),
  }
}

/**
 * Creates an unpublished policy definition. It deliberately has no activation
 * path: an administrator must make the later effective-date/replacement
 * decision through an explicitly reviewed release slice.
 */
export async function createWorkforcePolicyDraft(input: {
  organizationId: string
  createdByUserId: string
  draft: z.infer<typeof WorkforcePolicyDraftCreateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  const teamId = input.draft.teamId ?? null
  const definition = asPolicyDefinition(input.draft.definition)
  assertDateRange(input.draft.effectiveFrom, input.draft.effectiveTo ?? null)
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
        input.organizationId,
        "policy",
        teamId ?? "organization",
      ])}))`
      const latest = await tx.workforcePolicy.findFirst({
        where: { organizationId: input.organizationId, teamId },
        orderBy: { version: "desc" },
        select: { version: true },
      })
      const policy = await tx.workforcePolicy.create({
        data: {
          organizationId: input.organizationId,
          teamId,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          name: input.draft.name,
          effectiveFrom: asDate(input.draft.effectiveFrom),
          effectiveTo: input.draft.effectiveTo ? asDate(input.draft.effectiveTo) : null,
          definition: definition.definition,
          definitionHash: definition.definitionHash,
          provenance: "TENANT_ADMIN",
          systemProfileVersion: null,
          createdByUserId: input.createdByUserId,
        },
        select: workforcePolicySelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_POLICY_DRAFT_CREATED",
          entity: "workforce_policy",
          entityId: policy.id,
          metadataKind: "workforce_configuration",
          newData: workforcePolicyAuditData(policy, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return policy
    })
  } catch (error) {
    if (isPrismaCode(error, "P2003")) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_TEAM_INVALID",
        "The Workforce policy team is unavailable in this tenant",
      )
    }
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_VERSION_CONFLICT",
        "The Workforce policy version changed concurrently; retry with a fresh draft",
      )
    }
    throw error
  }
}

/** Edits only an unpublished policy; scope and version are immutable. */
export async function updateWorkforcePolicyDraft(input: {
  organizationId: string
  policyId: string
  draft: z.infer<typeof WorkforcePolicyDraftUpdateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  return db.$transaction(async (tx) => {
    const beforeLock = await tx.workforcePolicy.findFirst({
      where: { id: input.policyId, organizationId: input.organizationId },
      select: {
        id: true,
        teamId: true,
        version: true,
        status: true,
        name: true,
        effectiveFrom: true,
        effectiveTo: true,
        definitionHash: true,
      },
    })
    if (!beforeLock) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND",
        "Workforce policy was not found",
      )
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
      input.organizationId,
      "policy",
      beforeLock.teamId ?? "organization",
    ])}))`
    // Re-read under the same scope lock used by activation. Without this, a
    // concurrent PATCH could move a draft to today after activation validates
    // its date but before the publish update is committed.
    const existing = await tx.workforcePolicy.findFirst({
      where: { id: input.policyId, organizationId: input.organizationId },
      select: {
        id: true,
        teamId: true,
        version: true,
        status: true,
        name: true,
        effectiveFrom: true,
        effectiveTo: true,
        definitionHash: true,
      },
    })
    if (!existing) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND",
        "Workforce policy was not found",
      )
    }
    if (existing.status !== "DRAFT") {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
        "Published Workforce policies are immutable; create a new draft version",
      )
    }
    const effectiveFrom = input.draft.effectiveFrom ?? dateKey(existing.effectiveFrom)
    const effectiveTo = input.draft.effectiveTo === undefined
      ? existing.effectiveTo == null ? null : dateKey(existing.effectiveTo)
      : input.draft.effectiveTo
    assertDateRange(effectiveFrom, effectiveTo)
    const definition = input.draft.definition === undefined ? null : asPolicyDefinition(input.draft.definition)

    const changed = await tx.workforcePolicy.updateMany({
      where: { id: input.policyId, organizationId: input.organizationId, status: "DRAFT" },
      data: {
        ...(input.draft.name === undefined ? {} : { name: input.draft.name }),
        ...(input.draft.effectiveFrom === undefined ? {} : { effectiveFrom: asDate(input.draft.effectiveFrom) }),
        ...(input.draft.effectiveTo === undefined ? {} : {
          effectiveTo: input.draft.effectiveTo == null ? null : asDate(input.draft.effectiveTo),
        }),
        ...(definition == null ? {} : definition),
      },
    })
    if (changed.count !== 1) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
        "The Workforce policy was published while this draft was being edited",
      )
    }
    const result = await tx.workforcePolicy.findFirst({
      where: { id: input.policyId, organizationId: input.organizationId },
      select: workforcePolicySelect,
    })
    if (!result) {
      throw new WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND")
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: null,
        action: "WORKFORCE_POLICY_DRAFT_UPDATED",
        entity: "workforce_policy",
        entityId: result.id,
        metadataKind: "workforce_configuration",
        oldData: workforcePolicyAuditData(existing, input.audit),
        newData: workforcePolicyAuditData(result, input.audit),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
    return result
  })
}

/**
 * Publishes a future policy, optionally closing the currently effective
 * version on the preceding calendar day. The transaction deliberately never
 * updates a workday or a snapshot: resolver selection changes only for dates
 * at or after the new definition's effectiveFrom.
 */
export async function activateWorkforcePolicyDraft(input: {
  organizationId: string
  policyId: string
  currentDateKey: string
  audit: WorkforceConfigurationAuditContext
  now?: Date
  db?: PrismaClient
}) {
  if (!isDateKey(input.currentDateKey)) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
      "Workforce configuration current date is invalid",
    )
  }
  const activatedAt = input.now ?? new Date()
  if (!Number.isFinite(activatedAt.getTime())) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
      "Workforce configuration activation time is invalid",
    )
  }
  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      const beforeLock = await tx.workforcePolicy.findFirst({
        where: { id: input.policyId, organizationId: input.organizationId },
        select: workforcePolicySelect,
      })
      if (!beforeLock) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND",
          "Workforce policy was not found",
        )
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
        input.organizationId,
        "policy",
        beforeLock.teamId ?? "organization",
      ])}))`
      const draft = await tx.workforcePolicy.findFirst({
        where: { id: input.policyId, organizationId: input.organizationId },
        select: workforcePolicySelect,
      })
      if (!draft) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND",
          "Workforce policy was not found",
        )
      }
      if (draft.status !== "DRAFT") {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
          "Only an unpublished Workforce policy can be activated",
        )
      }
      const effectiveFrom = dateKey(draft.effectiveFrom)
      if (effectiveFrom <= input.currentDateKey) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_DATE_NOT_FUTURE",
          "A Workforce policy must become effective after the organization current date",
        )
      }
      if (draft.effectiveTo != null) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_EFFECTIVE_RANGE_NOT_OPEN_ENDED",
          "A scheduled Workforce policy must be open-ended until a later future replacement is published",
        )
      }

      const activePolicies = await tx.workforcePolicy.findMany({
        where: {
          organizationId: input.organizationId,
          teamId: draft.teamId,
          status: "ACTIVE",
        },
        orderBy: { effectiveFrom: "asc" },
        select: workforcePolicySelect,
      })
      const predecessors = activePolicies.filter((policy) => (
        policy.id !== draft.id
        && dateKey(policy.effectiveFrom) <= effectiveFrom
        && (policy.effectiveTo == null || dateKey(policy.effectiveTo) >= effectiveFrom)
      ))
      const laterPolicies = activePolicies.filter((policy) => (
        policy.id !== draft.id && dateKey(policy.effectiveFrom) > effectiveFrom
      ))
      if (predecessors.length > 1 || laterPolicies.length > 0) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS",
          "A conflicting Workforce policy effective window already exists for this scope",
        )
      }
      const predecessor = predecessors[0] ?? null
      if (!predecessor && activePolicies.some((policy) => policy.id !== draft.id)) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS",
          "A Workforce policy gap or conflicting future window must be resolved before publishing this replacement",
        )
      }

      if (predecessor) {
        const predecessorEffectiveTo = previousDateKey(effectiveFrom)
        if (dateKey(predecessor.effectiveFrom) > predecessorEffectiveTo) {
          throw new WorkforceConfigurationManagementError(
            "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS",
            "A Workforce policy replacement cannot create an empty predecessor window",
          )
        }
        const changedPredecessor = await tx.workforcePolicy.updateMany({
          where: {
            id: predecessor.id,
            organizationId: input.organizationId,
            status: "ACTIVE",
          },
          data: { effectiveTo: asDate(predecessorEffectiveTo) },
        })
        if (changedPredecessor.count !== 1) {
          throw new WorkforceConfigurationManagementError(
            "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS",
            "The Workforce policy predecessor changed while this replacement was being scheduled",
          )
        }
        await tx.mtmAuditLog.create({
          data: {
            organizationId: input.organizationId,
            agentId: null,
            action: "WORKFORCE_POLICY_EFFECTIVE_WINDOW_CLOSED",
            entity: "workforce_policy",
            entityId: predecessor.id,
            metadataKind: "workforce_configuration",
            oldData: workforcePolicyAuditData(predecessor, input.audit),
            newData: workforcePolicyAuditData({
              ...predecessor,
              effectiveTo: asDate(predecessorEffectiveTo),
            }, input.audit),
            ipAddress: input.audit.ipAddress ?? null,
            userAgent: input.audit.userAgent ?? null,
          },
        })
      }

      const changed = await tx.workforcePolicy.updateMany({
        where: { id: input.policyId, organizationId: input.organizationId, status: "DRAFT" },
        data: {
          status: "ACTIVE",
          activatedByUserId: input.audit.actorUserId,
          activatedAt,
        },
      })
      if (changed.count !== 1) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_POLICY_NOT_DRAFT",
          "The Workforce policy was activated while this request was in progress",
        )
      }
      const policy = await tx.workforcePolicy.findFirst({
        where: { id: input.policyId, organizationId: input.organizationId },
        select: workforcePolicySelect,
      })
      if (!policy) {
        throw new WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_POLICY_NOT_FOUND")
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_POLICY_SCHEDULED",
          entity: "workforce_policy",
          entityId: policy.id,
          metadataKind: "workforce_configuration",
          oldData: workforcePolicyAuditData(draft, input.audit),
          newData: workforceActivationAuditData(
            workforcePolicyAuditData(policy, input.audit),
            activatedAt,
          ),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return policy
    })
  } catch (error) {
    if (isWindowConstraintError(error)) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_POLICY_ACTIVE_EXISTS",
        "A conflicting Workforce policy effective window already exists for this scope",
      )
    }
    throw error
  }
}

/** Creates an unpublished reusable shift; draft templates cannot become defaults. */
export async function createWorkforceShiftTemplateDraft(input: {
  organizationId: string
  createdByUserId: string
  draft: z.infer<typeof WorkforceShiftTemplateDraftCreateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  const teamId = input.draft.teamId ?? null
  const definition = asShiftDefinition(input.draft.definition)
  const segments = input.draft.segments
  if (segments != null) {
    const timelineIssue = validateShiftSegmentTimeline(
      segments,
      parseShiftDefinitionForSegments(input.draft.definition),
    )
    if (timelineIssue != null) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_INVALID",
        timelineIssue,
      )
    }
  }
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
        input.organizationId,
        "shift",
        teamId ?? "organization",
        input.draft.code,
      ])}))`
      const latest = await tx.workforceShiftTemplate.findFirst({
        where: { organizationId: input.organizationId, teamId, code: input.draft.code },
        orderBy: { version: "desc" },
        select: { version: true },
      })
      if (segments != null) {
        await assertShiftSegmentSitesAreActive({
          db: tx,
          organizationId: input.organizationId,
          segments,
        })
      }
      const shift = await tx.workforceShiftTemplate.create({
        data: {
          organizationId: input.organizationId,
          teamId,
          code: input.draft.code,
          isDefault: false,
          version: (latest?.version ?? 0) + 1,
          status: "DRAFT",
          name: input.draft.name,
          timezone: definition.timezone,
          definition: definition.definition,
          definitionHash: definition.definitionHash,
          provenance: "TENANT_ADMIN",
          systemProfileVersion: null,
          createdByUserId: input.createdByUserId,
          ...(segments == null ? {} : {
            segments: {
              create: shiftSegmentCreateData({
                organizationId: input.organizationId,
                segments,
              }),
            },
          }),
        },
        select: workforceShiftTemplateSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_SHIFT_TEMPLATE_DRAFT_CREATED",
          entity: "workforce_shift_template",
          entityId: shift.id,
          metadataKind: "workforce_configuration",
          newData: workforceShiftTemplateAuditData(shift, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return shift
    })
  } catch (error) {
    if (isPrismaCode(error, "P2003")) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_TEAM_INVALID",
        "The Workforce shift team is unavailable in this tenant",
      )
    }
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_VERSION_CONFLICT",
        "The Workforce shift version changed concurrently; retry with a fresh draft",
      )
    }
    throw error
  }
}

/** Edits only a draft shift; code, scope, version and default status remain fixed. */
export async function updateWorkforceShiftTemplateDraft(input: {
  organizationId: string
  templateId: string
  draft: z.infer<typeof WorkforceShiftTemplateDraftUpdateSchema>
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  const db = input.db ?? prisma
  return db.$transaction(async (tx) => {
    const beforeLock = await tx.workforceShiftTemplate.findFirst({
      where: { id: input.templateId, organizationId: input.organizationId },
      select: {
        id: true,
        teamId: true,
        code: true,
        isDefault: true,
        version: true,
        status: true,
        name: true,
        timezone: true,
        definitionHash: true,
      },
    })
    if (!beforeLock) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND",
        "Workforce shift template was not found",
      )
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
      input.organizationId,
      "shift",
      beforeLock.teamId ?? "organization",
      beforeLock.code,
    ])}))`
    const existing = await tx.workforceShiftTemplate.findFirst({
      where: { id: input.templateId, organizationId: input.organizationId },
      select: workforceShiftTemplateSelect,
    })
    if (!existing) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND",
        "Workforce shift template was not found",
      )
    }
    if (existing.status !== "DRAFT") {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
        "Published Workforce shift templates are immutable; create a new draft version",
      )
    }
    const definition = input.draft.definition === undefined ? null : asShiftDefinition(input.draft.definition)
    const requestedSegments = input.draft.segments
    if (input.draft.definition !== undefined || requestedSegments !== undefined) {
      const existingSegments: WorkforceShiftSegmentDraft[] = (existing.segments ?? []).map((segment) => ({
        mode: segment.mode,
        siteId: segment.siteId,
        startTime: segment.startTime,
        endTime: segment.endTime,
        lateGraceSeconds: segment.lateGraceSeconds,
        proofPolicyReference: segment.proofPolicyReference,
      }))
      const timelineIssue = validateShiftSegmentTimeline(
        requestedSegments ?? existingSegments,
        parseShiftDefinitionForSegments(input.draft.definition ?? existing.definition),
      )
      if (timelineIssue != null) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_SEGMENT_INVALID",
          timelineIssue,
        )
      }
    }
    if (requestedSegments != null) {
      await assertShiftSegmentSitesAreActive({
        db: tx,
        organizationId: input.organizationId,
        segments: requestedSegments,
      })
    }
    const changed = await tx.workforceShiftTemplate.updateMany({
      where: { id: input.templateId, organizationId: input.organizationId, status: "DRAFT" },
      data: {
        ...(input.draft.name === undefined ? {} : { name: input.draft.name }),
        ...(definition == null ? {} : definition),
      },
    })
    if (changed.count !== 1) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
        "The Workforce shift was published while this draft was being edited",
      )
    }
    if (requestedSegments != null) {
      await tx.workforceShiftSegment.deleteMany({
        where: { organizationId: input.organizationId, templateId: input.templateId },
      })
      await tx.workforceShiftSegment.createMany({
        data: shiftSegmentCreateData({
          organizationId: input.organizationId,
          segments: requestedSegments,
        }).map((segment) => ({ ...segment, templateId: input.templateId })),
      })
    }
    const result = await tx.workforceShiftTemplate.findFirst({
      where: { id: input.templateId, organizationId: input.organizationId },
      select: workforceShiftTemplateSelect,
    })
    if (!result) {
      throw new WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND")
    }
    await tx.mtmAuditLog.create({
      data: {
        organizationId: input.organizationId,
        agentId: null,
        action: "WORKFORCE_SHIFT_TEMPLATE_DRAFT_UPDATED",
        entity: "workforce_shift_template",
        entityId: result.id,
        metadataKind: "workforce_configuration",
        oldData: workforceShiftTemplateAuditData(existing, input.audit),
        newData: workforceShiftTemplateAuditData(result, input.audit),
        ipAddress: input.audit.ipAddress ?? null,
        userAgent: input.audit.userAgent ?? null,
      },
    })
    return result
  })
}

/**
 * Publishes an initial reusable shift template. It remains non-default and is
 * never assigned here, so activation alone cannot alter an employee's live or
 * historical workday. Future individual assignments use the separately
 * reviewed effective-dated lifecycle below; default selection remains fixed.
 */
export async function activateWorkforceShiftTemplateDraft(input: {
  organizationId: string
  templateId: string
  audit: WorkforceConfigurationAuditContext
  now?: Date
  db?: PrismaClient
}) {
  const activatedAt = input.now ?? new Date()
  if (!Number.isFinite(activatedAt.getTime())) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
      "Workforce configuration activation time is invalid",
    )
  }
  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      const beforeLock = await tx.workforceShiftTemplate.findFirst({
        where: { id: input.templateId, organizationId: input.organizationId },
        select: workforceShiftTemplateSelect,
      })
      if (!beforeLock) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND",
          "Workforce shift template was not found",
        )
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
        input.organizationId,
        "shift",
        beforeLock.teamId ?? "organization",
        beforeLock.code,
      ])}))`
      const draft = await tx.workforceShiftTemplate.findFirst({
        where: { id: input.templateId, organizationId: input.organizationId },
        select: workforceShiftTemplateSelect,
      })
      if (!draft) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND",
          "Workforce shift template was not found",
        )
      }
      if (draft.status !== "DRAFT") {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
          "Only an unpublished Workforce shift can be activated",
        )
      }
      const active = await tx.workforceShiftTemplate.findFirst({
        where: {
          organizationId: input.organizationId,
          teamId: draft.teamId,
          code: draft.code,
          status: "ACTIVE",
        },
        select: { id: true },
      })
      if (active) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_ACTIVE_EXISTS",
          "A Workforce shift is already active for this scope and code; replacement requires a separate lifecycle",
        )
      }

      const changed = await tx.workforceShiftTemplate.updateMany({
        where: { id: input.templateId, organizationId: input.organizationId, status: "DRAFT" },
        data: {
          status: "ACTIVE",
          isDefault: false,
          activatedByUserId: input.audit.actorUserId,
          activatedAt,
        },
      })
      if (changed.count !== 1) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_SHIFT_NOT_DRAFT",
          "The Workforce shift was activated while this request was in progress",
        )
      }
      const shift = await tx.workforceShiftTemplate.findFirst({
        where: { id: input.templateId, organizationId: input.organizationId },
        select: workforceShiftTemplateSelect,
      })
      if (!shift) {
        throw new WorkforceConfigurationManagementError("WORKFORCE_CONFIGURATION_SHIFT_NOT_FOUND")
      }
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: null,
          action: "WORKFORCE_SHIFT_TEMPLATE_ACTIVATED",
          entity: "workforce_shift_template",
          entityId: shift.id,
          metadataKind: "workforce_configuration",
          oldData: workforceShiftTemplateAuditData(draft, input.audit),
          newData: workforceActivationAuditData(
            workforceShiftTemplateAuditData(shift, input.audit),
            activatedAt,
          ),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return shift
    })
  } catch (error) {
    if (isPrismaCode(error, "P2002")) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_SHIFT_ACTIVE_EXISTS",
        "A Workforce shift is already active for this scope and code; replacement requires a separate lifecycle",
      )
    }
    throw error
  }
}

/**
 * Schedules one employee's next shift template. The caller can only choose a
 * date after the organization-local current date. If an existing assignment
 * covers that future date, its window is closed on the preceding day in the
 * same locked transaction; past snapshots are neither read nor rewritten.
 */
export async function scheduleWorkforceShiftAssignment(input: {
  organizationId: string
  assignment: z.infer<typeof WorkforceShiftAssignmentScheduleSchema>
  currentDateKey: string
  audit: WorkforceConfigurationAuditContext
  db?: PrismaClient
}) {
  if (!isDateKey(input.currentDateKey)) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_DATE_RANGE_INVALID",
      "Workforce configuration current date is invalid",
    )
  }
  if (input.assignment.effectiveFrom <= input.currentDateKey) {
    throw new WorkforceConfigurationManagementError(
      "WORKFORCE_CONFIGURATION_ASSIGNMENT_EFFECTIVE_DATE_NOT_FUTURE",
      "A Workforce shift assignment must begin after the organization current date",
    )
  }

  const db = input.db ?? prisma
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock([
        input.organizationId,
        "assignment",
        input.assignment.agentId,
      ])}))`

      const agent = await tx.mtmAgent.findFirst({
        where: {
          id: input.assignment.agentId,
          organizationId: input.organizationId,
          status: "ACTIVE",
        },
        select: { id: true, teamId: true },
      })
      if (!agent) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_ASSIGNMENT_AGENT_NOT_FOUND",
          "The active Workforce employee is unavailable in this tenant",
        )
      }

      const template = await tx.workforceShiftTemplate.findFirst({
        where: {
          id: input.assignment.templateId,
          organizationId: input.organizationId,
          status: "ACTIVE",
        },
        select: workforceShiftTemplateSelect,
      })
      if (!template) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEMPLATE_NOT_FOUND",
          "The published Workforce shift template is unavailable in this tenant",
        )
      }
      if (template.teamId != null && template.teamId !== agent.teamId) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_ASSIGNMENT_TEAM_INVALID",
          "A team-scoped Workforce shift template must match the employee current team",
        )
      }

      const effectiveFrom = asDate(input.assignment.effectiveFrom)
      const assignments = await tx.workforceShiftAssignment.findMany({
        where: {
          organizationId: input.organizationId,
          agentId: input.assignment.agentId,
        },
        orderBy: { effectiveFrom: "asc" },
        select: workforceShiftAssignmentSelect,
      })
      const covering = assignments.filter((assignment) => (
        dateKey(assignment.effectiveFrom) <= input.assignment.effectiveFrom
        && (assignment.effectiveTo == null || dateKey(assignment.effectiveTo) >= input.assignment.effectiveFrom)
      ))
      const later = assignments.filter((assignment) => (
        dateKey(assignment.effectiveFrom) > input.assignment.effectiveFrom
      ))
      if (covering.length > 1 || later.length > 0) {
        throw new WorkforceConfigurationManagementError(
          "WORKFORCE_CONFIGURATION_ASSIGNMENT_CONFLICT",
          "A conflicting Workforce shift assignment effective window already exists for this employee",
        )
      }

      const predecessor = covering[0] ?? null
      if (predecessor) {
        const predecessorEffectiveTo = previousDateKey(input.assignment.effectiveFrom)
        if (dateKey(predecessor.effectiveFrom) > predecessorEffectiveTo) {
          throw new WorkforceConfigurationManagementError(
            "WORKFORCE_CONFIGURATION_ASSIGNMENT_CONFLICT",
            "A Workforce shift assignment replacement cannot create an empty predecessor window",
          )
        }
        const changedPredecessor = await tx.workforceShiftAssignment.updateMany({
          where: {
            id: predecessor.id,
            organizationId: input.organizationId,
          },
          data: { effectiveTo: asDate(predecessorEffectiveTo) },
        })
        if (changedPredecessor.count !== 1) {
          throw new WorkforceConfigurationManagementError(
            "WORKFORCE_CONFIGURATION_ASSIGNMENT_CONFLICT",
            "The Workforce shift assignment predecessor changed while this replacement was being scheduled",
          )
        }
        await tx.mtmAuditLog.create({
          data: {
            organizationId: input.organizationId,
            agentId: predecessor.agentId,
            action: "WORKFORCE_SHIFT_ASSIGNMENT_EFFECTIVE_WINDOW_CLOSED",
            entity: "workforce_shift_assignment",
            entityId: predecessor.id,
            metadataKind: "workforce_configuration",
            oldData: workforceShiftAssignmentAuditData(predecessor, input.audit),
            newData: workforceShiftAssignmentAuditData({
              ...predecessor,
              effectiveTo: asDate(predecessorEffectiveTo),
            }, input.audit),
            ipAddress: input.audit.ipAddress ?? null,
            userAgent: input.audit.userAgent ?? null,
          },
        })
      }

      const assignment = await tx.workforceShiftAssignment.create({
        data: {
          organizationId: input.organizationId,
          agentId: input.assignment.agentId,
          templateId: template.id,
          effectiveFrom,
          effectiveTo: null,
          assignedByUserId: input.audit.actorUserId,
        },
        select: workforceShiftAssignmentSelect,
      })
      await tx.mtmAuditLog.create({
        data: {
          organizationId: input.organizationId,
          agentId: assignment.agentId,
          action: "WORKFORCE_SHIFT_ASSIGNMENT_SCHEDULED",
          entity: "workforce_shift_assignment",
          entityId: assignment.id,
          metadataKind: "workforce_configuration",
          oldData: predecessor == null ? undefined : workforceShiftAssignmentAuditData(predecessor, input.audit),
          newData: workforceShiftAssignmentAuditData(assignment, input.audit),
          ipAddress: input.audit.ipAddress ?? null,
          userAgent: input.audit.userAgent ?? null,
        },
      })
      return assignment
    })
  } catch (error) {
    if (isWindowConstraintError(error)) {
      throw new WorkforceConfigurationManagementError(
        "WORKFORCE_CONFIGURATION_ASSIGNMENT_CONFLICT",
        "A conflicting Workforce shift assignment effective window already exists for this employee",
      )
    }
    throw error
  }
}
