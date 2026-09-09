import type { Prisma } from "@prisma/client"
import { addDateKeyDays, currentDateKey } from "@/lib/mtm/mobile-week"
import {
  WORKFORCE_DEFAULT_POLICY_NAME,
  WORKFORCE_DEFAULT_PROFILE_VERSION,
  WORKFORCE_DEFAULT_SHIFT_CODE,
  WORKFORCE_DEFAULT_SHIFT_NAME,
  WORKFORCE_DEFAULT_TIMEZONE,
  workforceDefaultPolicyDefinition,
  workforceDefaultShiftDefinition,
} from "@/lib/workforce/default-profile"
import {
  canonicalWorkforcePolicyJson,
  workforcePolicyDefinitionHash,
} from "@/lib/workforce/policy-definition"
import {
  canonicalWorkforceShiftJson,
  workforceShiftDefinitionHash,
} from "@/lib/workforce/shift-definition"

type WorkforceDefaultProvisioningDb = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "workforcePolicy" | "workforceShiftTemplate" | "mtmAuditLog"
>

export type WorkforceDefaultProfileProvisioningResult =
  | {
      state: "provisioned"
      profileVersion: typeof WORKFORCE_DEFAULT_PROFILE_VERSION
      effectiveFrom: string
      policyId: string
      shiftTemplateId: string
    }
  | {
      /** A replay found the exact immutable system baseline it created before. */
      state: "already_provisioned"
      profileVersion: typeof WORKFORCE_DEFAULT_PROFILE_VERSION
      policyId: string
      shiftTemplateId: string
    }
  | {
      state: "existing_configuration"
      policyId: string | null
      shiftTemplateId: string | null
    }

export class WorkforceDefaultProfileProvisioningError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "WorkforceDefaultProfileProvisioningError"
  }
}

function dateKeyAsUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function configurationLock(organizationId: string): string {
  return `workforce-default-profile:${organizationId}`
}

/**
 * Creates the first Workforce configuration only in the transaction that
 * explicitly enables the module. It never backfills a legacy MTM tenant and
 * never replaces even a draft tenant-authored definition.
 *
 * The default policy begins on the next Baku calendar date. This preserves the
 * future-only policy lifecycle: enabling a module halfway through a day must
 * not retroactively reinterpret started or completed work.
 */
export async function ensureWorkforceDefaultProfile(input: {
  db: WorkforceDefaultProvisioningDb
  organizationId: string
  initiatedByUserId: string
  now?: Date
}): Promise<WorkforceDefaultProfileProvisioningResult> {
  const now = input.now ?? new Date()
  if (!Number.isFinite(now.getTime())) {
    throw new WorkforceDefaultProfileProvisioningError("System Workforce provisioning time is invalid")
  }
  const initiatedByUserId = input.initiatedByUserId.trim()
  if (!input.organizationId.trim() || !initiatedByUserId) {
    throw new WorkforceDefaultProfileProvisioningError("System Workforce provisioning requires organization and initiator ids")
  }

  await input.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configurationLock(input.organizationId)}))`

  const policyDefinition = workforceDefaultPolicyDefinition()
  const shiftDefinition = workforceDefaultShiftDefinition()
  const policyDefinitionHash = workforcePolicyDefinitionHash(policyDefinition)
  const shiftDefinitionHash = workforceShiftDefinitionHash(shiftDefinition)
  const policies = await input.db.workforcePolicy.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      teamId: true,
      version: true,
      status: true,
      name: true,
      effectiveTo: true,
      definitionHash: true,
      provenance: true,
      systemProfileVersion: true,
      createdByUserId: true,
      activatedByUserId: true,
    },
  })
  const shiftTemplates = await input.db.workforceShiftTemplate.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "asc" },
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
      provenance: true,
      systemProfileVersion: true,
      createdByUserId: true,
      activatedByUserId: true,
    },
  })

  const tenantAuthoredPolicy = policies.find((policy) => policy.provenance !== "SYSTEM_PROVISIONING")
  const tenantAuthoredShift = shiftTemplates.find((shiftTemplate) => shiftTemplate.provenance !== "SYSTEM_PROVISIONING")
  const otherSystemPolicy = policies.find((policy) => (
    policy.provenance === "SYSTEM_PROVISIONING"
    && policy.systemProfileVersion !== WORKFORCE_DEFAULT_PROFILE_VERSION
  ))
  const otherSystemShift = shiftTemplates.find((shiftTemplate) => (
    shiftTemplate.provenance === "SYSTEM_PROVISIONING"
    && shiftTemplate.systemProfileVersion !== WORKFORCE_DEFAULT_PROFILE_VERSION
  ))
  if (tenantAuthoredPolicy || tenantAuthoredShift || otherSystemPolicy || otherSystemShift) {
    return {
      state: "existing_configuration",
      policyId: tenantAuthoredPolicy?.id ?? otherSystemPolicy?.id ?? null,
      shiftTemplateId: tenantAuthoredShift?.id ?? otherSystemShift?.id ?? null,
    }
  }

  const systemPolicies = policies.filter((policy) => (
    policy.provenance === "SYSTEM_PROVISIONING"
    && policy.systemProfileVersion === WORKFORCE_DEFAULT_PROFILE_VERSION
  ))
  const systemShiftTemplates = shiftTemplates.filter((shiftTemplate) => (
    shiftTemplate.provenance === "SYSTEM_PROVISIONING"
    && shiftTemplate.systemProfileVersion === WORKFORCE_DEFAULT_PROFILE_VERSION
  ))
  if (systemPolicies.length > 0 || systemShiftTemplates.length > 0) {
    const policy = systemPolicies[0]
    const shiftTemplate = systemShiftTemplates[0]
    const policyMatches = systemPolicies.length === 1
      && policy?.teamId === null
      && policy.version === 1
      && policy.status === "ACTIVE"
      && policy.name === WORKFORCE_DEFAULT_POLICY_NAME
      && policy.effectiveTo === null
      && policy.definitionHash === policyDefinitionHash
      && policy.createdByUserId === null
      && policy.activatedByUserId === null
    const shiftMatches = systemShiftTemplates.length === 1
      && shiftTemplate?.teamId === null
      && shiftTemplate.code === WORKFORCE_DEFAULT_SHIFT_CODE
      && shiftTemplate.isDefault === true
      && shiftTemplate.version === 1
      && shiftTemplate.status === "ACTIVE"
      && shiftTemplate.name === WORKFORCE_DEFAULT_SHIFT_NAME
      && shiftTemplate.timezone === WORKFORCE_DEFAULT_TIMEZONE
      && shiftTemplate.definitionHash === shiftDefinitionHash
      && shiftTemplate.createdByUserId === null
      && shiftTemplate.activatedByUserId === null
    if (!policyMatches || !shiftMatches || !policy || !shiftTemplate) {
      throw new WorkforceDefaultProfileProvisioningError(
        "System Workforce default profile is incomplete or no longer matches its immutable baseline",
      )
    }
    return {
      state: "already_provisioned",
      profileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
      policyId: policy.id,
      shiftTemplateId: shiftTemplate.id,
    }
  }

  const effectiveFrom = addDateKeyDays(currentDateKey(now, WORKFORCE_DEFAULT_TIMEZONE), 1)
  const canonicalPolicyDefinition = JSON.parse(canonicalWorkforcePolicyJson(policyDefinition)) as Prisma.InputJsonValue
  const canonicalShiftDefinition = JSON.parse(canonicalWorkforceShiftJson(shiftDefinition)) as Prisma.InputJsonValue
  const policy = await input.db.workforcePolicy.create({
    data: {
      organizationId: input.organizationId,
      teamId: null,
      version: 1,
      status: "ACTIVE",
      name: WORKFORCE_DEFAULT_POLICY_NAME,
      effectiveFrom: dateKeyAsUtcDate(effectiveFrom),
      effectiveTo: null,
      definition: canonicalPolicyDefinition,
      definitionHash: policyDefinitionHash,
      provenance: "SYSTEM_PROVISIONING",
      systemProfileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
      createdByUserId: null,
      activatedByUserId: null,
      activatedAt: now,
    },
    select: { id: true, definitionHash: true },
  })
  const shiftTemplate = await input.db.workforceShiftTemplate.create({
    data: {
      organizationId: input.organizationId,
      teamId: null,
      code: WORKFORCE_DEFAULT_SHIFT_CODE,
      isDefault: true,
      version: 1,
      status: "ACTIVE",
      name: WORKFORCE_DEFAULT_SHIFT_NAME,
      timezone: WORKFORCE_DEFAULT_TIMEZONE,
      definition: canonicalShiftDefinition,
      definitionHash: shiftDefinitionHash,
      provenance: "SYSTEM_PROVISIONING",
      systemProfileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
      createdByUserId: null,
      activatedByUserId: null,
      activatedAt: now,
    },
    select: { id: true, definitionHash: true },
  })
  await input.db.mtmAuditLog.create({
    data: {
      organizationId: input.organizationId,
      agentId: null,
      action: "WORKFORCE_DEFAULT_PROFILE_PROVISIONED",
      entity: "workforce_default_profile",
      entityId: `${policy.id}:${shiftTemplate.id}`,
      metadataKind: "workforce_system_provisioning",
      newData: {
        provenance: "SYSTEM_PROVISIONING",
        actorKind: "SYSTEM",
        profileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
        initiatedByUserId,
        effectiveFrom,
        policy: { id: policy.id, definitionHash: policy.definitionHash },
        shiftTemplate: { id: shiftTemplate.id, definitionHash: shiftTemplate.definitionHash },
      },
      ipAddress: null,
      userAgent: null,
    },
  })

  return {
    state: "provisioned",
    profileVersion: WORKFORCE_DEFAULT_PROFILE_VERSION,
    effectiveFrom,
    policyId: policy.id,
    shiftTemplateId: shiftTemplate.id,
  }
}
